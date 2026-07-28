/**
 * Сквозной проход разрешения тождества: записи → каталог.
 *
 *   блокировка → оценка Fellegi–Sunter → арбитраж серой зоны →
 *   кластеризация → золотые записи с провенансом
 *
 * Функция чистая: ни БД, ни файлов, ни сети. Арбитр приходит портом, поэтому
 * тот же код считает и базовую линию (с `NoopAdjudicator`), и версию с моделью —
 * а значит вклад модели можно померить, а не заявить.
 */

import type {
  CatalogItem, MatchDecision, NormalizedRecord, RulesetVersion, RunId, SourceRecordId,
} from '@catalog/domain';
import {
  applyVerdicts, requestKey, type AdjudicationRequest, type AdjudicatorPort,
} from './adjudicator.ts';
import { blockCandidates, type BlockingStats } from './blocking.ts';
import { clusterRecords, type ClusterEvent, type PreviousAssignment } from './clustering.ts';
import { DEFAULT_CONFIG, scorePair, toDecision, type ScoringConfig } from './fellegi-sunter.ts';
import { buildGoldenRecord, type TrustLookup } from './survivorship.ts';

export interface ResolveInput {
  readonly records: readonly NormalizedRecord[];
  readonly trustOf: TrustLookup;
  readonly runId: RunId;
  readonly rulesetVersion: RulesetVersion;
  readonly adjudicator: AdjudicatorPort;
  readonly config?: ScoringConfig;
  readonly previous?: PreviousAssignment;
}

export interface ResolveResult {
  readonly catalog: readonly CatalogItem[];
  readonly decisions: readonly MatchDecision[];
  readonly events: readonly ClusterEvent[];
  readonly blocking: BlockingStats;
  /** Пары, оставшиеся неопределёнными: очередь ручного разбора. */
  readonly pendingReview: readonly MatchDecision[];
  readonly adjudicatedCount: number;
}

export const resolve = async ({
  records, trustOf, runId, rulesetVersion, adjudicator,
  config = DEFAULT_CONFIG, previous = new Map(),
}: ResolveInput): Promise<ResolveResult> => {
  const { pairs, stats } = blockCandidates(records);

  const scored = pairs.map((p) => scorePair(p.left, p.right, config));
  let decisions: readonly MatchDecision[] = scored.map(toDecision);

  // К арбитру уходит ТОЛЬКО зона неопределённости — там, где правила дают
  // ложноположительные. Пары с конфликтом по идентификатору не отдаются модели:
  // это ошибка поставщика, её должен видеть человек.
  const greyZone: AdjudicationRequest[] = [];
  for (let i = 0; i < scored.length; i++) {
    const s = scored[i]!;
    if (s.zone === 'possible' && s.conflict === undefined) {
      greyZone.push({ left: pairs[i]!.left, right: pairs[i]!.right, scored: s });
    }
  }

  const verdicts = greyZone.length > 0 ? await adjudicator.adjudicate(greyZone) : new Map();
  decisions = applyVerdicts(decisions, verdicts);

  const matchedPairs: (readonly [SourceRecordId, SourceRecordId])[] = decisions
    .filter((d) => d.zone === 'match')
    .map((d) => [d.leftId, d.rightId] as const);

  const { clusters, events } = clusterRecords(records, matchedPairs, previous);

  return {
    catalog: clusters.map((cluster) =>
      buildGoldenRecord({ cluster, trustOf, runId, rulesetVersion }),
    ),
    decisions,
    events,
    blocking: stats,
    pendingReview: decisions.filter((d) => d.zone === 'possible'),
    adjudicatedCount: verdicts.size,
  };
};

export { requestKey };
