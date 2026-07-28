import { defineConfig } from 'drizzle-kit';

/**
 * Миграции ГЕНЕРИРУЮТСЯ из схемы, а не пишутся руками рядом с ней: иначе
 * схема и DDL расходятся, и расхождение обнаруживается на проде.
 *
 * `pnpm db:generate` — сгенерировать миграцию после правки схемы.
 * `pnpm db:migrate`  — применить к базе из DATABASE_URL.
 */
export default defineConfig({
  schema: './packages/db/src/schema.ts',
  out: './packages/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? 'postgres://catalog:catalog@localhost:55432/catalog',
  },
  strict: true,
});
