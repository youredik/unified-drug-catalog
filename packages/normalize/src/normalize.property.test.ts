/**
 * Property-тесты нормализации.
 *
 * Табличный тест проверяет случаи, которые автор придумал. Property-тест
 * проверяет УТВЕРЖДЕНИЕ на тысяче случаев, которые автор не придумывал, —
 * и находит ровно те, о которых не подумал.
 *
 * Это возможно только потому, что нормализация — чистые функции без I/O:
 * ни моков, ни базы, ни временных файлов. Гейт `core-has-no-io` в CI следит,
 * чтобы это свойство не потерялось.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { DateFormat } from '@catalog/domain';
import { computeCheckDigit, isValidGtin, normalizeGtin, toGtin14 } from './gtin.ts';
import { brandCore, brandKey } from './naming.ts';
import { normalizeDate, normalizeRxStatus } from './attributes.ts';

const digits = (length: number) =>
  fc.stringMatching(new RegExp(`^[0-9]{${length}}$`));

describe('GTIN: свойства', () => {
  it('дописанная контрольная цифра всегда делает штрихкод валидным', () => {
    // Обратная проверка алгоритма: не «известный код проходит», а
    // «то, что мы считаем правильным, действительно правильно».
    fc.assert(
      fc.property(digits(13), (body) => {
        expect(isValidGtin(`${body}${computeCheckDigit(body)}`)).toBe(true);
      }),
    );
  });

  it('порча последней цифры делает штрихкод невалидным', () => {
    fc.assert(
      fc.property(digits(13), fc.integer({ min: 1, max: 9 }), (body, shift) => {
        const correct = computeCheckDigit(body);
        const wrong = (correct + shift) % 10;
        expect(isValidGtin(`${body}${wrong}`)).toBe(false);
      }),
    );
  });

  it('приведение к 14 знакам идемпотентно', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 8, max: 14 }).chain((n) => digits(n)),
        (raw) => {
          expect(toGtin14(toGtin14(raw))).toBe(toGtin14(raw));
        },
      ),
    );
  });

  it('нормализация идемпотентна и никогда не бросает', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.integer(), fc.constant(null)), (raw) => {
        const once = normalizeGtin(raw);
        if (once.gtin === undefined) return;
        expect(normalizeGtin(once.gtin).gtin).toBe(once.gtin);
        expect(once.gtin).toHaveLength(14);
      }),
    );
  });
});

describe('Даты: свойства', () => {
  const FORMATS: readonly { format: DateFormat; render: (y: number, m: string, d: string) => string }[] = [
    { format: 'ISO_8601', render: (y, m, d) => `${y}-${m}-${d}` },
    { format: 'DD.MM.YYYY', render: (y, m, d) => `${d}.${m}.${y}` },
    { format: 'DD/MM/YYYY', render: (y, m, d) => `${d}/${m}/${y}` },
    { format: 'MM/DD/YYYY', render: (y, m, d) => `${m}/${d}/${y}` },
    { format: 'YYYY/MM/DD', render: (y, m, d) => `${y}/${m}/${d}` },
  ];

  it('дата в объявленном формате возвращается той же датой', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1900, max: 2100 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 28 }),
        fc.constantFrom(...FORMATS),
        (y, mo, d, { format, render }) => {
          const pad = (n: number): string => String(n).padStart(2, '0');
          const result = normalizeDate(render(y, pad(mo), pad(d)), format);
          expect(result.ok).toBe(true);
          if (result.ok) expect(result.value).toBe(`${y}-${pad(mo)}-${pad(d)}`);
        },
      ),
    );
  });

  it('несуществующая дата отвергается в любом формате', () => {
    // Независимая проверка через платформу: если календарь не воспроизводит
    // тройку обратно — такой даты нет.
    fc.assert(
      fc.property(
        fc.integer({ min: 1900, max: 2100 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 29, max: 31 }),
        fc.constantFrom(...FORMATS),
        (y, mo, d, { format, render }) => {
          const probe = new Date(Date.UTC(y, mo - 1, d));
          const real = probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
          const pad = (n: number): string => String(n).padStart(2, '0');
          expect(normalizeDate(render(y, pad(mo), pad(d)), format).ok).toBe(real);
        },
      ),
    );
  });
});

describe('Наименование: свойства', () => {
  it('ключ сравнения не зависит от регистра и лишних пробелов', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (name) => {
        expect(brandKey(`  ${name.toUpperCase()}  `)).toBe(brandKey(name.toLowerCase()));
      }),
    );
  });

  it('выделение ядра бренда идемпотентно', () => {
    fc.assert(
      fc.property(fc.string(), (name) => {
        expect(brandCore(brandCore(name))).toBe(brandCore(name));
      }),
    );
  });
});

describe('Рецептурность: свойство, ради которого она tri-state', () => {
  const KNOWN = new Set([
    'true', 'yes', 'y', '1', 'да', 'rx', 'prescription',
    'false', 'no', 'n', '0', 'нет', 'otc',
  ]);

  it('невнятный ввод НИКОГДА не становится безрецептурным', () => {
    // Это не педантизм: потребитель каталога может принимать на этом
    // решения об отпуске. Молчаливое «раз не сказано — значит без рецепта»
    // здесь и есть та ошибка, которую тест обязан не пропустить.
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.constant(null), fc.constant(undefined)), (raw) => {
        fc.pre(typeof raw !== 'string' || !KNOWN.has(raw.trim().toLowerCase()));
        expect(normalizeRxStatus(raw).status).toBe('unknown');
      }),
    );
  });
});
