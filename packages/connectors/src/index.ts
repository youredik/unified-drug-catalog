/**
 * Приём данных: транспорты, безопасные парсеры и anti-corruption layer
 * на каждого поставщика.
 *
 * Контекст Ingestion ничего не знает про объединение дубликатов — это
 * проверяется гейтом `connectors-do-not-know-matching`. Добавление источника
 * не должно требовать понимания матчинга.
 */

export * from './spi.ts';
export * from './sources.ts';
export * from './conformance.ts';
export * from './parsers/json.ts';
export * from './parsers/xml.ts';
export * from './transports/index.ts';
export { mapSourceA } from './acl/source-a.ts';
export { mapSourceB } from './acl/source-b.ts';
export { mapSourceC } from './acl/source-c.ts';
