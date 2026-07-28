import { describe, expect, it } from 'vitest';
import { RulesetVersion } from '@catalog/domain';
import { normalizeRecord } from '@catalog/normalize';
import { runConformance } from './conformance.ts';
import { buildConnectors } from './sources.ts';

const RULESET = RulesetVersion('test');

/**
 * Один и тот же пакет проверок для каждой сети. Новый коннектор не пишет
 * собственных тестов — он обязан пройти этот набор.
 */
describe('conformance-набор коннекторов', () => {
  for (const connector of buildConnectors()) {
    describe(connector.manifest.id, () => {
      it('проходит все проверки', async () => {
        const results = await runConformance(connector, RULESET);
        const failed = results.filter((r) => !r.ok);
        expect(
          failed.map((f) => `${f.name}: ${f.detail}`),
          `провалено проверок: ${failed.length}`,
        ).toEqual([]);
        expect(results.length).toBeGreaterThanOrEqual(8);
      });
    });
  }
});

/** Нормализованные записи всех источников, в порядке чтения. */
const normalizeAll = async () => {
  const out = [];
  for (const connector of buildConnectors()) {
    for await (const raw of connector.readRecords()) {
      if (!raw.ok) continue;
      const mapped = connector.toMappedFields(raw.value);
      if (!mapped.ok) continue;
      const r = normalizeRecord(mapped.value, connector.manifest, RULESET);
      if (r.ok) out.push({ source: connector.manifest.id, ...r.value.record });
    }
  }
  return out;
};

describe('три источника описывают пересекающийся ассортимент', () => {
  it('после нормализации ключевые поля сходятся', async () => {
    const normalized = [];
    for (const connector of buildConnectors()) {
      for await (const raw of connector.readRecords()) {
        expect(raw.ok).toBe(true);
        if (!raw.ok) continue;
        const mapped = connector.toMappedFields(raw.value);
        expect(mapped.ok).toBe(true);
        if (!mapped.ok) continue;
        const r = normalizeRecord(mapped.value, connector.manifest, RULESET);
        expect(r.ok).toBe(true);
        if (r.ok) normalized.push(r.value.record);
      }
    }

    expect(normalized).toHaveLength(6);

    // Записи об ОДНОМ товаре (200 мг, 24 таб.) приходят от трёх сетей
    // и записаны там шестью разными способами. После нормализации они
    // обязаны совпасть по каждому ключевому полю.
    const sameProduct = normalized.filter(
      (r) => r.brandKey === 'acmeflex' && r.pack?.count === 24,
    );
    expect(sameProduct).toHaveLength(3);
    expect(new Set(sameProduct.map((r) => r.gtin)).size).toBe(1);
    expect(new Set(sameProduct.map((r) => r.doseForm?.basic)).size).toBe(1);
    expect(new Set(sameProduct.map((r) => r.country)).size).toBe(1);
    expect(new Set(sameProduct.map((r) => r.registeredAt)).size).toBe(1);
    expect(new Set(sameProduct.map((r) => r.rxStatus)).size).toBe(1);

    // Страна пришла как `GB`, `United Kingdom` и `UK` — последнее не валидный
    // ISO 3166, и словарь синонимов приводит все три к канону.
    expect(sameProduct.every((r) => r.country === 'GB')).toBe(true);
    expect(sameProduct.every((r) => r.registeredAt === '2023-01-15')).toBe(true);
    expect(sameProduct.every((r) => r.doseForm?.basic === 'TABLET')).toBe(true);
    expect(sameProduct.every((r) => r.rxStatus === 'otc')).toBe(true);

    // А вот эти сойтись НЕ должны: другая дозировка и другой бренд.
    expect(new Set(normalized.map((r) => r.brandKey))).toEqual(
      new Set(['acmeflex', 'northaid']),
    );
    expect(new Set(normalized.map((r) => r.gtin)).size).toBe(3);
  });

  it('невалидная контрольная цифра отмечена везде, но ни одна запись не потеряна', async () => {
    const normalized = await normalizeAll();

    expect(normalized).toHaveLength(6);
    for (const r of normalized) {
      expect(r.gtinValid).toBe(false);
      expect(r.qualityFlags).toContain('gtin_check_digit_invalid');
      // Идентификатор сохранён, а не отброшен: он ещё нужен для блокировки.
      // 13 знаков из файла, дополненные нулём слева до GTIN-14.
      expect(r.gtin).toMatch(/^0290100000\d{4}$/);
    }
  });

  it('расхождение по лекформе сохраняется, а не гасится', async () => {
    const normalized = await normalizeAll();

    // Источник C уточняет форму в НАИМЕНОВАНИИ (`Film-coated Tabs`), тогда как
    // структурное поле у него — `tabs`. Уточнение принимается, помечается
    // непроверенным и не влияет на сравнение: матчинг смотрит на basic.
    const refined = normalized.filter((r) => r.doseForm?.full !== undefined);
    expect(refined).toHaveLength(1);
    expect(refined[0]!.source).toBe('chain-c');
    expect(refined[0]!.doseForm?.full).toBe('FILM_COATED_TABLET');
    expect(refined[0]!.doseForm?.basic).toBe('TABLET');
    expect(refined[0]!.qualityFlags).toContain('dose_form_refined_unverified');
  });
});
