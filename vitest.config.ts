import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
    // Интеграционные тесты поднимают контейнер с базой и живут в отдельном
    // прогоне: обычная сборка не должна зависеть от наличия Docker.
    exclude: ['**/node_modules/**', '**/*.integration.test.ts'],
    // Часы фиксируются: golden-снапшот каталога обязан быть побайтово
    // стабильным между прогонами, иначе он ничего не проверяет.
    fakeTimers: { toFake: ['Date'] },
    reporters: ['default'],
  },
});
