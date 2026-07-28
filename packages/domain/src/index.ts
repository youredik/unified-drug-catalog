/**
 * Published Language — общий словарь между контекстами Ingestion, Catalog
 * и Delivery. Ни один контекст не импортирует внутренности другого; всё
 * общение идёт через типы отсюда.
 *
 * Пакет не зависит ни от чего в проекте. Это проверяется гейтом в CI, а не
 * договорённостью.
 */

export * from './result.ts';
export * from './brands.ts';
export * from './model.ts';
export * from './errors.ts';
export * from './manifest.ts';
export * from './vocab/country.ts';
export * from './vocab/dose-form.ts';
export * from './vocab/ucum.ts';
export * from './vocab/translit.ts';
