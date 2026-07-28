/**
 * Приведение недоверенного значения к тексту.
 *
 * `String(x)` на объекте даёт `"[object Object]"` — строку, которая выглядит
 * как данные: она уходит в парсер, в сообщение об ошибке и в карантин, и по
 * ней уже не понять, что поставщик прислал структуру там, где ждали скаляр.
 * Поэтому «скаляр» и «не скаляр» различаются явно.
 *
 * Разделение на две функции намеренное:
 *   `asText`        — значение для разбора; для структуры его нет
 *   `describeValue` — читаемое описание для отчёта; есть всегда
 */

/** Текст для разбора. Для объектов, массивов и функций — `undefined`. */
export const asText = (raw: unknown): string | undefined => {
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number') return Number.isFinite(raw) ? String(raw) : undefined;
  if (typeof raw === 'bigint' || typeof raw === 'boolean') return String(raw);
  return undefined;
};

/** То же со срезанными краевыми пробелами; пустая строка считается отсутствием. */
export const asTrimmedText = (raw: unknown): string | undefined => {
  const text = asText(raw)?.trim();
  return text === undefined || text === '' ? undefined : text;
};

/**
 * Описание значения для сообщения об ошибке и карантина. В отличие от
 * `asText` не теряет структуру: по отчёту должно быть видно, что именно
 * прислал источник.
 */
export const describeValue = (raw: unknown): string => {
  const text = asText(raw);
  if (text !== undefined) return text;
  if (raw === null) return 'null';
  if (raw === undefined) return 'undefined';
  try {
    return JSON.stringify(raw) ?? `(${typeof raw})`;
  } catch {
    return `(${typeof raw})`;
  }
};
