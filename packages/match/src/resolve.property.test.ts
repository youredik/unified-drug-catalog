/**
 * Property-тесты разрешения тождества.
 *
 * Здесь проверяются утверждения, которые обязаны выполняться на ЛЮБЫХ данных,
 * а не на трёх записях примера:
 *
 *   — результат не зависит от порядка, в котором пришли источники;
 *   — ни одна запись не теряется и не задваивается;
 *   — в каталоге не появляется ссылок на записи, которых на входе не было;
 *   — товары с разной дозировкой не склеиваются никогда.
 *
 * Последнее — не техническое свойство, а предметное правило: 200 мг и 400 мг
 * это разные позиции, и цена ошибки здесь не «неудобно пользователю».
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  Gtin14, Inn, RulesetVersion, RunId, SourceId, SourceRecordId,
  type NormalizedRecord, type SourceManifest,
} from '@catalog/domain';
import { brandCore, brandKey } from '@catalog/normalize';
import { NoopAdjudicator } from './adjudicator.ts';
import { resolve } from './resolve.ts';

const RULESET = RulesetVersion('v-test');
const RUN = RunId('run-test');

const NEUTRAL_TRUST = {} as SourceManifest['trust'];
const trustOf = (): SourceManifest['trust'] => NEUTRAL_TRUST;

interface Spec {
  readonly brand: string;
  readonly strength: number;
  readonly pack: number;
  readonly manufacturer: string;
  readonly gtin: string | undefined;
}

const makeRecord = (source: string, external: string, spec: Spec): NormalizedRecord => ({
  id: SourceRecordId(`${source}:${external}`),
  sourceId: SourceId(source),
  externalId: external,
  kind: 'medicine',
  tradeName: `${spec.brand} ${spec.strength} mg`,
  brandCore: brandCore(spec.brand),
  brandKey: brandKey(spec.brand),
  manufacturerRaw: spec.manufacturer,
  ...(spec.gtin === undefined ? {} : { gtin: Gtin14(spec.gtin) }),
  gtinValid: false,
  strength: { kind: 'quantity', amount: { value: spec.strength, unit: 'mg' as never } },
  doseForm: { basic: 'TABLET' },
  pack: { count: spec.pack, unitOfPresentation: 'Tablet' },
  rxStatus: 'otc',
  inn: [Inn('ibuprofen')],
  qualityFlags: [],
  rulesetVersion: RULESET,
});

const arbSpec = fc.record({
  brand: fc.constantFrom('Acmeflex', 'Northaid', 'Salicyn', 'Velmora', 'Prixen'),
  strength: fc.constantFrom(100, 200, 400),
  pack: fc.constantFrom(6, 10, 12, 24),
  manufacturer: fc.constantFrom('Acme Pharma', 'Northwind Health', 'Meridian Labs'),
  gtin: fc.option(fc.constantFrom('05050123456789', '04006381333931'), { nil: undefined }),
});

/** Набор записей от нескольких «сетей»: у каждой свой префикс идентификатора. */
const arbRecords = fc
  .array(arbSpec, { minLength: 2, maxLength: 8 })
  .map((specs) =>
    specs.map((spec, i) => makeRecord(`src-${i % 3}`, `r${i}`, spec)),
  );

const runResolve = (records: readonly NormalizedRecord[]) =>
  resolve({
    records,
    trustOf,
    runId: RUN,
    rulesetVersion: RULESET,
    adjudicator: new NoopAdjudicator(),
  });

const shape = (catalog: Awaited<ReturnType<typeof runResolve>>['catalog']): string =>
  JSON.stringify(
    catalog.map((i) => ({ id: i.id, sources: [...i.sources].sort() })),
  );

describe('разрешение тождества: свойства', () => {
  it('результат не зависит от порядка источников', async () => {
    await fc.assert(
      fc.asyncProperty(arbRecords, async (records) => {
        const forward = await runResolve(records);
        const backward = await runResolve([...records].reverse());
        expect(shape(backward.catalog)).toBe(shape(forward.catalog));
      }),
      { numRuns: 50 },
    );
  });

  it('перестановка записей внутри входа ничего не меняет', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbRecords.chain((records) =>
          fc.tuple(fc.constant(records), fc.shuffledSubarray(records, { minLength: records.length })),
        ),
        async ([original, shuffled]) => {
          expect(shape((await runResolve(shuffled)).catalog)).toBe(
            shape((await runResolve(original)).catalog),
          );
        },
      ),
      { numRuns: 50 },
    );
  });

  it('ни одна запись не теряется и не попадает в две позиции', async () => {
    await fc.assert(
      fc.asyncProperty(arbRecords, async (records) => {
        const { catalog } = await runResolve(records);
        const assigned = catalog.flatMap((i) => [...i.sources]);
        expect(assigned).toHaveLength(new Set(assigned).size);
        expect([...assigned].sort()).toEqual([...records.map((r) => r.id)].sort());
      }),
      { numRuns: 50 },
    );
  });

  it('в каталоге нет ссылок на записи, которых на входе не было', async () => {
    await fc.assert(
      fc.asyncProperty(arbRecords, async (records) => {
        const known = new Set<string>(records.map((r) => r.id));
        const { catalog } = await runResolve(records);
        for (const item of catalog) {
          for (const source of item.sources) expect(known.has(source)).toBe(true);
          for (const p of item.provenance) expect(known.has(p.sourceRecordId)).toBe(true);
        }
      }),
      { numRuns: 50 },
    );
  });

  it('разная дозировка НИКОГДА не склеивается в одну позицию', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbSpec,
        fc.constantFrom(100, 200, 400),
        fc.constantFrom(100, 200, 400),
        async (spec, left, right) => {
          fc.pre(left !== right);
          const records = [
            makeRecord('src-0', 'l', { ...spec, strength: left }),
            makeRecord('src-1', 'r', { ...spec, strength: right }),
          ];
          const { catalog } = await runResolve(records);
          expect(catalog).toHaveLength(2);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('разный размер упаковки НИКОГДА не склеивается в одну позицию', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbSpec,
        fc.constantFrom(6, 12, 24),
        fc.constantFrom(6, 12, 24),
        async (spec, left, right) => {
          fc.pre(left !== right);
          const records = [
            makeRecord('src-0', 'l', { ...spec, pack: left }),
            makeRecord('src-1', 'r', { ...spec, pack: right }),
          ];
          const { catalog } = await runResolve(records);
          expect(catalog).toHaveLength(2);
        },
      ),
      { numRuns: 50 },
    );
  });
});
