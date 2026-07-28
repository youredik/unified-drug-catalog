import { describe, expect, it } from 'vitest';
import { comparableStrength, normalizeStrength } from './strength.ts';

describe('дозировка: три написания одной величины', () => {
  it('число + единица из манифеста, строка и объект дают один канон', () => {
    // Ровно то, что в данных: A — `200` без единицы, B — `"200 mg"`, C — объект.
    const fromNumber = normalizeStrength(200, 'mg');
    const fromString = normalizeStrength('200 mg', undefined);
    const fromObject = normalizeStrength({ value: 200, unit: 'mg' }, undefined);

    for (const r of [fromNumber, fromString, fromObject]) {
      expect(r.ok).toBe(true);
      if (r.ok) expect(comparableStrength(r.value.strength)).toBe('q:200:mg');
    }
  });

  it('голое число без объявленной единицы — ошибка, а не догадка', () => {
    // `dosage_mg` сегодня, `dose` завтра. Единица берётся из манифеста
    // источника, а не выводится из имени поля.
    const r = normalizeStrength(200, undefined);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('unknown_unit');
  });

  it('единица из манифеста отмечается флагом — это предположение, не факт', () => {
    const r = normalizeStrength(200, 'mg');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.flags).toContain('strength_unit_assumed_from_manifest');
  });
});

describe('дозировка: не только масса', () => {
  it('концентрация разбирается как отношение, а не как масса', () => {
    // ЕСКЛП вводит потребительскую единицу отдельным понятием именно
    // для дозировок через концентрацию. Приведение к массе теряет знаменатель.
    const r = normalizeStrength('5 mg/ml', undefined);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.strength.kind).toBe('ratio');
      if (r.value.strength.kind === 'ratio') {
        expect(r.value.strength.numerator).toEqual({ value: 5, unit: 'mg' });
        expect(r.value.strength.denominator).toEqual({ value: 1, unit: 'mL' });
      }
    }
  });

  it('концентрация с явным знаменателем', () => {
    const r = normalizeStrength('100 mg / 5 ml', undefined);
    expect(r.ok).toBe(true);
    if (r.ok && r.value.strength.kind === 'ratio') {
      expect(r.value.strength.denominator).toEqual({ value: 5, unit: 'mL' });
    }
  });

  it('международные единицы — биологическая активность, а не масса', () => {
    for (const raw of ['500 IU', '500 МЕ']) {
      const r = normalizeStrength(raw, undefined);
      expect(r.ok).toBe(true);
      if (r.ok && r.value.strength.kind === 'quantity') {
        expect(r.value.strength.amount.unit).toBe('[IU]');
      }
    }
  });

  it('кириллические единицы наравне с латинскими', () => {
    const ru = normalizeStrength('200 мг', undefined);
    const en = normalizeStrength('200 mg', undefined);
    expect(ru.ok && en.ok).toBe(true);
    if (ru.ok && en.ok) {
      expect(comparableStrength(ru.value.strength)).toBe(comparableStrength(en.value.strength));
    }
  });

  it('запятая как десятичный разделитель', () => {
    const r = normalizeStrength('0,5 g', undefined);
    expect(r.ok).toBe(true);
    if (r.ok && r.value.strength.kind === 'quantity') {
      expect(r.value.strength.amount.value).toBe(0.5);
    }
  });

  it('концентрация проверяется раньше массы, иначе хвост теряется', () => {
    // Без этого порядка `5 мг/мл` разобралось бы как `5 мг`.
    const r = normalizeStrength('5 мг/мл', undefined);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.strength.kind).toBe('ratio');
  });

  it('неизвестная единица не подменяется ближайшей похожей', () => {
    expect(normalizeStrength('200 чегототам', undefined).ok).toBe(false);
    expect(normalizeStrength('совсем не дозировка', undefined).ok).toBe(false);
  });
});
