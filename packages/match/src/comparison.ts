/**
 * Сравнения полей и их веса в модели Fellegi–Sunter.
 *
 * Для каждого поля объявлены уровни сравнения, и у каждого уровня — пара
 * вероятностей:
 *
 *   m = P(наблюдать этот уровень | записи ОБ ОДНОМ товаре)   — качество данных
 *   u = P(наблюдать этот уровень | записи о РАЗНЫХ товарах)  — вероятность совпасть случайно
 *
 * Вес уровня = log2(m/u). Веса складываются, потому что поля считаются
 * условно независимыми.
 *
 * ГЛАВНОЕ РЕШЕНИЕ ЭТОГО ФАЙЛА — уровень `equal_but_invalid` у идентификатора.
 * Совпадение по валидному GTIN почти доказывает тождество (u крайне мал:
 * случайно совпасть 14 цифрами нельзя). Совпадение по идентификатору,
 * НЕ прошедшему контрольную сумму, — свидетельство заметно более слабое:
 * такая строка могла родиться из общей ошибки выгрузки, из копипасты между
 * поставщиками или из тестовых данных. Поэтому флаг качества входит
 * в математику, а не в лог: он меняет отношение m/u, а не пишется в сторонке.
 *
 * Значения m/u заданы из доменных соображений. На трёх записях их нельзя
 * оценить статистически (EM требует объёмов), поэтому они объявлены явно,
 * прокомментированы и калибруются по размеченному набору — см. metrics.ts.
 */

import type { NormalizedRecord } from '@catalog/domain';
import { comparableStrength, organizationKey, moreSpecificOrganization } from '@catalog/normalize';

export interface Level {
  readonly name: string;
  readonly m: number;
  readonly u: number;
}

export interface FieldComparison {
  readonly field: string;
  readonly levels: readonly Level[];
  readonly evaluate: (a: NormalizedRecord, b: NormalizedRecord) => string;
}

/** Вес уровня: log2(m/u). Положительный — за совпадение, отрицательный — против. */
export const levelWeight = (l: Level): number => Math.log2(l.m / l.u);

// ─── Триграммное сходство ────────────────────────────────────────────────────

export const trigrams = (s: string): ReadonlySet<string> => {
  const padded = `  ${s} `;
  const out = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  return out;
};

/** Жаккар по триграммам — та же мера, что даёт `pg_trgm` в Postgres. */
export const trigramSimilarity = (a: string, b: string): number => {
  if (a === '' && b === '') return 1;
  const ta = trigrams(a);
  const tb = trigrams(b);
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  const union = ta.size + tb.size - shared;
  return union === 0 ? 0 : shared / union;
};

// ─── Сравнения по полям ──────────────────────────────────────────────────────

const GTIN_LEVELS: readonly Level[] = [
  // Совпали, и контрольная сумма сошлась: случайное совпадение 14 цифр
  // практически исключено.
  { name: 'equal_and_valid', m: 0.92, u: 0.000_01 },
  // Совпали, но контрольная сумма НЕ сошлась. Свидетельство слабее на порядки:
  // строка могла разойтись по поставщикам вместе с ошибкой.
  { name: 'equal_but_invalid', m: 0.9, u: 0.002 },
  // Оба присутствуют и различаются — сильный довод ПРОТИВ тождества.
  { name: 'different', m: 0.04, u: 0.9 },
  // Хотя бы у одного нет: наблюдение неинформативно, вес около нуля.
  { name: 'missing', m: 0.06, u: 0.098 },
];

const gtinComparison: FieldComparison = {
  field: 'gtin',
  levels: GTIN_LEVELS,
  evaluate: (a, b) => {
    if (a.gtin === undefined || b.gtin === undefined) return 'missing';
    if (a.gtin !== b.gtin) return 'different';
    return a.gtinValid && b.gtinValid ? 'equal_and_valid' : 'equal_but_invalid';
  },
};

const BRAND_LEVELS: readonly Level[] = [
  { name: 'exact', m: 0.82, u: 0.003 },
  { name: 'similar', m: 0.14, u: 0.02 },
  { name: 'different', m: 0.03, u: 0.967 },
  { name: 'missing', m: 0.01, u: 0.01 },
];

const brandComparison: FieldComparison = {
  field: 'brandKey',
  levels: BRAND_LEVELS,
  evaluate: (a, b) => {
    if (a.brandKey === '' || b.brandKey === '') return 'missing';
    if (a.brandKey === b.brandKey) return 'exact';
    return trigramSimilarity(a.brandKey, b.brandKey) >= 0.6 ? 'similar' : 'different';
  },
};

const STRENGTH_LEVELS: readonly Level[] = [
  { name: 'exact', m: 0.94, u: 0.08 },
  // Разная дозировка при том же бренде — это РАЗНЫЕ товарные позиции.
  // Один из немногих признаков, который уверенно разводит близкие записи.
  { name: 'different', m: 0.02, u: 0.85 },
  { name: 'missing', m: 0.04, u: 0.07 },
];

const strengthComparison: FieldComparison = {
  field: 'strength',
  levels: STRENGTH_LEVELS,
  evaluate: (a, b) => {
    if (a.strength === undefined || b.strength === undefined) return 'missing';
    return comparableStrength(a.strength) === comparableStrength(b.strength) ? 'exact' : 'different';
  },
};

const DOSE_FORM_LEVELS: readonly Level[] = [
  { name: 'exact_basic', m: 0.93, u: 0.25 },
  { name: 'different', m: 0.04, u: 0.68 },
  { name: 'missing', m: 0.03, u: 0.07 },
];

const doseFormComparison: FieldComparison = {
  field: 'doseForm',
  levels: DOSE_FORM_LEVELS,
  // Сравнение идёт по БАЗОВОЙ форме. Уточнение (`full`) не участвует в решении:
  // источник C заявил уточнение, не подтверждённое справочником, — то есть
  // уточнение бывает не более точным, а просто неверным. Расхождение по `full`
  // фиксируется как конфликт в правилах выживания, а не как довод против пары.
  evaluate: (a, b) => {
    if (a.doseForm === undefined || b.doseForm === undefined) return 'missing';
    return a.doseForm.basic === b.doseForm.basic ? 'exact_basic' : 'different';
  },
};

const PACK_LEVELS: readonly Level[] = [
  { name: 'exact', m: 0.9, u: 0.12 },
  // Та же дозировка и форма, но другая упаковка — разные позиции каталога.
  { name: 'different', m: 0.05, u: 0.8 },
  { name: 'missing', m: 0.05, u: 0.08 },
];

const packComparison: FieldComparison = {
  field: 'pack',
  levels: PACK_LEVELS,
  evaluate: (a, b) => {
    if (a.pack === undefined || b.pack === undefined) return 'missing';
    return a.pack.count === b.pack.count ? 'exact' : 'different';
  },
};

const ORG_LEVELS: readonly Level[] = [
  { name: 'exact', m: 0.55, u: 0.02 },
  // «Acme Pharma» и «Acme Pharma Healthcare» — одна группа,
  // разная степень подробности. Это довод ЗА, но слабее точного совпадения.
  { name: 'one_extends_other', m: 0.33, u: 0.01 },
  { name: 'different', m: 0.08, u: 0.95 },
  { name: 'missing', m: 0.04, u: 0.02 },
];

const organizationComparison: FieldComparison = {
  field: 'organization',
  levels: ORG_LEVELS,
  evaluate: (a, b) => {
    if (a.manufacturerRaw === '' || b.manufacturerRaw === '') return 'missing';
    const ka = organizationKey(a.manufacturerRaw);
    const kb = organizationKey(b.manufacturerRaw);
    if (ka === kb) return 'exact';
    if (moreSpecificOrganization(a.manufacturerRaw, b.manufacturerRaw) !== undefined) {
      return 'one_extends_other';
    }
    return 'different';
  },
};

export const COMPARISONS: readonly FieldComparison[] = [
  gtinComparison,
  brandComparison,
  strengthComparison,
  doseFormComparison,
  packComparison,
  organizationComparison,
];

export const findLevel = (c: FieldComparison, name: string): Level => {
  const level = c.levels.find((l) => l.name === name);
  if (level === undefined) throw new Error(`уровень «${name}» не объявлен для поля ${c.field}`);
  return level;
};
