/**
 * Нормализация дозировки — ось, на которой ломается больше всего интеграций.
 *
 * Данные дают три записи одной величины:
 *   A  `dosage_mg: 200`                 число, единица неявная
 *   B  `<dosage>200 mg</dosage>`        строка
 *   C  `{ value: 200, unit: "mg" }`     объект
 *
 * Единица для A берётся из манифеста источника, а не угадывается по имени
 * поля: `dosage_mg` сегодня, `dose` завтра — и молчаливое предположение
 * превращается в неверные данные.
 *
 * И главное: массы недостаточно. ЕСКЛП вводит «потребительскую единицу»
 * отдельным понятием именно для препаратов, чья дозировка выражена
 * концентрацией (мг/мл, МЕ/мл, проценты). Канон держит два вида —
 * quantity и ratio, — потому что приведение всего к массе теряет
 * концентрацию и биологическую активность.
 */

import {
  err, lookupUnit, ok, UcumCode,
  type MappingError, type QualityFlag, type Quantity, type Result, type Strength,
} from '@catalog/domain';
import { asText, asTrimmedText, describeValue } from './scalar.ts';

export interface NormalizedStrength {
  readonly strength: Strength;
  readonly flags: readonly QualityFlag[];
}

/** `200`, `0,5`, `1.25` — запятая как десятичный разделитель тоже встречается. */
const parseNumber = (raw: string): number | undefined => {
  const n = Number(raw.trim().replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
};

const quantity = (value: number, unit: UcumCode): Quantity => ({ value, unit });

/**
 * `5 мг/мл`, `500 IU/ml`, `2 %` — концентрация. Числитель обязателен,
 * знаменатель по умолчанию 1 единица.
 */
const parseRatio = (raw: string): Strength | undefined => {
  const m = /^([\d.,]+)\s*([^/\s]+)\s*\/\s*([\d.,]*)\s*(.+)$/.exec(raw.trim());
  if (m === null) return undefined;
  const [, numValue, numUnitRaw, denValueRaw, denUnitRaw] = m;
  const nv = parseNumber(numValue!);
  const nu = lookupUnit(numUnitRaw!);
  const du = lookupUnit(denUnitRaw!);
  if (nv === undefined || nu === undefined || du === undefined) return undefined;
  const dv = denValueRaw !== undefined && denValueRaw !== '' ? parseNumber(denValueRaw) : 1;
  if (dv === undefined) return undefined;
  return { kind: 'ratio', numerator: quantity(nv, nu), denominator: quantity(dv, du) };
};

/** `200 mg`, `500 МЕ`, `2%` — абсолютная величина. */
const parseQuantity = (raw: string): Strength | undefined => {
  const m = /^([\d.,]+)\s*(.+)$/.exec(raw.trim());
  if (m === null) return undefined;
  const value = parseNumber(m[1]!);
  const unit = lookupUnit(m[2]!);
  if (value === undefined || unit === undefined) return undefined;
  return { kind: 'quantity', amount: quantity(value, unit) };
};

/**
 * @param raw            что прислал источник: число, строка или `{value, unit}`
 * @param defaultUnit    единица из манифеста — для источников, присылающих
 *                       голое число (случай A)
 */
export const normalizeStrength = (
  raw: unknown,
  defaultUnit: string | undefined,
): Result<NormalizedStrength, MappingError> => {
  // Случай A: голое число. Единица обязана быть объявлена в манифесте.
  if (typeof raw === 'number') {
    if (defaultUnit === undefined) {
      return err({ kind: 'unknown_unit', raw: `${raw} (единица не объявлена в манифесте)` });
    }
    const unit = lookupUnit(defaultUnit);
    if (unit === undefined) return err({ kind: 'unknown_unit', raw: defaultUnit });
    return ok({
      strength: { kind: 'quantity', amount: quantity(raw, unit) },
      flags: ['strength_unit_assumed_from_manifest'],
    });
  }

  // Случай C: объект `{ value, unit }`.
  if (typeof raw === 'object' && raw !== null && 'value' in raw) {
    const o = raw as { value: unknown; unit?: unknown };
    const value = typeof o.value === 'number' ? o.value : parseNumber(asText(o.value) ?? '');
    if (value === undefined) return err({ kind: 'unparseable_strength', raw: describeValue(raw) });
    const unitRaw = o.unit === undefined ? defaultUnit : asTrimmedText(o.unit);
    if (unitRaw === undefined) {
      return err({ kind: 'unknown_unit', raw: `${value} (единица не объявлена)` });
    }
    const unit = lookupUnit(unitRaw);
    if (unit === undefined) return err({ kind: 'unknown_unit', raw: unitRaw });
    return ok({ strength: { kind: 'quantity', amount: quantity(value, unit) }, flags: [] });
  }

  // Случай B: строка. Сперва концентрация, потом абсолютная величина —
  // иначе `5 мг/мл` разберётся как `5 мг` с мусорным хвостом.
  if (typeof raw === 'string' && raw.trim() !== '') {
    const ratio = parseRatio(raw);
    if (ratio !== undefined) return ok({ strength: ratio, flags: [] });
    const qty = parseQuantity(raw);
    if (qty !== undefined) return ok({ strength: qty, flags: [] });
    return err({ kind: 'unparseable_strength', raw });
  }

  return err({ kind: 'unparseable_strength', raw: describeValue(raw) });
};

/**
 * Сравнимое представление: величина в базовой единице своего вида.
 * `200 mg` и `0.2 g` дают одно число — но в каталог идёт то, что прислал
 * победивший источник, а не пересчёт.
 */
export const comparableStrength = (s: Strength): string => {
  if (s.kind === 'quantity') {
    return `q:${s.amount.value}:${s.amount.unit}`;
  }
  const ratio = s.numerator.value / s.denominator.value;
  return `r:${ratio}:${s.numerator.unit}/${s.denominator.unit}`;
};
