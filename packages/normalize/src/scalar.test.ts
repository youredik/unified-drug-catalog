import { describe, expect, it } from 'vitest';
import { asText, asTrimmedText, describeValue } from './scalar.ts';
import { normalizeGtin } from './gtin.ts';
import { normalizeCountry, normalizeDate, normalizeDoseForm, normalizePack, normalizeRxStatus } from './attributes.ts';
import { normalizeStrength } from './strength.ts';

/**
 * Класс ошибок «структура вместо скаляра».
 *
 * Поставщик может прислать объект там, где ожидалась строка: в XML это узел
 * с атрибутами вместо текста, в JSON — вложенная структура вместо значения.
 * `String(объект)` даёт «[object Object]» — строку, которая выглядит как
 * данные и молча едет дальше: в парсер, в ключ записи, в отчёт качества.
 *
 * Эти тесты закрывают весь класс сразу: ни один нормализатор не должен
 * произвести «[object Object]» ни в значении, ни в тексте ошибки.
 */

const STRUCTURES: readonly [string, unknown][] = [
  ['объект', { value: 1 }],
  ['массив', [1, 2]],
  ['пустой объект', {}],
  ['вложенная структура', { a: { b: 'c' } }],
];

describe('приведение недоверенного значения к тексту', () => {
  it('скаляры превращаются в текст', () => {
    expect(asText('  Acmeflex ')).toBe('  Acmeflex ');
    expect(asText(200)).toBe('200');
    expect(asText(true)).toBe('true');
    expect(asTrimmedText('  Acmeflex ')).toBe('Acmeflex');
  });

  it('структура текстом не становится', () => {
    for (const [, value] of STRUCTURES) {
      expect(asText(value)).toBeUndefined();
      expect(asTrimmedText(value)).toBeUndefined();
    }
  });

  it('пустая строка и пробелы считаются отсутствием значения', () => {
    expect(asTrimmedText('')).toBeUndefined();
    expect(asTrimmedText('   ')).toBeUndefined();
  });

  it('NaN и Infinity не текст: это не числа, пригодные для разбора', () => {
    expect(asText(Number.NaN)).toBeUndefined();
    expect(asText(Number.POSITIVE_INFINITY)).toBeUndefined();
  });

  it('описание для отчёта сохраняет структуру, а не прячет её', () => {
    // В карантине должно быть видно, ЧТО прислал источник.
    expect(describeValue({ value: 1 })).toBe('{"value":1}');
    expect(describeValue(null)).toBe('null');
    expect(describeValue(undefined)).toBe('undefined');
    expect(describeValue('текст')).toBe('текст');
  });

  it('циклическая ссылка не роняет описание', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    expect(describeValue(cyclic)).toBe('(object)');
  });
});

describe('ни один нормализатор не производит «[object Object]»', () => {
  const hasArtifact = (s: string): boolean => s.includes('[object');

  it.each(STRUCTURES)('%s не становится идентификатором', (_name, value) => {
    const result = normalizeGtin(value);
    expect(result.gtin).toBeUndefined();
    expect(result.flags).toContain('gtin_absent');
  });

  it.each(STRUCTURES)('%s не разбирается как лекформа, страна или дата', (_name, value) => {
    for (const outcome of [
      normalizeDoseForm(value),
      normalizeCountry(value),
      normalizeDate(value, 'ISO_8601'),
    ]) {
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(hasArtifact(JSON.stringify(outcome.error))).toBe(false);
      }
    }
  });

  it.each(STRUCTURES)('%s не разбирается как упаковка или дозировка', (_name, value) => {
    const pack = normalizePack(value, undefined);
    const strength = normalizeStrength(value, undefined);
    for (const outcome of [pack, strength]) {
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(hasArtifact(JSON.stringify(outcome.error))).toBe(false);
    }
  });

  it.each(STRUCTURES)('%s не становится рецептурностью otc', (_name, value) => {
    // Самый опасный случай: молчаливое «раз не разобрали — значит без рецепта».
    expect(normalizeRxStatus(value).status).toBe('unknown');
  });
});
