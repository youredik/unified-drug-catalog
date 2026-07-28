import { describe, expect, it } from 'vitest';
import { brandCore, brandKey, moreSpecificOrganization, organizationCore, organizationKey } from './naming.ts';

describe('ядро бренда', () => {
  it('три наименования из данных дают одно ядро', () => {
    expect(brandCore('Acmeflex 200 mg Tablets')).toBe('Acmeflex');
    expect(brandCore('Acmeflex Tablets 200mg')).toBe('Acmeflex');
    expect(brandCore('Acmeflex Film-coated Tabs')).toBe('Acmeflex');
  });

  it('ключ сравнения у всех трёх совпадает', () => {
    const keys = [
      'Acmeflex 200 mg Tablets',
      'Acmeflex Tablets 200mg',
      'Acmeflex Film-coated Tabs',
    ].map(brandKey);
    expect(new Set(keys).size).toBe(1);
  });

  it('кириллица и латиница сводятся к одному ключу', () => {
    // Без транслитерации ГОСТ 7.79 эта пара не встретится даже в блокировке.
    expect(brandKey('Нордамет 200 мг таблетки')).toBe(brandKey('Nordamet 200 mg Tablets'));
  });

  it('различающиеся бренды не схлопываются', () => {
    expect(brandKey('Acmeflex 200 mg')).not.toBe(brandKey('Ibunord 200 mg'));
  });

  it('если вычистить нечего, наименование остаётся целым', () => {
    // Защита от вырожденного случая: имя из одних служебных токенов
    // не должно превратиться в пустую строку.
    expect(brandCore('200 mg tablets')).not.toBe('');
  });
});

describe('организация', () => {
  it('организационно-правовая форма снимается', () => {
    expect(organizationCore('Acme Pharma Ltd.')).toBe('Acme Pharma');
    expect(organizationCore('Acme GmbH')).toBe('Acme');
    expect(organizationCore('ООО Фармстандарт')).toBe('Фармстандарт');
  });

  it('Healthcare остаётся — это часть юрлица, а не суффикс', () => {
    // Держатель РУ Acmeflex — «Acme Pharma Healthcare (UK) Ltd».
    // Слепой стриппинг «похожего на суффикс» срезал бы различающую часть
    // и склеил разные юрлица одной группы.
    expect(organizationCore('Acme Pharma Healthcare (UK) Ltd')).toBe(
      'Acme Pharma Healthcare',
    );
    expect(organizationKey('Acme Pharma Healthcare')).not.toBe(
      organizationKey('Acme Pharma'),
    );
  });

  it('более специфичное имя выбирается только при вложенности', () => {
    expect(
      moreSpecificOrganization('Acme Pharma', 'Acme Pharma Healthcare'),
    ).toBe('Acme Pharma Healthcare');
    expect(
      moreSpecificOrganization('Acme Pharma Ltd.', 'Acme Pharma Healthcare'),
    ).toBe('Acme Pharma Healthcare');
  });

  it('несравнимые организации не объявляются одной', () => {
    expect(moreSpecificOrganization('Bayer', 'Sandoz')).toBeUndefined();
  });
});
