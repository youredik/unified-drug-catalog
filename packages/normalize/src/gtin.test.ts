import { describe, expect, it } from 'vitest';
import { computeCheckDigit, isValidGtin, normalizeGtin, toGtin14 } from './gtin.ts';

/**
 * Контроль важнее самой проверки.
 *
 * Если проверять только данные задания, мы убедимся лишь в самосогласованности
 * собственного кода: реализация, которая всегда возвращает «невалиден», прошла
 * бы такой тест. Поэтому сначала — заведомо валидные штрихкоды из спецификации
 * и реальных товаров. Только после того, как алгоритм на них сошёлся, вывод
 * о данных задания что-то значит.
 */
describe('контрольная цифра GTIN', () => {
  const KNOWN_VALID: readonly [string, string][] = [
    ['5901234123457', 'пример EAN-13 из спецификации'],
    ['4006381333931', 'Staedtler, реальный товар'],
    ['0012345678905', 'учебный пример GS1 US'],
    ['00012345678905', 'тот же код, дополненный до GTIN-14'],
  ];

  it.each(KNOWN_VALID)('%s валиден — %s', (code) => {
    expect(isValidGtin(code)).toBe(true);
  });

  it('вычисляет контрольную цифру по MOD-10', () => {
    expect(computeCheckDigit('590123412345')).toBe(7);
    expect(computeCheckDigit('400638133393')).toBe(1);
  });

  it('идентификатор из данных задания НЕ проходит MOD-10', () => {
    // Взвешенная сумма первых 13 цифр = 86 → контрольная должна быть 4, стоит 9.
    expect(computeCheckDigit('0505012345678')).toBe(4);
    expect(isValidGtin('05050123456789')).toBe(false);
  });

  it('вывод одинаков при трактовке и как GTIN-13, и как GTIN-14', () => {
    expect(isValidGtin('5050123456789')).toBe(false);
    expect(isValidGtin('05050123456789')).toBe(false);
    expect(computeCheckDigit('505012345678')).toBe(computeCheckDigit('0505012345678'));
  });
});

describe('приведение к 14 знакам', () => {
  it('дополняет нулями слева, как рекомендует GS1', () => {
    expect(toGtin14('5901234123457')).toBe('05901234123457');
    expect(toGtin14('12345670')).toBe('00000012345670');
    expect(toGtin14('05050123456789')).toBe('05050123456789');
  });
});

describe('нормализация идентификатора', () => {
  it('снимает разделители и отмечает это флагом', () => {
    // Источник B присылает `0505-0123-4567-89` — тот же идентификатор.
    const withSeparators = normalizeGtin('0505-0123-4567-89');
    const plain = normalizeGtin('05050123456789');
    expect(withSeparators.gtin).toBe(plain.gtin);
    expect(withSeparators.flags).toContain('gtin_non_numeric_stripped');
    expect(plain.flags).not.toContain('gtin_non_numeric_stripped');
  });

  it('НЕ отбрасывает запись с невалидной контрольной цифрой', () => {
    // Ключевое решение: «проверить и отбросить» уничтожило бы весь датасет.
    const r = normalizeGtin('05050123456789');
    expect(r.gtin).toBe('05050123456789');
    expect(r.valid).toBe(false);
    expect(r.flags).toContain('gtin_check_digit_invalid');
  });

  it('валидный идентификатор не получает флага', () => {
    const r = normalizeGtin('5901234123457');
    expect(r.valid).toBe(true);
    expect(r.flags).toHaveLength(0);
  });

  const ABSENT: readonly (readonly [unknown, string])[] = [
    [null, 'отсутствует'],
    [undefined, 'не задан'],
    ['', 'пустая строка'],
  ];

  it.each(ABSENT)('%s → отсутствующий идентификатор (%s)', (input) => {
    const r = normalizeGtin(input);
    expect(r.gtin).toBeUndefined();
    expect(r.flags).toContain('gtin_absent');
  });

  it('длина, из которой GTIN не собрать, не молчит', () => {
    const r = normalizeGtin('12345');
    expect(r.gtin).toBeUndefined();
    expect(r.flags).toContain('gtin_malformed');
  });

  it('число вместо строки обрабатывается так же', () => {
    expect(normalizeGtin(5901234123457).valid).toBe(true);
  });
});
