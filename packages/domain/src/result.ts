/**
 * Ошибка как значение, а не исключение.
 *
 * Правило: через границы пакетов ничего не бросается. Доменная неудача —
 * это `Err` с типизированной причиной, которая доезжает до карантина и отчёта
 * качества. `throw` остаётся только для нарушенных инвариантов (баг в коде).
 */

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

export const isOk = <T, E>(r: Result<T, E>): r is Ok<T> => r.ok;
export const isErr = <T, E>(r: Result<T, E>): r is Err<E> => !r.ok;

export const map = <T, U, E>(r: Result<T, E>, f: (v: T) => U): Result<U, E> =>
  r.ok ? ok(f(r.value)) : r;

export const flatMap = <T, U, E, F>(
  r: Result<T, E>,
  f: (v: T) => Result<U, F>,
): Result<U, E | F> => (r.ok ? f(r.value) : r);

/** Разделяет поток на успешные значения и ошибки — обе половины нужны. */
export const partition = <T, E>(
  results: readonly Result<T, E>[],
): { readonly values: T[]; readonly errors: E[] } => {
  const values: T[] = [];
  const errors: E[] = [];
  for (const r of results) {
    if (r.ok) values.push(r.value);
    else errors.push(r.error);
  }
  return { values, errors };
};

/** Только для нарушенных инвариантов: если это сработало — в коде баг. */
export const unwrap = <T, E>(r: Result<T, E>, context: string): T => {
  if (r.ok) return r.value;
  throw new Error(`${context}: ${JSON.stringify(r.error)}`);
};
