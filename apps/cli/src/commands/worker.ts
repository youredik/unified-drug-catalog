/**
 * `pnpm worker` — фоновый обработчик на pg-boss.
 *
 * Делает ровно две вещи: принимает джобы приёма и перекладывает события
 * из транзакционного outbox в очередь. Прикладной логики здесь нет — она
 * приходит зависимостями, поэтому воркер не знает, из чего собран конвейер,
 * и не становится вторым композиционным корнем.
 */

import { writeFile } from 'node:fs/promises';
import { MANIFESTS } from '@catalog/connectors';
import {
  PostgresStore, runPipeline, serializeCatalog, startWorker, type RunSnapshot,
} from '@catalog/pipeline';
import {
  adjudicatorFrom, connectors, databaseUrl, newRunId, PROJECT_ROOT, rulesetFrom, storeFrom,
  type CliOptions,
} from '../context.ts';

export const runWorker = async (options: CliOptions): Promise<void> => {
  const store = storeFrom({ ...options, values: { ...options.values, store: 'postgres' } });
  if (!(store instanceof PostgresStore)) throw new Error('воркеру нужен PostgreSQL');

  const ingest = async (): Promise<RunSnapshot> => {
    const now = new Date();
    const result = await runPipeline({
      connectors: connectors(),
      adjudicator: adjudicatorFrom(options),
      store,
      runId: newRunId(now),
      rulesetVersion: rulesetFrom(options),
      now: now.toISOString(),
    });
    return result.snapshot;
  };

  const worker = await startWorker({
    connectionString: databaseUrl(options),
    store,
    ingest,
    // Обработчик обязан быть идемпотентным: событие может приехать повторно.
    // Здесь он такой — повторная выгрузка того же прогона даёт тот же файл.
    onRunFinished: async ({ runId }) => {
      const snapshot = await store.load(runId as never);
      if (snapshot === undefined) return;
      await writeFile(
        `${PROJECT_ROOT}catalog.json`,
        serializeCatalog({
          catalog: snapshot.catalog,
          records: snapshot.normalized,
          manifests: MANIFESTS,
          runId: snapshot.run.id,
          rulesetVersion: snapshot.run.rulesetVersion,
          generatedAt: snapshot.summary.finishedAt,
        }),
        'utf8',
      );
    },
  });

  console.log('воркер запущен. Очереди: приём и выгрузка. Ctrl+C для остановки.');
  console.log('поставить задачу: pnpm ingest --store=postgres --enqueue');

  await new Promise<void>((resolveStop) => {
    const stop = (): void => {
      void worker.stop().then(resolveStop);
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
};
