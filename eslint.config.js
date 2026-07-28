// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Линтер здесь не про стиль — форматирование не спорный вопрос, и правила
 * про пробелы только шумят. Он про то, что строгий компилятор не ловит:
 * забытый `await`, промис, брошенный без обработки, сужение типа через `any`.
 *
 * Правила с проверкой типов (`recommendedTypeChecked`) включены намеренно,
 * хотя они медленнее: именно они находят ошибки в асинхронном коде, а весь
 * приём и хранение здесь асинхронные.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'out/**',
      // Сгенерированный DDL и конфиг dependency-cruiser: не наш исходник.
      'packages/db/migrations/**',
      '.dependency-cruiser.cjs',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Неиспользованное — ошибка, но подчёркивание разрешает осознанно
      // проигнорировать аргумент, не ломая сигнатуру.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Плавающий промис в конвейере — потерянная запись или потерянная
      // ошибка. Именно то, ради чего линтер с типами здесь и стоит.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      // `any` не запрещён полностью: на границе с jsonb и внешними SDK он
      // неизбежен. Но каждое появление должно быть видно в ревью.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Выключено осознанно. Порт хранилища асинхронный, потому что одна
      // из его реализаций ходит в базу; реализация в памяти при этом
      // синхронна и `await` внутри ей не нужен. Требовать его — значит
      // требовать фиктивный await ради линтера.
      '@typescript-eslint/require-await': 'off',
    },
  },

  {
    // Тесты живут по другим правилам: там утверждения намеренно грубые,
    // а приведение типов — способ построить заведомо неверный вход.
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  {
    files: ['*.config.js', '*.config.ts', 'drizzle.config.ts'],
    ...tseslint.configs.disableTypeChecked,
  },
);
