/**
 * Контракт коннектора — точка расширения под рост числа источников.
 *
 * Добавление четвёртой аптечной сети должно стоить: манифест + этот интерфейс
 * + зелёный conformance-набор. Ни строчки в ядре. Именно это превращает
 * «каждый поставщик — отдельный интеграционный проект» в заполнение контракта.
 *
 * `toMappedFields` — это anti-corruption layer в терминах DDD: слой перевода,
 * который downstream строит, чтобы защитить свою модель от чужой. Он знает про
 * `dosage_mg`, `<dosageForm>` и `details.strength.value`; всё, что дальше,
 * про них уже не знает.
 */

import type {
  MappedFields, MappingError, ParseError, Result, SourceManifest,
} from '@catalog/domain';

export interface SourceConnector {
  readonly manifest: SourceManifest;

  /**
   * Потоково выдаёт сырые записи фида — по одной на товар.
   * Ошибка разбора отдельной записи не обрывает поток: она едет как `Err`
   * и попадёт в карантин, а остальные записи будут приняты.
   */
  readRecords(): AsyncIterable<Result<unknown, ParseError>>;

  /** Anti-corruption layer: сырая запись → канонические имена полей. */
  toMappedFields(payload: unknown): Result<MappedFields, MappingError>;
}

/** Утилита для ACL: безопасно достать вложенное значение. */
export const pick = (o: unknown, ...path: readonly string[]): unknown => {
  let cur: unknown = o;
  for (const key of path) {
    if (typeof cur !== 'object' || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
};

/** Приводит одиночный элемент к массиву: XML отдаёт объект при одном узле. */
export const asArray = (v: unknown): readonly unknown[] =>
  v === undefined || v === null ? [] : Array.isArray(v) ? v : [v];
