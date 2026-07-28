/**
 * Хранилище в памяти. Реализация порта для тестов и для прогонов, которым
 * не нужна история: тот же контракт, что у файлового и у будущего
 * PostgreSQL-адаптера, поэтому конвейер их не различает.
 */

import type {
  CatalogItem, MatchDecision, NormalizedRecord, QuarantinedRecord, RawSourceRecord, RunId,
} from '@catalog/domain';
import type { PreviousAssignment } from '@catalog/match';
import type {
  CatalogStore, PipelineRun, RunSnapshot, RunSummary, RunWriter,
} from '../ports.ts';

interface Draft {
  readonly run: PipelineRun;
  readonly raw: RawSourceRecord[];
  readonly normalized: NormalizedRecord[];
  readonly quarantined: QuarantinedRecord[];
  readonly decisions: MatchDecision[];
  readonly catalog: CatalogItem[];
}

export class InMemoryStore implements CatalogStore {
  readonly name = 'memory';

  private readonly completed = new Map<string, RunSnapshot>();
  private order: string[] = [];

  async beginRun(run: PipelineRun): Promise<RunWriter> {
    const draft: Draft = {
      run, raw: [], normalized: [], quarantined: [], decisions: [], catalog: [],
    };
    const push = <T>(target: T[]) => async (batch: readonly T[]): Promise<void> => {
      target.push(...batch);
    };
    const commit = async (summary: RunSummary): Promise<void> => {
      this.completed.set(run.id, {
        run: draft.run,
        summary,
        raw: draft.raw,
        normalized: draft.normalized,
        quarantined: draft.quarantined,
        catalog: draft.catalog,
        decisions: draft.decisions,
      });
      this.order = [run.id, ...this.order.filter((id) => id !== run.id)];
    };
    return {
      putRaw: push(draft.raw),
      putQuarantined: push(draft.quarantined),
      putNormalized: push(draft.normalized),
      putDecisions: push(draft.decisions),
      putCatalog: push(draft.catalog),
      finish: commit,
    };
  }

  async listRuns(): Promise<readonly PipelineRun[]> {
    return this.order.map((id) => this.completed.get(id)!.run);
  }

  async load(runId: RunId): Promise<RunSnapshot | undefined> {
    return this.completed.get(runId);
  }

  async latest(): Promise<RunSnapshot | undefined> {
    const id = this.order[0];
    return id === undefined ? undefined : this.completed.get(id);
  }

  async previousAssignment(): Promise<PreviousAssignment> {
    const snapshot = await this.latest();
    return assignmentOf(snapshot);
  }

  async knownHashes(): Promise<ReadonlySet<string>> {
    const snapshot = await this.latest();
    return new Set((snapshot?.raw ?? []).map((r) => r.contentHash));
  }
}

/** Разворачивает каталог обратно в «запись → позиция»: общее для всех адаптеров. */
export const assignmentOf = (snapshot: RunSnapshot | undefined): PreviousAssignment => {
  const map = new Map<NormalizedRecord['id'], CatalogItem['id']>();
  for (const item of snapshot?.catalog ?? []) {
    for (const recordId of item.sources) map.set(recordId, item.id);
  }
  return map;
};
