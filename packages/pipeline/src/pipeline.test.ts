import { describe, expect, it } from 'vitest';
import {
  RulesetVersion, RunId, SourceId, sourceManifestSchema,
  err, ok,
  type CatalogItem, type MappedFields, type MappingError, type ParseError,
  type Result, type SourceManifest,
} from '@catalog/domain';
import type { SourceConnector } from '@catalog/connectors';
import { NoopAdjudicator } from '@catalog/match';
import { contentHashOf } from './ingest.ts';
import { runPipeline } from './run.ts';
import { stableStringify } from './serialize.ts';
import { diffCatalogs } from './diff.ts';
import { InMemoryStore } from './store/memory.ts';

const RULESET = RulesetVersion('v-test');
const NOW = '2026-07-28T00:00:00.000Z';

// ─── Тестовый коннектор ──────────────────────────────────────────────────────

const manifestFor = (id: string): SourceManifest =>
  sourceManifestSchema.parse({
    id,
    name: `Источник ${id}`,
    contractVersion: 'test',
    transport: { type: 'file', path: '/dev/null' },
    format: 'json',
    dateFormat: 'ISO_8601',
    defaultStrengthUnit: 'mg',
  });

interface FakeRow {
  readonly id: string;
  readonly name?: string;
}

/**
 * Коннектор поверх готового массива: позволяет проверить оболочку конвейера,
 * не трогая файловую систему и не подменяя парсеры.
 */
const fakeConnector = (id: string, rows: readonly FakeRow[]): SourceConnector => ({
  manifest: manifestFor(id),
  async *readRecords(): AsyncIterable<Result<unknown, ParseError>> {
    for (const row of rows) yield ok(row);
  },
  toMappedFields(payload: unknown): Result<MappedFields, MappingError> {
    const row = payload as FakeRow;
    if (row.id === undefined) return err({ kind: 'required_field_absent', field: 'id' });
    return ok({
      externalId: row.id,
      // Пустое имя — жёсткая ошибка нормализации: запись уедет в карантин.
      tradeName: row.name,
      manufacturer: 'Acme',
      gtin: undefined,
      strength: 200,
      doseForm: 'tablet',
      pack: 10,
      rx: false,
      country: 'GB',
      registeredAt: '2023-01-15',
    });
  },
});

const run = async (
  connectors: readonly SourceConnector[],
  store = new InMemoryStore(),
  runId = 'run-1',
) =>
  runPipeline({
    connectors,
    adjudicator: new NoopAdjudicator(),
    store,
    runId: RunId(runId),
    rulesetVersion: RULESET,
    now: NOW,
  });

// ─── Детерминированность ─────────────────────────────────────────────────────

describe('стабильная сериализация', () => {
  it('не зависит от порядка ключей в объекте', () => {
    expect(stableStringify({ b: 2, a: { d: 4, c: 3 } })).toBe(
      stableStringify({ a: { c: 3, d: 4 }, b: 2 }),
    );
  });

  it('хэш содержимого не меняется от перестановки полей', () => {
    // Иначе каждый прогон объявлял бы изменившимся весь фид, стоило
    // поставщику поменять порядок ключей в выгрузке.
    expect(contentHashOf({ x: 1, y: [2, 3] })).toBe(contentHashOf({ y: [2, 3], x: 1 }));
  });

  it('разное содержимое даёт разный хэш', () => {
    expect(contentHashOf({ x: 1 })).not.toBe(contentHashOf({ x: 2 }));
  });
});

// ─── Хранилище ───────────────────────────────────────────────────────────────

describe('порт хранилища', () => {
  it('незавершённый прогон не становится последним', async () => {
    const store = new InMemoryStore();
    const writer = await store.beginRun({
      id: RunId('run-broken'), startedAt: NOW, rulesetVersion: RULESET, adjudicator: 'noop',
    });
    await writer.putCatalog([]);
    // `finish` не вызван — прогон оборвался.

    expect(await store.latest()).toBeUndefined();
    expect(await store.listRuns()).toHaveLength(0);
  });

  it('идентификаторы позиций переживают прогон', async () => {
    const rows = [{ id: 'x1', name: 'Acmeflex 200 mg Tablets' }];
    const store = new InMemoryStore();

    const first = await run([fakeConnector('s1', rows)], store, 'run-1');
    const second = await run([fakeConnector('s1', rows)], store, 'run-2');

    expect(first.snapshot.catalog[0]!.id).toBe(second.snapshot.catalog[0]!.id);
    // Внешний потребитель каталога может ссылаться на позицию: id не плывёт.
    expect(second.snapshot.run.id).not.toBe(first.snapshot.run.id);
  });

  it('второй прогон видит неизменившиеся записи', async () => {
    const rows = [{ id: 'x1', name: 'Acmeflex 200 mg Tablets' }];
    const store = new InMemoryStore();
    await run([fakeConnector('s1', rows)], store, 'run-1');
    const second = await run([fakeConnector('s1', rows)], store, 'run-2');

    expect(second.snapshot.summary.perSource[0]!.unchanged).toBe(1);
  });
});

// ─── Гейты качества ──────────────────────────────────────────────────────────

describe('гейты качества', () => {
  it('прогон с обвалом карантина НЕ подменяет каталог', async () => {
    const store = new InMemoryStore();

    // Сначала здоровый прогон.
    const healthy = Array.from({ length: 10 }, (_, i) => ({ id: `ok${i}`, name: `Товар ${i}` }));
    const good = await run([fakeConnector('s1', healthy)], store, 'run-good');
    expect(good.committed).toBe(true);

    // Затем прогон, где половина записей нечитаема.
    const broken = healthy.map((r, i) => (i % 2 === 0 ? { id: r.id } : r));
    const bad = await run([fakeConnector('s1', broken)], store, 'run-bad');

    expect(bad.committed).toBe(false);
    expect(bad.gateFailures.map((f) => f.gate)).toContain('maxQuarantineRatio');
    // Главное: последним остался ЦЕЛЫЙ каталог, а не покалеченный.
    expect((await store.latest())!.run.id).toBe('run-good');
  });

  it('карантин объясняет причину, а не просто теряет запись', async () => {
    const result = await run([fakeConnector('s1', [{ id: 'x1' }])]);
    const [quarantined] = result.snapshot.quarantined;

    expect(quarantined).toBeDefined();
    expect(quarantined!.reason).toEqual({ kind: 'required_field_absent', field: 'tradeName' });
    expect(quarantined!.rawExcerpt).toContain('x1');
  });
});

// ─── Диф ─────────────────────────────────────────────────────────────────────

describe('диф каталогов', () => {
  const item = (over: Partial<CatalogItem> = {}): CatalogItem =>
    ({
      id: 'item:1',
      tradeName: 'Acmeflex',
      brandCore: 'Acmeflex',
      manufacturer: 'Acme',
      gtinValid: false,
      attributes: { kind: 'medicine', inn: [], rxStatus: 'otc' },
      sources: ['s1:x1'],
      provenance: [],
      qualityFlags: [],
      runId: RunId('r'),
      rulesetVersion: RULESET,
      ...over,
    }) as CatalogItem;

  it('одинаковые каталоги не дают изменений', () => {
    const diff = diffCatalogs([item()], [item()]);
    expect(diff.changed).toHaveLength(0);
    expect(diff.unchanged).toBe(1);
  });

  it('показывает поле, которое изменилось', () => {
    const diff = diffCatalogs([item()], [item({ manufacturer: 'Acme Healthcare' })]);
    expect(diff.changed[0]!.changes).toEqual([
      { field: 'manufacturer', before: 'Acme', after: 'Acme Healthcare' },
    ]);
  });

  it('показывает пере-склейку записей', () => {
    const diff = diffCatalogs(
      [item()],
      [item({ sources: [SourceId('s1:x1'), SourceId('s2:y2')] as never })],
    );
    expect(diff.changed[0]!.sourcesAdded).toEqual(['s2:y2']);
  });
});
