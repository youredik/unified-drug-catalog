/**
 * Миграции.
 *
 * Стратегия — expand/contract: сначала добавляем новое, потом переключаем
 * читателей, и только затем убираем старое. Это единственный способ катить
 * схему без окна простоя, когда воркеры и CLI работают одновременно.
 *
 * Расширение `pg_trgm` ставится ЗДЕСЬ, до применения файлов: триграммный
 * индекс по ядру бренда без него не создастся, а миграция упадёт на середине.
 */

import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Db } from './client.ts';

export const MIGRATIONS_DIR = new URL('../migrations/', import.meta.url).pathname;

export const runMigrations = async (db: Db): Promise<void> => {
  await db.pool.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
  await migrate(db.orm, { migrationsFolder: MIGRATIONS_DIR });
};
