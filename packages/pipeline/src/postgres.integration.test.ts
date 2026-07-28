/**
 * Интеграционные тесты хранилища на живом PostgreSQL.
 *
 * База поднимается через Testcontainers: тест сам создаёт контейнер,
 * применяет миграции и убирает за собой. Это принципиально — тест на моках
 * репозитория проверяет мок, а не SQL, и молчит ровно про то, что ломается
 * в проде: типы колонок, ограничения, поведение транзакций.
 *
 * Главное утверждение здесь: у порта ОДНО наблюдаемое поведение независимо
 * от адаптера. Один и тот же прогон через файловое хранилище и через
 * PostgreSQL обязан дать один и тот же каталог.
 *
 * Запуск: `pnpm test:integration` (нужен Docker). В обычный `pnpm test`
 * не входит — сборка не должна зависеть от наличия демона.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RulesetVersion, RunId } from '@catalog/domain';
import { buildConnectors } from '@catalog/connectors';
import { NoopAdjudicator } from '@catalog/match';
import { openDb, runMigrations, type Db } from '@catalog/db';
import { runPipeline } from './run.ts';
import { stableStringify } from './serialize.ts';
import { FileStore } from './store/file.ts';
import { PostgresStore } from './store/postgres.ts';
import { InMemoryStore } from './store/memory.ts';

const RULESET = RulesetVersion('v-it');
const NOW = '2026-07-28T00:00:00.000Z';

let container: StartedPostgreSqlContainer;
let db: Db;
let store: PostgresStore;
let tempDir: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:18-alpine').start();
  db = openDb(container.getConnectionUri());
  await runMigrations(db);
  store = new PostgresStore(db);
  tempDir = await mkdtemp(join(tmpdir(), 'catalog-it-'));
}, 180_000);

afterAll(async () => {
  await db?.close();
  await container?.stop();
  if (tempDir !== undefined) await rm(tempDir, { recursive: true, force: true });
});

const runInto = (target: Parameters<typeof runPipeline>[0]['store'], runId: string) =>
  runPipeline({
    connectors: buildConnectors(),
    adjudicator: new NoopAdjudicator(),
    store: target,
    runId: RunId(runId),
    rulesetVersion: RULESET,
    now: NOW,
  });

describe('PostgreSQL как реализация порта хранилища', () => {
  it('миграции создают схему, по которой конвейер отрабатывает целиком', async () => {
    const result = await runInto(store, 'run-it-1');

    expect(result.committed).toBe(true);
    expect(result.snapshot.catalog).toHaveLength(3);
    expect(result.snapshot.normalized).toHaveLength(6);
  });

  it('прочитанное из базы совпадает с тем, что записали', async () => {
    const loaded = await store.load(RunId('run-it-1'));

    expect(loaded).toBeDefined();
    expect(loaded!.catalog).toHaveLength(3);
    expect(loaded!.normalized).toHaveLength(6);
    expect(loaded!.decisions.length).toBeGreaterThan(0);
    // Позиция, собранная из трёх сетей, помнит все три записи.
    expect(loaded!.catalog.map((i) => i.sources.length).sort()).toEqual([1, 2, 3]);
  });

  it('каталог не зависит от того, какое хранилище выбрано', async () => {
    // Ради этого утверждения порт и существует. Если оно нарушится,
    // выбор хранилища перестанет быть деталью развёртывания.
    //
    // Идентификатор прогона у всех трёх один: позиция каталога помнит, каким
    // прогоном рождена, поэтому сравнивать разные прогоны бессмысленно.
    const viaMemory = await runInto(new InMemoryStore(), 'run-cmp');
    const viaFile = await runInto(new FileStore(tempDir), 'run-cmp');
    await runInto(store, 'run-cmp');
    const viaPg = await store.load(RunId('run-cmp'));

    const shape = (catalog: readonly unknown[]): string => stableStringify(catalog);
    expect(shape(viaFile.snapshot.catalog)).toBe(shape(viaMemory.snapshot.catalog));
    expect(shape(viaPg!.catalog)).toBe(shape(viaMemory.snapshot.catalog));
  });

  it('незавершённый прогон не подменяет собой последний', async () => {
    const writer = await store.beginRun({
      id: RunId('run-broken'), startedAt: NOW, rulesetVersion: RULESET, adjudicator: 'noop',
    });
    await writer.putNormalized([]);
    // `finish` не вызван — прогон оборвался.

    expect(await store.load(RunId('run-broken'))).toBeUndefined();
    expect((await store.latest())!.run.id).toBe('run-it-1');
    expect((await store.listRuns()).map((r) => r.id)).not.toContain('run-broken');
  });

  it('идентификаторы позиций переносятся на следующий прогон', async () => {
    const first = await store.load(RunId('run-it-1'));
    const second = await runInto(store, 'run-it-2');

    // Сравниваем множества идентификаторов, а не первый элемент: позиция
    // может встать в другом месте списка, а вот её id обязан пережить прогон.
    expect(second.snapshot.catalog.map((i) => i.id).sort()).toEqual(
      first!.catalog.map((i) => i.id).sort(),
    );
    // Хэши содержимого показали, что данные не менялись.
    expect(second.snapshot.summary.perSource.every((s) => s.unchanged === 2)).toBe(true);
  });

  it('outbox отдаёт событие ровно один раз на завершённый прогон', async () => {
    const finishedRuns = (await store.listRuns()).length;

    const published: { topic: string; payload: unknown }[] = [];
    const first = await store.drainOutbox(async (topic, payload) => {
      published.push({ topic, payload });
    });
    const second = await store.drainOutbox(async () => {
      throw new Error('второй проход не должен ничего найти');
    });

    // Событий ровно столько, сколько прогонов дошло до конца, и ни одного
    // повторно: оборвавшийся прогон события не породил.
    expect(first).toBe(finishedRuns);
    expect(second).toBe(0);
    expect(published.every((p) => p.topic === 'run.finished')).toBe(true);
  });

  it('падение публикации оставляет событие неопубликованным', async () => {
    // At-least-once строится именно на этом: не смогли отдать — не пометили.
    await runInto(store, 'run-it-3');

    await expect(
      store.drainOutbox(async () => {
        throw new Error('брокер недоступен');
      }),
    ).rejects.toThrow('брокер недоступен');

    const recovered = await store.drainOutbox(async () => {});
    expect(recovered).toBe(1);
  });
});
