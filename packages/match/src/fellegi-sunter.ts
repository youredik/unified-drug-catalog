/**
 * Модель Fellegi–Sunter.
 *
 *   M = log2( λ / (1−λ) ) + Σᵢ log2( mᵢ / uᵢ )
 *   P(совпадение | наблюдение) = 2^M / (1 + 2^M)
 *
 * где λ — априорная доля совпадающих пар среди всех сравниваемых.
 *
 * Два порога дают ТРИ зоны, и это не изобретение, а исходная формулировка
 * Fellegi–Sunter 1969 года: между «совпало» и «не совпало» всегда остаётся
 * область, где данных недостаточно. Классически туда ставят человека
 * (clerical review); у нас туда же подключается арбитр — см. adjudicator.ts.
 *
 * Почему не Splink: он на Python/DuckDB и в TypeScript-стеке недоступен.
 * Математика здесь та же, и в самостоятельной реализации есть плюс — веса
 * остаются объяснимыми и юнит-тестируемыми, а разбор решения можно показать
 * построчно.
 */

import type { ComparisonWeight, MatchDecision, MatchZone, NormalizedRecord, SourceRecordId } from '@catalog/domain';
import { COMPARISONS, findLevel, levelWeight } from './comparison.ts';

export interface Thresholds {
  /** Выше — считаем совпадением без дальнейших вопросов. */
  readonly upper: number;
  /** Ниже — считаем разными записями. Между порогами — зона неопределённости. */
  readonly lower: number;
}

export interface ScoringConfig {
  /**
   * Априорная доля совпадений. При блокировке кандидатов она заметно выше, чем
   * среди всех возможных пар: блок уже отобрал похожее. 0.2 — консервативная
   * оценка для «после блокировки».
   */
  readonly lambda: number;
  readonly thresholds: Thresholds;
}

export const DEFAULT_CONFIG: ScoringConfig = {
  lambda: 0.2,
  /**
   * Пороги выбраны СВИПОМ по размеченному набору, а не назначены.
   *
   * Замер показал главное: веса положительных пар (13.24…35.72) и
   * отрицательных (−11.90…19.08) ПЕРЕКРЫВАЮТСЯ. Ни один порог не разделяет
   * их без потерь — то есть трёхзонная постановка Fellegi–Sunter здесь не
   * теория, а измеренный факт.
   *
   * Планка поднята так, чтобы правила НЕ ОШИБАЛИСЬ: при upper = 14 на наборе
   * ноль ложноположительных и ноль ложноотрицательных, но четыре пары уходят
   * в зону неопределённости. Это осознанный размен: пусть система молчит там,
   * где не уверена, а спорное разбирает арбитр — вместо того чтобы тихо
   * склеивать разные товары.
   */
  thresholds: { upper: 14, lower: 8 },
};

export const probabilityFromWeight = (weight: number): number => {
  const odds = 2 ** weight;
  return odds / (1 + odds);
};

export const zoneFor = (weight: number, t: Thresholds): MatchZone =>
  weight >= t.upper ? 'match' : weight <= t.lower ? 'non_match' : 'possible';

export interface Scored {
  readonly leftId: SourceRecordId;
  readonly rightId: SourceRecordId;
  readonly weights: readonly ComparisonWeight[];
  readonly totalWeight: number;
  readonly probability: number;
  readonly zone: MatchZone;
  /** Один идентификатор у явно разных товаров — конфликт, а не совпадение. */
  readonly conflict?: 'same_gtin_different_products';
}

/**
 * Отдельный случай, который нельзя решать весами: один и тот же идентификатор
 * у записей, которые по дозировке или упаковке заведомо разные. Это ошибка
 * поставщика, и правильный ответ — не «склеить, потому что GTIN совпал»,
 * а поднять руку.
 */
const detectGtinConflict = (a: NormalizedRecord, b: NormalizedRecord): boolean => {
  if (a.gtin === undefined || a.gtin !== b.gtin) return false;
  const strengthDiffers =
    a.strength !== undefined &&
    b.strength !== undefined &&
    JSON.stringify(a.strength) !== JSON.stringify(b.strength);
  const packDiffers =
    a.pack !== undefined && b.pack !== undefined && a.pack.count !== b.pack.count;
  return strengthDiffers || packDiffers;
};

export const scorePair = (
  a: NormalizedRecord,
  b: NormalizedRecord,
  config: ScoringConfig = DEFAULT_CONFIG,
): Scored => {
  const weights: ComparisonWeight[] = [];
  let total = Math.log2(config.lambda / (1 - config.lambda));

  for (const comparison of COMPARISONS) {
    const levelName = comparison.evaluate(a, b);
    const level = findLevel(comparison, levelName);
    const weight = levelWeight(level);
    weights.push({ field: comparison.field, level: levelName, weight });
    total += weight;
  }

  const conflict = detectGtinConflict(a, b);

  return {
    leftId: a.id,
    rightId: b.id,
    weights,
    totalWeight: total,
    probability: probabilityFromWeight(total),
    // Конфликт по идентификатору уводит пару в зону разбора независимо от веса:
    // молчаливая склейка здесь хуже, чем задержка.
    zone: conflict ? 'possible' : zoneFor(total, config.thresholds),
    ...(conflict ? { conflict: 'same_gtin_different_products' as const } : {}),
  };
};

export const toDecision = (s: Scored): MatchDecision => ({
  leftId: s.leftId,
  rightId: s.rightId,
  totalWeight: s.totalWeight,
  probability: s.probability,
  zone: s.zone,
  decidedBy: 'fellegi_sunter',
  weights: s.weights,
  ...(s.conflict === undefined ? {} : { conflict: s.conflict }),
});

/** Разбор решения построчно — то, что показывается в `explain`. */
export const explainScored = (s: Scored): string => {
  const lines = s.weights
    .map((w) => `  ${w.field.padEnd(14)} ${w.level.padEnd(20)} ${w.weight >= 0 ? '+' : ''}${w.weight.toFixed(2)}`)
    .join('\n');
  return [
    `пара ${s.leftId} ↔ ${s.rightId}`,
    lines,
    `  ${'ИТОГО'.padEnd(35)} ${s.totalWeight.toFixed(2)}`,
    `  вероятность ${(s.probability * 100).toFixed(2)}%  зона: ${s.zone}`,
    ...(s.conflict === undefined ? [] : [`  КОНФЛИКТ: ${s.conflict}`]),
  ].join('\n');
};
