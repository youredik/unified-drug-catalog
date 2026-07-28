/**
 * Нормализация GTIN.
 *
 * Главное решение этого файла: **невалидная контрольная цифра не отбрасывает
 * запись**. В предоставленных данных `05050123456789` не проходит MOD-10 —
 * взвешенная сумма первых 13 цифр даёт 86, значит контрольная должна быть 4,
 * а стоит 9 (одинаково при трактовке и как GTIN-13, и как GTIN-14). Валидация
 * «проверить и отбросить» уничтожила бы весь датасет.
 *
 * Поэтому идентификатор понижается в роли, а не отбрасывается:
 *   валидный    — основание утверждать тождество двух записей;
 *   невалидный  — только основание СРАВНИТЬ: собирает кандидатов в блок,
 *                 а решение принимает полное сравнение полей.
 *
 * Флаг качества дальше входит в математику матчинга, а не в лог: совпадение
 * по невалидному идентификатору даёт заметно меньший вес (см. packages/match).
 *
 * Хранение в 14 знаках — рекомендация GS1: GTIN-8/12/13 выравниваются вправо
 * и дополняются нулями слева.
 */

import { Gtin14, type QualityFlag } from '@catalog/domain';
import { asTrimmedText } from './scalar.ts';

export interface NormalizedGtin {
  readonly gtin: Gtin14 | undefined;
  readonly valid: boolean;
  readonly flags: readonly QualityFlag[];
}

/** Длины, из которых можно собрать GTIN. Всё остальное — не идентификатор. */
const VALID_LENGTHS = new Set([8, 12, 13, 14]);

/**
 * Контрольная цифра по MOD-10 (GS1): от правой цифры данных влево веса 3,1,3,1…
 * Алгоритм проверен на заведомо валидных штрихкодах — см. gtin.test.ts.
 */
export const computeCheckDigit = (body: string): number => {
  let sum = 0;
  for (let i = body.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) {
    sum += Number(body[i]) * w;
  }
  return (10 - (sum % 10)) % 10;
};

export const isValidGtin = (digits: string): boolean => {
  if (!VALID_LENGTHS.has(digits.length)) return false;
  const body = digits.slice(0, -1);
  const given = Number(digits.slice(-1));
  return computeCheckDigit(body) === given;
};

/** Выравнивание вправо с дополнением нулями до 14 знаков (рекомендация GS1). */
export const toGtin14 = (digits: string): Gtin14 => Gtin14(digits.padStart(14, '0'));

/**
 * `05050123456789`, `0505-0123-4567-89` и `05050123456789 ` — один идентификатор.
 * Разделители снимаются, но факт их наличия отмечается флагом: это сигнал
 * о качестве выгрузки поставщика.
 */
export const normalizeGtin = (raw: unknown): NormalizedGtin => {
  // Структура вместо скаляра — то же самое, что отсутствие: разбирать нечего,
  // а `String(объект)` дал бы «[object Object]» и увёл бы в разбор мусора.
  const asString = asTrimmedText(raw);
  if (asString === undefined) {
    return { gtin: undefined, valid: false, flags: ['gtin_absent'] };
  }

  const digits = asString.replace(/\D/g, '');
  const flags: QualityFlag[] = [];

  if (digits.length !== asString.length) flags.push('gtin_non_numeric_stripped');

  if (digits.length === 0) {
    return { gtin: undefined, valid: false, flags: [...flags, 'gtin_absent'] };
  }

  if (!VALID_LENGTHS.has(digits.length)) {
    // Что-то было, но идентификатором быть не может. Не молчим: запись
    // принимается, но факт виден в отчёте качества.
    return { gtin: undefined, valid: false, flags: [...flags, 'gtin_malformed'] };
  }

  const valid = isValidGtin(digits);
  if (!valid) flags.push('gtin_check_digit_invalid');

  return { gtin: toGtin14(digits), valid, flags };
};
