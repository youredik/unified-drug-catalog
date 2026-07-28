/**
 * ISO 3166-1 alpha-2 со словарём синонимов.
 *
 * Ловушка данных: `UK` — НЕ валидный alpha-2. Канонический код Великобритании
 * `GB`; `UK` лишь exceptionally reserved на запрос самой страны. Эвристика
 * «взять первые две буквы» здесь даёт неверный код, поэтому только словарь.
 *
 * Подмножество под данные; расширяется добавлением строк в таблицу.
 */

import { CountryCode } from '../brands.ts';

/** Синоним (в нижнем регистре, схлопнутые пробелы) → канонический alpha-2. */
const SYNONYMS: ReadonlyMap<string, string> = new Map([
  // Великобритания — ловушка из примера
  ['gb', 'GB'],
  ['uk', 'GB'], // exceptionally reserved, но не alpha-2
  ['gbr', 'GB'],
  ['826', 'GB'],
  ['united kingdom', 'GB'],
  ['great britain', 'GB'],
  ['united kingdom of great britain and northern ireland', 'GB'],
  ['великобритания', 'GB'],
  ['соединенное королевство', 'GB'],

  ['ru', 'RU'],
  ['rus', 'RU'],
  ['643', 'RU'],
  ['russia', 'RU'],
  ['russian federation', 'RU'],
  ['россия', 'RU'],
  ['российская федерация', 'RU'],

  ['de', 'DE'],
  ['deu', 'DE'],
  ['germany', 'DE'],
  ['германия', 'DE'],

  ['fr', 'FR'],
  ['fra', 'FR'],
  ['france', 'FR'],
  ['франция', 'FR'],

  ['us', 'US'],
  ['usa', 'US'],
  ['united states', 'US'],
  ['united states of america', 'US'],
  ['сша', 'US'],

  ['in', 'IN'],
  ['ind', 'IN'],
  ['india', 'IN'],
  ['индия', 'IN'],

  ['ch', 'CH'],
  ['che', 'CH'],
  ['switzerland', 'CH'],
  ['швейцария', 'CH'],

  ['it', 'IT'],
  ['ita', 'IT'],
  ['italy', 'IT'],
  ['италия', 'IT'],

  ['hu', 'HU'],
  ['hun', 'HU'],
  ['hungary', 'HU'],
  ['венгрия', 'HU'],

  ['si', 'SI'],
  ['svn', 'SI'],
  ['slovenia', 'SI'],
  ['словения', 'SI'],

  ['by', 'BY'],
  ['blr', 'BY'],
  ['belarus', 'BY'],
  ['беларусь', 'BY'],
  ['белоруссия', 'BY'],
]);

/** Коды, которые часто путают с alpha-2, но таковыми не являются. */
export const RESERVED_NOT_ALPHA2: ReadonlySet<string> = new Set(['UK', 'EU', 'SU']);

export const lookupCountry = (raw: string): CountryCode | undefined => {
  const key = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  const code = SYNONYMS.get(key);
  return code === undefined ? undefined : CountryCode(code);
};

export const knownCountrySynonyms = (): number => SYNONYMS.size;
