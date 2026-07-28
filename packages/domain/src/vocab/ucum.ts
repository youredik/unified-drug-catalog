/**
 * Единицы измерения дозировки в кодах UCUM.
 *
 * Расхождение по единицам измерения — отдельная ось. Массы недостаточно:
 * ЕСКЛП вводит «потребительскую единицу» отдельным понятием именно для
 * препаратов, чья дозировка выражена концентрацией (мг/мл, МЕ/мл, проценты).
 * Поэтому канон держит три случая, а не один:
 *
 *   quantity  200 mg, 500 [IU]     — абсолютная величина
 *   ratio     5 mg / 1 mL          — концентрация
 *   percent   2 %                  — доля, частный случай ratio
 *
 * Приведение всего к массе теряет два случая из трёх.
 */

import { UcumCode } from '../brands.ts';

export type UnitKind = 'mass' | 'volume' | 'activity' | 'unit' | 'percent';

interface UnitDef {
  readonly code: string;
  readonly kind: UnitKind;
  /** Множитель к базовой единице своего вида: мг для массы, мл для объёма. */
  readonly toBase: number;
}

const UNITS: readonly UnitDef[] = [
  { code: 'ng', kind: 'mass', toBase: 1e-6 },
  { code: 'ug', kind: 'mass', toBase: 1e-3 },
  { code: 'mg', kind: 'mass', toBase: 1 },
  { code: 'g', kind: 'mass', toBase: 1e3 },
  { code: 'kg', kind: 'mass', toBase: 1e6 },
  { code: 'uL', kind: 'volume', toBase: 1e-3 },
  { code: 'mL', kind: 'volume', toBase: 1 },
  { code: 'L', kind: 'volume', toBase: 1e3 },
  { code: '[IU]', kind: 'activity', toBase: 1 },
  { code: '{unit}', kind: 'unit', toBase: 1 },
  { code: '%', kind: 'percent', toBase: 1 },
];

const BY_CODE: ReadonlyMap<string, UnitDef> = new Map(UNITS.map((u) => [u.code, u]));

/** Написание в источнике → код UCUM. Кириллица и латиница вперемешку — норма. */
const SYNONYMS: ReadonlyMap<string, string> = new Map([
  ['mg', 'mg'], ['milligram', 'mg'], ['milligrams', 'mg'], ['мг', 'mg'], ['миллиграмм', 'mg'],
  ['g', 'g'], ['gram', 'g'], ['grams', 'g'], ['гр', 'g'], ['г', 'g'], ['грамм', 'g'],
  ['mcg', 'ug'], ['ug', 'ug'], ['µg', 'ug'], ['мкг', 'ug'], ['микрограмм', 'ug'],
  ['ng', 'ng'], ['нг', 'ng'],
  ['kg', 'kg'], ['кг', 'kg'],
  ['ml', 'mL'], ['milliliter', 'mL'], ['millilitre', 'mL'], ['мл', 'mL'], ['миллилитр', 'mL'],
  ['l', 'L'], ['liter', 'L'], ['litre', 'L'], ['л', 'L'], ['литр', 'L'],
  ['µl', 'uL'], ['ul', 'uL'], ['мкл', 'uL'],
  // Международные единицы — биологическая активность, не масса
  ['iu', '[IU]'], ['i.u.', '[IU]'], ['ме', '[IU]'], ['м.е.', '[IU]'], ['международных единиц', '[IU]'],
  ['unit', '{unit}'], ['units', '{unit}'], ['ед', '{unit}'], ['единиц', '{unit}'],
  ['%', '%'], ['percent', '%'], ['процент', '%'], ['процентов', '%'],
]);

export const lookupUnit = (raw: string): UcumCode | undefined => {
  const key = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  const code = SYNONYMS.get(key);
  return code === undefined ? undefined : UcumCode(code);
};

export const unitKind = (code: UcumCode): UnitKind | undefined => BY_CODE.get(code)?.kind;

/**
 * Приводит величину к базовой единице своего вида — только для сравнения.
 * Оригинал не заменяется: `200 mg` и `0.2 g` сравнимы, но в каталог идёт то,
 * что прислал победивший источник.
 */
export const toBaseValue = (value: number, code: UcumCode): number | undefined => {
  const def = BY_CODE.get(code);
  return def === undefined ? undefined : value * def.toBase;
};

export const isKnownUnit = (code: string): boolean => BY_CODE.has(code);
