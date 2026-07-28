/**
 * `pnpm db:migrate` — применить миграции.
 *
 * Миграции генерируются из схемы (`pnpm db:generate`), а не пишутся рядом
 * с ней: две записи одного и того же расходятся, и расхождение обнаруживается
 * на проде.
 */

import { openDb, runMigrations } from '@catalog/db';
import { databaseUrl, type CliOptions } from '../context.ts';

export const runDb = async (options: CliOptions): Promise<void> => {
  const url = databaseUrl(options);
  const db = openDb(url);
  try {
    await runMigrations(db);
    console.log(`миграции применены: ${url.replace(/\/\/[^@]*@/, '//***@')}`);
  } finally {
    await db.close();
  }
};
