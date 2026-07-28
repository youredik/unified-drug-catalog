/**
 * Метрики качества матчинга и свип по порогам.
 *
 * Зачем это отдельным модулем, а не парой строк в тесте: три записи об одном
 * товаре не доказывают ничего — на них любой матчинг даёт 100%. Осмысленная
 * оценка возможна только против размеченного набора, где есть ТРУДНЫЕ
 * ОТРИЦАТЕЛЬНЫЕ: пары, которые выглядят как дубликаты и таковыми не являются.
 *
 * Здесь же живёт свип по порогам. Пороги `upper`/`lower` — не константы
 * из головы: они выбираются по кривой на размеченном наборе, и этот выбор
 * должен быть воспроизводим.
 */

import type { NormalizedRecord } from '@catalog/domain';
import { scorePair, zoneFor, type ScoringConfig, DEFAULT_CONFIG } from './fellegi-sunter.ts';
import { requestKey, type AdjudicationRequest, type AdjudicatorPort, type Verdict } from './adjudicator.ts';

/** Пара с известным ответом. `true` — это один и тот же товар. */
export interface LabelledPair {
  readonly name: string;
  readonly left: NormalizedRecord;
  readonly right: NormalizedRecord;
  readonly isMatch: boolean;
  /** Почему пара трудная — попадает в отчёт, чтобы провал был читаемым. */
  readonly rationale: string;
}

export interface ConfusionMatrix {
  readonly truePositive: number;
  readonly falsePositive: number;
  readonly trueNegative: number;
  readonly falseNegative: number;
  /** Пары, оставшиеся в зоне неопределённости: ни да, ни нет. */
  readonly undecided: number;
}

export interface Metrics extends ConfusionMatrix {
  readonly precision: number;
  readonly recall: number;
  readonly f1: number;
  readonly total: number;
}

const ratio = (num: number, den: number): number => (den === 0 ? 0 : num / den);

export const computeMetrics = (m: ConfusionMatrix, total: number): Metrics => {
  const precision = ratio(m.truePositive, m.truePositive + m.falsePositive);
  const recall = ratio(m.truePositive, m.truePositive + m.falseNegative);
  return {
    ...m,
    precision,
    recall,
    f1: ratio(2 * precision * recall, precision + recall),
    total,
  };
};

export interface EvaluationRow {
  readonly pair: LabelledPair;
  readonly weight: number;
  readonly zone: 'match' | 'possible' | 'non_match';
  readonly correct: boolean | 'undecided';
}

export interface Evaluation {
  readonly metrics: Metrics;
  readonly rows: readonly EvaluationRow[];
  /** Пары, на которых модель ошиблась — то, с чего начинается разбор. */
  readonly failures: readonly EvaluationRow[];
}

export const evaluate = (
  pairs: readonly LabelledPair[],
  config: ScoringConfig = DEFAULT_CONFIG,
): Evaluation => {
  const counts = { truePositive: 0, falsePositive: 0, trueNegative: 0, falseNegative: 0, undecided: 0 };
  const rows: EvaluationRow[] = [];

  for (const pair of pairs) {
    const scored = scorePair(pair.left, pair.right, config);
    // Конфликт по идентификатору намеренно уводит пару в разбор; для метрик
    // это «не решено», а не ошибка — система не обязана решать за поставщика.
    const zone = scored.zone;

    let correct: boolean | 'undecided';
    if (zone === 'possible') {
      counts.undecided++;
      correct = 'undecided';
    } else if (zone === 'match') {
      if (pair.isMatch) { counts.truePositive++; correct = true; }
      else { counts.falsePositive++; correct = false; }
    } else {
      if (pair.isMatch) { counts.falseNegative++; correct = false; }
      else { counts.trueNegative++; correct = true; }
    }

    rows.push({ pair, weight: scored.totalWeight, zone, correct });
  }

  return {
    metrics: computeMetrics(counts, pairs.length),
    rows,
    failures: rows.filter((r) => r.correct === false),
  };
};

export interface SweepPoint {
  readonly upper: number;
  readonly lower: number;
  readonly metrics: Metrics;
}

/**
 * Свип по порогам: показывает, чем платим за каждое движение планки.
 * Поднять `upper` — меньше ложноположительных и больше неопределённости;
 * опустить — наоборот.
 */
export const sweepThresholds = (
  pairs: readonly LabelledPair[],
  base: ScoringConfig = DEFAULT_CONFIG,
  uppers: readonly number[] = [4, 6, 8, 10, 12, 14],
  gap = 6,
): readonly SweepPoint[] =>
  uppers.map((upper) => {
    const lower = upper - gap;
    const config: ScoringConfig = { ...base, thresholds: { upper, lower } };
    return { upper, lower, metrics: evaluate(pairs, config).metrics };
  });

/** Лучшая точка по F1; при равенстве предпочитается меньшая неопределённость. */
export const bestByF1 = (points: readonly SweepPoint[]): SweepPoint | undefined =>
  [...points].sort((a, b) => {
    const d = b.metrics.f1 - a.metrics.f1;
    return d !== 0 ? d : a.metrics.undecided - b.metrics.undecided;
  })[0];

export { zoneFor };

// ─── Замер вклада арбитра ────────────────────────────────────────────────────

/**
 * Прогоняет размеченный набор ДВАЖДЫ — с арбитром и без — и возвращает разницу.
 *
 * Это единственный честный способ ответить на вопрос «а языковая модель вообще
 * помогает». Без зафиксированной базовой линии любое «стало лучше» — вера.
 * Здесь же видно и цену: сколько пар ушло к модели и сколько она разобрала.
 */
export interface ContributionReport {
  readonly baseline: Metrics;
  readonly withAdjudicator: Metrics;
  readonly greyZoneSize: number;
  readonly adjudicated: number;
  readonly resolvedCorrectly: number;
  readonly resolvedIncorrectly: number;
  readonly adjudicatorName: string;
  readonly verdicts: readonly {
    readonly pair: string;
    readonly expected: boolean;
    readonly verdict: Verdict;
    readonly correct: boolean;
  }[];
}

export const measureContribution = async (
  pairs: readonly LabelledPair[],
  adjudicator: AdjudicatorPort,
  config: ScoringConfig = DEFAULT_CONFIG,
): Promise<ContributionReport> => {
  const baseline = evaluate(pairs, config);

  const grey: { pair: LabelledPair; request: AdjudicationRequest }[] = [];
  for (const pair of pairs) {
    const scored = scorePair(pair.left, pair.right, config);
    if (scored.zone === 'possible' && scored.conflict === undefined) {
      grey.push({ pair, request: { left: pair.left, right: pair.right, scored } });
    }
  }

  const verdicts = grey.length === 0
    ? new Map<string, Verdict>()
    : await adjudicator.adjudicate(grey.map((g) => g.request));

  const counts = { truePositive: 0, falsePositive: 0, trueNegative: 0, falseNegative: 0, undecided: 0 };
  const detail: ContributionReport['verdicts'] = [];
  let resolvedCorrectly = 0;
  let resolvedIncorrectly = 0;

  for (const pair of pairs) {
    const scored = scorePair(pair.left, pair.right, config);
    let zone = scored.zone;

    if (zone === 'possible' && scored.conflict === undefined) {
      const verdict = verdicts.get(requestKey(pair.left.id, pair.right.id));
      if (verdict !== undefined) {
        zone = verdict.isMatch ? 'match' : 'non_match';
        const correct = verdict.isMatch === pair.isMatch;
        if (correct) resolvedCorrectly++;
        else resolvedIncorrectly++;
        (detail as { pair: string; expected: boolean; verdict: Verdict; correct: boolean }[]).push({
          pair: pair.name, expected: pair.isMatch, verdict, correct,
        });
      }
    }

    if (zone === 'possible') {
      counts.undecided++;
    } else if (zone === 'match') {
      if (pair.isMatch) counts.truePositive++;
      else counts.falsePositive++;
    } else {
      if (pair.isMatch) counts.falseNegative++;
      else counts.trueNegative++;
    }
  }

  return {
    baseline: baseline.metrics,
    withAdjudicator: computeMetrics(counts, pairs.length),
    greyZoneSize: grey.length,
    adjudicated: verdicts.size,
    resolvedCorrectly,
    resolvedIncorrectly,
    adjudicatorName: adjudicator.name,
    verdicts: detail,
  };
};
