/**
 * `pnpm ingest` — принять данные всех источников, нормализовать, объединить
 * дубликаты и сохранить прогон.
 *
 * Прогон, не прошедший гейт качества, НЕ завершается: последним остаётся
 * прошлый, целый каталог. Команда при этом падает с ненулевым кодом, чтобы
 * это заметил не человек, а планировщик.
 */

import { enqueueIngest, runPipeline } from '@catalog/pipeline';
import {
  adjudicatorFrom, connectors, databaseUrl, newRunId, rulesetFrom, storeFrom, type CliOptions,
} from '../context.ts';

export const runIngest = async (options: CliOptions): Promise<void> => {
  // `--enqueue` ставит задачу в очередь вместо того, чтобы выполнять её здесь:
  // так это делает планировщик, а выполняет воркер.
  if (options.values['enqueue'] === true) {
    const id = await enqueueIngest(databaseUrl(options));
    console.log(`задача приёма поставлена: ${id ?? '(без идентификатора)'}`);
    return;
  }

  const store = storeFrom(options);
  const now = new Date();

  const result = await runPipeline({
    connectors: connectors(),
    adjudicator: adjudicatorFrom(options),
    store,
    runId: newRunId(now),
    rulesetVersion: rulesetFrom(options),
    now: now.toISOString(),
  });

  const s = result.snapshot.summary;
  console.log(`Прогон ${result.snapshot.run.id}`);
  for (const src of s.perSource) {
    console.log(
      `  ${src.sourceId.padEnd(12)} принято ${src.accepted} из ${src.read}` +
        (src.quarantined > 0 ? `, в карантине ${src.quarantined}` : '') +
        (src.unchanged > 0 ? `, без изменений ${src.unchanged}` : ''),
    );
  }
  console.log(`  записей источников ${s.sourceRecords} → позиций каталога ${s.items}`);
  if (s.pendingReview > 0) console.log(`  в ручной разбор: ${s.pendingReview} пар`);
  if (s.adjudicated > 0) console.log(`  решено арбитром: ${s.adjudicated}`);

  if (!result.committed) {
    console.error('\nПрогон НЕ принят — не пройдены гейты качества:');
    for (const f of result.gateFailures) {
      console.error(`  ${f.gate}: ${f.detail} (наблюдалось ${f.observed.toFixed(3)}, порог ${f.limit})`);
    }
    console.error('Последним остаётся прошлый каталог.');
    process.exitCode = 1;
    return;
  }

  console.log(`\nСохранено в ${store.name}. Дальше: pnpm export, pnpm report`);
};
