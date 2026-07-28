/**
 * Golden-снапшот: весь конвейер целиком против зафиксированного файла.
 *
 * Это единственная проверка, которая ловит непреднамеренное изменение
 * РЕЗУЛЬТАТА. Юнит-тест на правило проверяет то, что автор предвидел;
 * снапшот падает от любой правки, изменившей выгрузку, — включая ту,
 * которую автор считал безобидной.
 *
 * Работает только потому, что каталог детерминирован: время и идентификатор
 * прогона приходят параметрами, ключи сортируются, порядок позиций задан.
 * Проверка «дважды одно и то же» ниже сторожит именно это свойство.
 *
 * Обновить эталон осознанно: `UPDATE_GOLDEN=1 pnpm test`.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { RulesetVersion, RunId } from '@catalog/domain';
import { buildConnectors, MANIFESTS } from '@catalog/connectors';
import { NoopAdjudicator } from '@catalog/match';
import { InMemoryStore, runPipeline, serializeCatalog } from '@catalog/pipeline';

const GOLDEN = new URL('../../../fixtures/catalog.golden.json', import.meta.url).pathname;

const FIXED_NOW = '2026-07-28T00:00:00.000Z';
const FIXED_RUN = RunId('run-golden');
const RULESET = RulesetVersion('v1');

const produceCatalogJson = async (): Promise<string> => {
  const result = await runPipeline({
    connectors: buildConnectors(),
    adjudicator: new NoopAdjudicator(),
    store: new InMemoryStore(),
    runId: FIXED_RUN,
    rulesetVersion: RULESET,
    now: FIXED_NOW,
  });

  return serializeCatalog({
    catalog: result.snapshot.catalog,
    records: result.snapshot.normalized,
    manifests: MANIFESTS,
    runId: FIXED_RUN,
    rulesetVersion: RULESET,
    generatedAt: FIXED_NOW,
  });
};

describe('golden-снапшот каталога', () => {
  it('совпадает с эталоном побайтово', async () => {
    const actual = await produceCatalogJson();

    if (process.env['UPDATE_GOLDEN'] === '1') {
      await writeFile(GOLDEN, actual, 'utf8');
      return;
    }

    const expected = await readFile(GOLDEN, 'utf8');
    expect(actual).toBe(expected);
  });

  it('два прогона на тех же данных дают один и тот же файл', async () => {
    // Без этого снапшот выше проверял бы удачу: недетерминированный
    // конвейер иногда совпадает с эталоном, а иногда нет.
    expect(await produceCatalogJson()).toBe(await produceCatalogJson());
  });

  it('выгрузка содержит всё, ради чего каталог собирается', async () => {
    const doc = JSON.parse(await produceCatalogJson()) as {
      sources: readonly unknown[];
      stats: { sourceRecords: number; items: number; merged: number };
      items: readonly {
        sources: readonly { sourceId: string; externalId: string }[];
        provenance: readonly unknown[];
        conflicts: readonly unknown[];
      }[];
    };

    // Прочитаны все источники.
    expect(doc.sources).toHaveLength(3);
    // Дубликаты объединены — но только настоящие: шесть записей дали три
    // позиции, а не одну (склеили бы разные товары) и не шесть (не склеили
    // ничего).
    expect(doc.stats.sourceRecords).toBe(6);
    expect(doc.stats.items).toBe(3);
    expect(doc.stats.merged).toBe(3);

    // Сведения обо ВСЕХ источниках сохранены: позиция, собранная из трёх
    // сетей, помнит каждую исходную запись поимённо.
    const merged = doc.items.find((i) => i.sources.length === 3)!;
    expect(merged).toBeDefined();
    expect(merged.sources.map((s) => s.sourceId).sort()).toEqual([
      'chain-a', 'chain-b', 'chain-c',
    ]);
    expect(merged.sources.map((s) => s.externalId).sort()).toEqual([
      'A-1001', 'NET2-88', 'sku_30041',
    ]);
    // Провенанс по полям и незаглаженные расхождения — то, чем выгрузка
    // отличается от «схлопнули и забыли».
    expect(merged.provenance.length).toBeGreaterThanOrEqual(8);
    expect(merged.conflicts.length).toBeGreaterThan(0);
  });
});
