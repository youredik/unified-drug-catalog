/**
 * Файловое хранилище: тот же порт, что и у будущего PostgreSQL-адаптера.
 *
 * Раскладка повторяет слои из плана, только каталогами вместо таблиц:
 *
 *   runs/<id>/raw.jsonl          bronze — как пришло
 *   runs/<id>/normalized.jsonl   silver — канон
 *   runs/<id>/quarantine.jsonl   отвергнутое с причиной
 *   runs/<id>/catalog.jsonl      gold — позиции каталога
 *   runs/<id>/decisions.jsonl    аудит матчинга
 *   runs/<id>/summary.json       ПИШЕТСЯ ПОСЛЕДНИМ
 *
 * `summary.json` — маркер завершённости, и это несущая деталь: прогон,
 * оборвавшийся на середине, не имеет summary, а значит не считается
 * завершённым и не подменяет собой прошлый каталог. Тот же приём, что и
 * атомарная подмена симлинка при выкладке.
 *
 * JSONL, а не один JSON: строку можно дописать, не перечитывая файл, — это
 * сохраняет потоковость приёма, ради которой в порту сделана запись порциями.
 */

import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  CatalogItem, MatchDecision, NormalizedRecord, QuarantinedRecord, RawSourceRecord, RunId,
} from '@catalog/domain';
import type { PreviousAssignment } from '@catalog/match';
import type {
  CatalogStore, PipelineRun, RunSnapshot, RunSummary, RunWriter,
} from '../ports.ts';
import { stableStringify } from '../serialize.ts';
import { assignmentOf } from './memory.ts';

/** Идентификатор прогона приходит снаружи и в путь файловой системы не годится. */
const safe = (id: string): string => id.replace(/[^A-Za-z0-9._-]/g, '_');

const readJsonl = async <T>(path: string): Promise<T[]> => {
  try {
    const text = await readFile(path, 'utf8');
    return text.split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l) as T);
  } catch {
    return [];
  }
};

const readJson = async <T>(path: string): Promise<T | undefined> => {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return undefined;
  }
};

export class FileStore implements CatalogStore {
  readonly name = 'file';

  private readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  private dir(runId: string): string {
    return join(this.root, 'runs', safe(runId));
  }

  async beginRun(run: PipelineRun): Promise<RunWriter> {
    const dir = this.dir(run.id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'run.json'), `${stableStringify(run, 2)}\n`, 'utf8');

    const append = (file: string) => async (batch: readonly unknown[]): Promise<void> => {
      if (batch.length === 0) return;
      const lines = batch.map((x) => stableStringify(x)).join('\n');
      await appendFile(join(dir, file), `${lines}\n`, 'utf8');
    };

    return {
      putRaw: append('raw.jsonl'),
      putQuarantined: append('quarantine.jsonl'),
      putNormalized: append('normalized.jsonl'),
      putDecisions: append('decisions.jsonl'),
      putCatalog: append('catalog.jsonl'),
      // Последним и отдельной операцией — см. комментарий к модулю.
      finish: async (summary: RunSummary) => {
        await writeFile(join(dir, 'summary.json'), `${stableStringify(summary, 2)}\n`, 'utf8');
      },
    };
  }

  async listRuns(): Promise<readonly PipelineRun[]> {
    let entries: string[];
    try {
      entries = await readdir(join(this.root, 'runs'));
    } catch {
      return [];
    }

    const runs: PipelineRun[] = [];
    for (const entry of entries) {
      const dir = join(this.root, 'runs', entry);
      const summary = await readJson<RunSummary>(join(dir, 'summary.json'));
      if (summary === undefined) continue; // незавершённый прогон
      const run = await readJson<PipelineRun>(join(dir, 'run.json'));
      if (run !== undefined) runs.push(run);
    }
    return runs.sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
  }

  async load(runId: RunId): Promise<RunSnapshot | undefined> {
    const dir = this.dir(runId);
    const run = await readJson<PipelineRun>(join(dir, 'run.json'));
    const summary = await readJson<RunSummary>(join(dir, 'summary.json'));
    if (run === undefined || summary === undefined) return undefined;
    return {
      run,
      summary,
      raw: await readJsonl<RawSourceRecord>(join(dir, 'raw.jsonl')),
      normalized: await readJsonl<NormalizedRecord>(join(dir, 'normalized.jsonl')),
      quarantined: await readJsonl<QuarantinedRecord>(join(dir, 'quarantine.jsonl')),
      catalog: await readJsonl<CatalogItem>(join(dir, 'catalog.jsonl')),
      decisions: await readJsonl<MatchDecision>(join(dir, 'decisions.jsonl')),
    };
  }

  async latest(): Promise<RunSnapshot | undefined> {
    const runs = await this.listRuns();
    const first = runs[0];
    return first === undefined ? undefined : this.load(first.id);
  }

  async previousAssignment(): Promise<PreviousAssignment> {
    return assignmentOf(await this.latest());
  }

  async knownHashes(): Promise<ReadonlySet<string>> {
    const snapshot = await this.latest();
    return new Set((snapshot?.raw ?? []).map((r) => r.contentHash));
  }
}
