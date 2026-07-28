/**
 * Императивная оболочка: приём, хранение, выгрузка и отчётность.
 *
 * Всё, что здесь есть, — порядок вызовов и работа с внешним миром. Правила
 * нормализации и матчинга живут в чистом ядре и сюда не протекают; обратное
 * направление запрещено гейтом `core-does-not-know-infrastructure`.
 */

export * from './ports.ts';
export * from './ingest.ts';
export * from './run.ts';
export * from './serialize.ts';
export * from './report.ts';
export * from './explain.ts';
export * from './diff.ts';
export * from './store/memory.ts';
export * from './store/file.ts';
export * from './store/postgres.ts';
export * from './worker.ts';
