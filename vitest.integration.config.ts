import { defineConfig } from 'vitest/config';

/**
 * Интеграционные тесты: живой PostgreSQL через Testcontainers.
 *
 * Отдельный конфиг, а не флаг, потому что у них другой профиль: контейнер
 * поднимается один на файл, таймауты минутные, последовательный запуск.
 */
export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.integration.test.ts', 'apps/*/src/**/*.integration.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 180_000,
    fileParallelism: false,
    reporters: ['default'],
  },
});
