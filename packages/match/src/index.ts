/**
 * Объединение дубликатов: блокировка, вероятностная модель, кластеризация
 * и правила выживания.
 *
 * Пакет не знает ни про БД, ни про транспорты, ни про очередь — это правило
 * проверяется гейтом `core-does-not-know-infrastructure`. Арбитр подключается
 * портом, поэтому языковую модель можно выключить, не тронув ни строки здесь.
 */

export * from './comparison.ts';
export * from './fellegi-sunter.ts';
export * from './blocking.ts';
export * from './clustering.ts';
export * from './survivorship.ts';
export * from './adjudicator.ts';
export * from './resolve.ts';
export * from './metrics.ts';
export * from './ground-truth.ts';
