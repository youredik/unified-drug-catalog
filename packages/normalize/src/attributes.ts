/**
 * Нормализация остальных полей канона: лекформа, упаковка, рецептурность,
 * страна, дата регистрации.
 *
 * Общий принцип файла: словарь вместо эвристики. Каждое «умное» угадывание
 * здесь — это данные, которые тихо испортятся на четвёртом источнике.
 */

import {
  CountryCode, err, IsoDate, lookupCountry, lookupDoseForm, ok,
  type DateFormat, type DoseForm, type MappingError, type PackSize,
  type QualityFlag, type Result, type RxStatus,
} from '@catalog/domain';
import { asTrimmedText, describeValue } from './scalar.ts';

// ─── Лекарственная форма ─────────────────────────────────────────────────────

export interface NormalizedDoseForm {
  readonly doseForm: DoseForm;
  readonly flags: readonly QualityFlag[];
}

/**
 * `tablet`, `tablets`, `tabs` дают одну базовую форму TABLET.
 *
 * `Film-coated Tabs` даёт TABLET + уточнение FILM_COATED_TABLET, и уточнение
 * помечается как непроверенное: справочник EDQM его не подтверждает, а более
 * подробное значение вполне может оказаться просто неверным.
 * Матчинг сравнивает по basic; расхождение по full фиксируется конфликтом.
 */
export const normalizeDoseForm = (raw: unknown): Result<NormalizedDoseForm, MappingError> => {
  const text = asTrimmedText(raw);
  if (text === undefined) {
    return err({ kind: 'unknown_dose_form', raw: describeValue(raw) });
  }
  const found = lookupDoseForm(text);
  if (found === undefined) return err({ kind: 'unknown_dose_form', raw: text });
  const flags: QualityFlag[] = found.full === undefined ? [] : ['dose_form_refined_unverified'];
  return ok({ doseForm: found, flags });
};

/**
 * Подсказка о форме из свободного текста наименования.
 *
 * Реальный случай из данных: источник C кладёт в структурное поле
 * `packaging.type: "tabs"` (просто TABLET), а уточнение «Film-coated» прячет
 * в торговом наименовании — «Acmeflex Film-coated Tabs». Поставщики так делают
 * постоянно.
 *
 * Такое уточнение принимается, но помечается непроверенным — и правильно
 * делает: справочник уточнения не подтверждает, то есть подсказка
 * из текста здесь просто неверна. Она сохраняется как заявленное значение
 * и уходит в конфликт, а не назначается победителем «по специфичности».
 */
export const doseFormHintFromText = (text: string): DoseForm | undefined => {
  const normalized = text.toLowerCase().replace(/[-‐‑–—]/g, ' ').replace(/\s+/g, ' ').trim();
  const words = normalized.split(' ');
  // Длинные фразы вперёд: «film coated tabs» важнее, чем просто «tabs».
  for (let size = Math.min(4, words.length); size >= 1; size--) {
    for (let i = 0; i + size <= words.length; i++) {
      const phrase = words.slice(i, i + size).join(' ');
      const found = lookupDoseForm(phrase);
      if (found?.full !== undefined) return found;
    }
  }
  return undefined;
};

// ─── Упаковка ────────────────────────────────────────────────────────────────

export interface NormalizedPack {
  readonly pack: PackSize;
  readonly flags: readonly QualityFlag[];
}

/** Чего именно `count` штук, если источник этого не сказал. */
const presentationFromDoseForm = (doseForm: DoseForm | undefined): string =>
  doseForm === undefined ? 'Unit' : doseForm.basic.charAt(0) + doseForm.basic.slice(1).toLowerCase();

/**
 * `24`, `"24 tablets"`, `{ count: 24, type: "tabs" }` — одна упаковка.
 * Голое число получает единицу представления из лекформы, и это отмечается
 * флагом: вывод, а не факт от источника.
 */
export const normalizePack = (
  raw: unknown,
  doseForm: DoseForm | undefined,
): Result<NormalizedPack, MappingError> => {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return ok({
      pack: { count: raw, unitOfPresentation: presentationFromDoseForm(doseForm) },
      flags: ['pack_unit_inferred_from_dose_form'],
    });
  }

  if (typeof raw === 'object' && raw !== null && 'count' in raw) {
    const o = raw as { count: unknown; type?: unknown };
    const count = typeof o.count === 'number' ? o.count : Number(o.count);
    if (!Number.isFinite(count)) return err({ kind: 'unparseable_pack', raw: JSON.stringify(raw) });
    if (o.type === undefined) {
      return ok({
        pack: { count, unitOfPresentation: presentationFromDoseForm(doseForm) },
        flags: ['pack_unit_inferred_from_dose_form'],
      });
    }
    const typeText = asTrimmedText(o.type);
    if (typeText === undefined) {
      return ok({
        pack: { count, unitOfPresentation: presentationFromDoseForm(doseForm) },
        flags: ['pack_unit_inferred_from_dose_form'],
      });
    }
    const asForm = lookupDoseForm(typeText);
    const unit = asForm === undefined ? typeText : presentationFromDoseForm(asForm);
    return ok({ pack: { count, unitOfPresentation: unit }, flags: [] });
  }

  if (typeof raw === 'string' && raw.trim() !== '') {
    const m = /^(\d+)\s*(.*)$/.exec(raw.trim());
    if (m === null) return err({ kind: 'unparseable_pack', raw });
    const count = Number(m[1]);
    const rest = (m[2] ?? '').trim();
    if (rest === '') {
      return ok({
        pack: { count, unitOfPresentation: presentationFromDoseForm(doseForm) },
        flags: ['pack_unit_inferred_from_dose_form'],
      });
    }
    const asForm = lookupDoseForm(rest);
    return ok({
      pack: { count, unitOfPresentation: asForm === undefined ? rest : presentationFromDoseForm(asForm) },
      flags: [],
    });
  }

  return err({ kind: 'unparseable_pack', raw: describeValue(raw) });
};

// ─── Рецептурность ───────────────────────────────────────────────────────────

const TRUTHY = new Set(['true', 'yes', 'y', '1', 'да', 'rx', 'prescription']);
const FALSY = new Set(['false', 'no', 'n', '0', 'нет', 'otc']);

/**
 * Tri-state, и `unknown` НИКОГДА не схлопывается в `otc`.
 *
 * Данные дают три написания одного значения: `false`, `"false"`, `"no"`.
 * Но четвёртый источник может прислать пустоту или невнятицу — и вот тогда
 * разница принципиальна: потребитель каталога может принимать на этом решения
 * об отпуске, а дистанционная продажа рецептурных препаратов регулируется
 * отдельно. Неизвестное обязано остаться неизвестным.
 */
export const normalizeRxStatus = (raw: unknown): { readonly status: RxStatus; readonly flags: readonly QualityFlag[] } => {
  if (typeof raw === 'boolean') return { status: raw ? 'prescription' : 'otc', flags: [] };
  if (raw === null || raw === undefined) return { status: 'unknown', flags: ['rx_status_unknown'] };
  const key = (asTrimmedText(raw) ?? '').toLowerCase();
  if (TRUTHY.has(key)) return { status: 'prescription', flags: [] };
  if (FALSY.has(key)) return { status: 'otc', flags: [] };
  return { status: 'unknown', flags: ['rx_status_unknown'] };
};

// ─── Страна ──────────────────────────────────────────────────────────────────

export interface NormalizedCountry {
  readonly country: CountryCode;
  readonly flags: readonly QualityFlag[];
}

/** `GB`, `United Kingdom`, `UK` → `GB`. См. vocab/country.ts про ловушку `UK`. */
export const normalizeCountry = (raw: unknown): Result<NormalizedCountry, MappingError> => {
  const asString = asTrimmedText(raw);
  if (asString === undefined) {
    return err({ kind: 'unknown_country', raw: describeValue(raw) });
  }
  const code = lookupCountry(asString);
  if (code === undefined) return err({ kind: 'unknown_country', raw: asString });
  const flags: QualityFlag[] = code === asString.toUpperCase() ? [] : ['country_synonym_resolved'];
  return ok({ country: code, flags });
};

// ─── Дата ────────────────────────────────────────────────────────────────────

const PATTERNS: Readonly<Record<DateFormat, RegExp>> = {
  ISO_8601: /^(\d{4})-(\d{2})-(\d{2})/,
  'DD.MM.YYYY': /^(\d{2})\.(\d{2})\.(\d{4})$/,
  'MM/DD/YYYY': /^(\d{2})\/(\d{2})\/(\d{4})$/,
  'YYYY/MM/DD': /^(\d{4})\/(\d{2})\/(\d{2})$/,
  'DD/MM/YYYY': /^(\d{2})\/(\d{2})\/(\d{4})$/,
};

/** Реальность даты, а не только форма: 31.02.2023 обязана не пройти. */
const isRealDate = (y: number, m: number, d: number): boolean => {
  if (m < 1 || m > 12 || d < 1) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

/**
 * Формат объявляется в манифесте источника и не угадывается.
 *
 * `15.01.2023` разбирается однозначно — а `03.04.2023` нет: это и третье
 * апреля, и четвёртое марта. Эвристический парсер не ошибётся на данных
 * примера и тихо испортит данные на четвёртом источнике.
 */
export const normalizeDate = (
  raw: unknown,
  format: DateFormat,
): Result<IsoDate, MappingError> => {
  const asString = asTrimmedText(raw);
  if (asString === undefined) {
    return err({ kind: 'unparseable_date', raw: describeValue(raw), declaredFormat: format });
  }
  const m = PATTERNS[format].exec(asString);
  if (m === null) return err({ kind: 'unparseable_date', raw: asString, declaredFormat: format });

  let y: number, mo: number, d: number;
  switch (format) {
    case 'ISO_8601':
    case 'YYYY/MM/DD':
      [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
      break;
    case 'DD.MM.YYYY':
    case 'DD/MM/YYYY':
      [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
      break;
    case 'MM/DD/YYYY':
      [mo, d, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
      break;
  }

  if (!isRealDate(y, mo, d)) {
    return err({ kind: 'unparseable_date', raw: asString, declaredFormat: format });
  }
  const pad = (n: number): string => String(n).padStart(2, '0');
  return ok(IsoDate(`${y}-${pad(mo)}-${pad(d)}`));
};
