/**
 * Прогон целиком: приём → нормализация → разрешение тождества → сохранение.
 *
 * Это императивная оболочка вокруг чистого ядра. Всё, что здесь есть, —
 * порядок вызовов, работа с хранилищем и гейты качества; ни одного правила
 * нормализации или матчинга в этом файле нет и быть не должно.
 *
 * Гейт качества — не украшение. Прогон, у которого треть записей уехала
 * в карантин, технически «успешен»: он что-то посчитал. Подменять им рабочий
 * каталог нельзя, поэтому при провале гейта прогон НЕ завершается,
 * и `latest()` продолжает отдавать прошлый, целый.
 */

import type { RulesetVersion, RunId } from '@catalog/domain';
import type { SourceConnector } from '@catalog/connectors';
import { resolve, type AdjudicatorPort, type ScoringConfig } from '@catalog/match';
import { ingest } from './ingest.ts';
import type { CatalogStore, RunSnapshot, RunSummary } from './ports.ts';

/**
 * Пороги подобраны так, чтобы ловить обвал, а не колебание: сорванный фид
 * или сменившийся у поставщика контракт видны сразу, а одна плохая запись
 * из ста прогон не валит.
 */
export interface QualityGates {
  readonly maxQuarantineRatio: number;
  readonly minAcceptedRecords: number;
  readonly maxInvalidGtinRatio: number;
}

export const DEFAULT_GATES: QualityGates = {
  maxQuarantineRatio: 0.1,
  minAcceptedRecords: 1,
  // Порог высокий намеренно: в исходных данных невалидная контрольная цифра
  // у единственного товара, то есть 100%. Гейт ловит не «данные неидеальны»,
  // а «стало заметно хуже, чем было». Калибруется по отчёту на реальном объёме.
  maxInvalidGtinRatio: 1,
};

export interface GateFailure {
  readonly gate: keyof QualityGates;
  readonly observed: number;
  readonly limit: number;
  readonly detail: string;
}

export interface RunPipelineInput {
  readonly connectors: readonly SourceConnector[];
  readonly adjudicator: AdjudicatorPort;
  readonly store: CatalogStore;
  readonly runId: RunId;
  readonly rulesetVersion: RulesetVersion;
  /** Время — вход, а не обращение к часам внутри: иначе прогон невоспроизводим. */
  readonly now: string;
  readonly config?: ScoringConfig;
  readonly gates?: QualityGates;
}

export interface RunPipelineResult {
  readonly snapshot: RunSnapshot;
  readonly gateFailures: readonly GateFailure[];
  readonly committed: boolean;
}

const checkGates = (
  gates: QualityGates,
  accepted: number,
  quarantined: number,
  invalidGtin: number,
): readonly GateFailure[] => {
  const total = accepted + quarantined;
  const failures: GateFailure[] = [];

  const quarantineRatio = total === 0 ? 0 : quarantined / total;
  if (quarantineRatio > gates.maxQuarantineRatio) {
    failures.push({
      gate: 'maxQuarantineRatio',
      observed: quarantineRatio,
      limit: gates.maxQuarantineRatio,
      detail: `в карантине ${quarantined} из ${total}`,
    });
  }

  if (accepted < gates.minAcceptedRecords) {
    failures.push({
      gate: 'minAcceptedRecords',
      observed: accepted,
      limit: gates.minAcceptedRecords,
      detail: 'принято меньше записей, чем допустимо: похоже на сорванный приём',
    });
  }

  const invalidRatio = accepted === 0 ? 0 : invalidGtin / accepted;
  if (invalidRatio > gates.maxInvalidGtinRatio) {
    failures.push({
      gate: 'maxInvalidGtinRatio',
      observed: invalidRatio,
      limit: gates.maxInvalidGtinRatio,
      detail: `невалидная контрольная цифра у ${invalidGtin} из ${accepted}`,
    });
  }

  return failures;
};

export const runPipeline = async (input: RunPipelineInput): Promise<RunPipelineResult> => {
  const run = {
    id: input.runId,
    startedAt: input.now,
    rulesetVersion: input.rulesetVersion,
    adjudicator: input.adjudicator.name,
  };

  const writer = await input.store.beginRun(run);

  const knownHashes = await input.store.knownHashes();
  const ingested = await ingest({
    connectors: input.connectors,
    runId: input.runId,
    rulesetVersion: input.rulesetVersion,
    ingestedAt: input.now,
    knownHashes,
  });

  await writer.putRaw(ingested.raw);
  await writer.putQuarantined(ingested.quarantined);
  await writer.putNormalized(ingested.normalized);

  const manifestById = new Map(ingested.manifests.map((m) => [m.id, m]));
  const previous = await input.store.previousAssignment();

  const resolved = await resolve({
    records: ingested.normalized,
    trustOf: (sourceId) => manifestById.get(sourceId)!.trust,
    runId: input.runId,
    rulesetVersion: input.rulesetVersion,
    adjudicator: input.adjudicator,
    previous,
    ...(input.config === undefined ? {} : { config: input.config }),
  });

  await writer.putDecisions(resolved.decisions);
  await writer.putCatalog(resolved.catalog);

  const summary: RunSummary = {
    finishedAt: input.now,
    sourceRecords: ingested.normalized.length,
    quarantined: ingested.quarantined.length,
    items: resolved.catalog.length,
    pendingReview: resolved.pendingReview.length,
    adjudicated: resolved.adjudicatedCount,
    perSource: ingested.perSource,
  };

  const gateFailures = checkGates(
    input.gates ?? DEFAULT_GATES,
    ingested.normalized.length,
    ingested.quarantined.length,
    ingested.normalized.filter((r) => r.gtin !== undefined && !r.gtinValid).length,
  );

  if (gateFailures.length === 0) await writer.finish(summary);

  return {
    snapshot: {
      run,
      summary,
      raw: ingested.raw,
      normalized: ingested.normalized,
      quarantined: ingested.quarantined,
      catalog: resolved.catalog,
      decisions: resolved.decisions,
    },
    gateFailures,
    committed: gateFailures.length === 0,
  };
};
