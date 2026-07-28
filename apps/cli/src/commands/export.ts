/**
 * `pnpm export` — итоговый каталог в JSON. Прямое требование ТЗ.
 *
 * Выгрузка детерминирована: время берётся из завершённого прогона, а не из
 * часов, поэтому повторный экспорт того же прогона даёт побайтово тот же файл.
 * На этом стоят и golden-снапшот, и `catalog:diff`.
 */

import { writeFile } from 'node:fs/promises';
import { RunId } from '@catalog/domain';
import { MANIFESTS } from '@catalog/connectors';
import { runPipeline, serializeCatalog, type RunSnapshot } from '@catalog/pipeline';
import {
  adjudicatorFrom, connectors, newRunId, PROJECT_ROOT, rulesetFrom, storeFrom, type CliOptions,
} from '../context.ts';

/** Берёт указанный прогон, последний завершённый, а если их нет — делает новый. */
export const snapshotFor = async (options: CliOptions): Promise<RunSnapshot> => {
  const store = storeFrom(options);
  const requested = options.values['run'];

  if (typeof requested === 'string') {
    const found = await store.load(RunId(requested));
    if (found === undefined) throw new Error(`прогон не найден: ${requested}`);
    return found;
  }

  const latest = await store.latest();
  if (latest !== undefined) return latest;

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

export const runExport = async (options: CliOptions): Promise<void> => {
  const snapshot = await snapshotFor(options);

  const json = serializeCatalog({
    catalog: snapshot.catalog,
    records: snapshot.normalized,
    manifests: MANIFESTS,
    runId: snapshot.run.id,
    rulesetVersion: snapshot.run.rulesetVersion,
    generatedAt: snapshot.summary.finishedAt,
  });

  const out =
    typeof options.values['out'] === 'string'
      ? options.values['out']
      : `${PROJECT_ROOT}catalog.json`;

  await writeFile(out, json, 'utf8');
  console.log(
    `${out}: позиций ${snapshot.catalog.length}` +
      ` из ${snapshot.normalized.length} записей` +
      ` (прогон ${snapshot.run.id})`,
  );
};
