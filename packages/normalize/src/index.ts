/**
 * Правила нормализации. Чистые функции, ноль I/O — это проверяется гейтом
 * `core-has-no-io` в CI, а не обещанием в README.
 *
 * Именно чистота делает возможными property-тесты: идемпотентность
 * нормализации и независимость результата от порядка источников проверяются
 * на сгенерированных данных, без БД и без моков.
 */

export * from './gtin.ts';
export * from './strength.ts';
export * from './attributes.ts';
export * from './naming.ts';
export * from './record.ts';
export * from './scalar.ts';
