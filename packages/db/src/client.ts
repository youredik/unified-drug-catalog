/**
 * Подключение к базе и валидация конфигурации.
 *
 * Конфигурация проверяется НА СТАРТЕ, а не в момент первого запроса: сервис,
 * поднявшийся с опечаткой в строке подключения и упавший через час на первой
 * джобе, — худший из возможных вариантов.
 */

import { z } from 'zod';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema.ts';

const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .refine((v) => v.startsWith('postgres://') || v.startsWith('postgresql://'), {
      message: 'DATABASE_URL должен быть строкой подключения PostgreSQL',
    }),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
});

export type DbEnv = z.infer<typeof envSchema>;

export const readEnv = (env: NodeJS.ProcessEnv = process.env): DbEnv => {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`конфигурация базы неверна — ${detail}`);
  }
  return parsed.data;
};

export interface Db {
  readonly orm: ReturnType<typeof drizzle<typeof schema>>;
  readonly pool: pg.Pool;
  close(): Promise<void>;
}

export const openDb = (connectionString?: string): Db => {
  const env = connectionString === undefined
    ? readEnv()
    : readEnv({ ...process.env, DATABASE_URL: connectionString });

  const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: env.DB_POOL_MAX });
  return {
    orm: drizzle(pool, { schema }),
    pool,
    close: () => pool.end(),
  };
};

export { schema };
