import { describe, expect, it } from 'vitest';
import { RulesetVersion, RunId, SourceId, type CatalogItem, type NormalizedRecord } from '@catalog/domain';
import { buildConnectors, MANIFESTS } from '@catalog/connectors';
import { normalizeRecord } from '@catalog/normalize';
import { NoopAdjudicator, resolve } from '@catalog/match';

const RULESET = RulesetVersion('v1');
const RUN = RunId('test-run');

const trustOf = (sourceId: SourceId) =>
  MANIFESTS.find((m) => m.id === sourceId)!.trust;

const loadNormalized = async (): Promise<NormalizedRecord[]> => {
  const out: NormalizedRecord[] = [];
  for (const connector of buildConnectors()) {
    for await (const raw of connector.readRecords()) {
      if (!raw.ok) continue;
      const mapped = connector.toMappedFields(raw.value);
      if (!mapped.ok) continue;
      const r = normalizeRecord(mapped.value, connector.manifest, RULESET);
      if (r.ok) out.push(r.value.record);
    }
  }
  return out;
};

/**
 * Сквозная проверка требования ТЗ «объединяет дубликаты»: три записи
 * от трёх сетей должны схлопнуться в одну позицию каталога, сохранив
 * сведения обо всех источниках.
 */
/** Позиция, в которую схлопнулись записи об одном товаре трёх сетей. */
const mergedItem = (catalog: readonly CatalogItem[]): CatalogItem => {
  const found = catalog.find((i) => i.sources.length === 3);
  if (found === undefined) throw new Error('нет позиции, собранной из трёх источников');
  return found;
};

describe('конвейер целиком', () => {
  it('шесть записей трёх источников дают ТРИ позиции каталога', async () => {
    const records = await loadNormalized();
    expect(records).toHaveLength(6);

    const result = await resolve({
      records, trustOf, runId: RUN, rulesetVersion: RULESET,
      adjudicator: new NoopAdjudicator(),
    });

    // Склеилось ровно то, что должно: один товар, описанный тремя сетями.
    // Не склеилось то, что не должно: другая дозировка и другой бренд.
    expect(result.catalog).toHaveLength(3);
    expect(result.catalog.map((i) => i.sources.length).sort()).toEqual([1, 2, 3]);
    // Ни одна пара не осталась в зоне неопределённости — базовой линии хватило.
    expect(result.pendingReview).toHaveLength(0);
  });

  it('разная дозировка и другой бренд НЕ попадают в одну позицию', async () => {
    const records = await loadNormalized();
    const { catalog } = await resolve({
      records, trustOf, runId: RUN, rulesetVersion: RULESET,
      adjudicator: new NoopAdjudicator(),
    });

    const strengths = catalog.map((i) =>
      i.attributes.kind === 'medicine' && i.attributes.strength?.kind === 'quantity'
        ? i.attributes.strength.amount.value
        : undefined,
    );
    // 200 мг встречается дважды — но у разных брендов, и это разные позиции.
    expect(strengths.filter((v) => v === 200)).toHaveLength(2);
    expect(strengths.filter((v) => v === 400)).toHaveLength(1);
    expect(new Set(catalog.map((i) => i.brandCore))).toEqual(
      new Set(['Acmeflex', 'Northaid']),
    );
  });

  it('победители по полям соответствуют проверенным фактам', async () => {
    const records = await loadNormalized();
    const { catalog } = await resolve({
      records, trustOf, runId: RUN, rulesetVersion: RULESET,
      adjudicator: new NoopAdjudicator(),
    });
    const item = mergedItem(catalog);

    // Производитель: побеждает проверяемо более специфичное имя —
    // самое полное наименование юридического лица.
    expect(item.manufacturer).toBe('Acme Pharma Healthcare');
    const manufacturerProv = item.provenance.find((p) => p.field === 'manufacturer')!;
    expect(manufacturerProv.rule).toBe('verified_specificity');
    expect(manufacturerProv.conflict).toBe(false);

    expect(item.country).toBe('GB');
    expect(item.registeredAt).toBe('2023-01-15');
    expect(item.pack).toEqual({ count: 24, unitOfPresentation: 'Tablet' });
    expect(item.gtin).toBe('02901000000171');
    expect(item.gtinValid).toBe(false);
    expect(item.qualityFlags).toContain('gtin_check_digit_invalid');

    if (item.attributes.kind === 'medicine') {
      expect(item.attributes.doseForm?.basic).toBe('TABLET');
      expect(item.attributes.rxStatus).toBe('otc');
    }
  });

  it('уточнение формы НЕ назначено победителем, а зафиксировано конфликтом', async () => {
    const records = await loadNormalized();
    const { catalog } = await resolve({
      records, trustOf, runId: RUN, rulesetVersion: RULESET,
      adjudicator: new NoopAdjudicator(),
    });
    const item = mergedItem(catalog);

    // Базовая форма выбрана без конфликта — все три сходятся на TABLET.
    const basic = item.provenance.find((p) => p.field === 'doseForm')!;
    expect(basic.conflict).toBe(false);

    // А заявленное «Film-coated» осталось видимым расхождением: справочник
    // его не подтверждает, то есть подробность здесь не равна точности.
    const refinement = item.provenance.find((p) => p.field === 'doseForm.refinement');
    expect(refinement).toBeDefined();
    expect(refinement!.conflict).toBe(true);
    expect(refinement!.value).toContain('FILM_COATED_TABLET');
  });

  it('провенанс возводит каждое поле к конкретной записи источника', async () => {
    const records = await loadNormalized();
    const { catalog } = await resolve({
      records, trustOf, runId: RUN, rulesetVersion: RULESET,
      adjudicator: new NoopAdjudicator(),
    });
    const item = mergedItem(catalog);
    const ids = new Set(records.map((r) => r.id));

    expect(item.provenance.length).toBeGreaterThanOrEqual(8);
    for (const p of item.provenance) {
      expect(ids.has(p.sourceRecordId)).toBe(true);
      expect(p.competitors.length).toBeGreaterThan(0);
    }
  });

  it('результат не зависит от порядка источников', async () => {
    const records = await loadNormalized();
    const forward = await resolve({
      records, trustOf, runId: RUN, rulesetVersion: RULESET,
      adjudicator: new NoopAdjudicator(),
    });
    const reversed = await resolve({
      records: [...records].reverse(), trustOf, runId: RUN, rulesetVersion: RULESET,
      adjudicator: new NoopAdjudicator(),
    });
    expect(JSON.stringify(reversed.catalog)).toBe(JSON.stringify(forward.catalog));
  });

  it('блокировка отчитывается о сокращении перебора', async () => {
    const records = await loadNormalized();
    const { blocking } = await resolve({
      records, trustOf, runId: RUN, rulesetVersion: RULESET,
      adjudicator: new NoopAdjudicator(),
    });
    expect(blocking.records).toBe(6);
    expect(blocking.naivePairs).toBe(15);
    expect(blocking.byLayer.gtin).toBeGreaterThan(0);
  });
});
