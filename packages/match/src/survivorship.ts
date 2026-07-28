/**
 * Золотая запись и провенанс по полям.
 *
 * Ключевое: выживание считается ПО КАЖДОМУ ПОЛЮ ОТДЕЛЬНО, а не по источнику
 * целиком. Видно прямо на данных: источник C даёт самое полное наименование
 * юрлица — и он же ошибается по лекарственной форме, заявляя уточнение,
 * которого нет в его собственном структурном поле. Источник, точный в одном
 * поле и неверный в другом, — норма, поэтому глобальный рейтинг источников
 * неверен по построению.
 *
 * Порядок правил:
 *
 *   1. verified_specificity   более специфичное значение, но ТОЛЬКО если
 *                             специфичность подтверждается структурно
 *                             (вложенность имён организаций) — а не «выглядит
 *                             подробнее»;
 *   2. source_trust_for_field доверие к источнику по данному полю;
 *   3. completeness           у кого поле вообще заполнено;
 *   4. recency                свежесть записи;
 *   5. only_candidate         вариант был один.
 *
 * Непроверяемое уточнение не побеждает — оно фиксируется как конфликт.
 * Именно поэтому `Film-coated` не вытесняет `Tablet`, а остаётся видимым
 * расхождением, которое можно поднять поставщику.
 */

import type {
  CatalogItem, FieldProvenance, NormalizedRecord, QualityFlag, RulesetVersion,
  RunId, SourceId, SourceManifest, SourceRecordId,
} from '@catalog/domain';
import { moreSpecificOrganization } from '@catalog/normalize';
import type { Cluster } from './clustering.ts';

export type TrustLookup = (sourceId: SourceId) => SourceManifest['trust'];

interface Candidate<T> {
  readonly sourceId: SourceId;
  readonly recordId: SourceRecordId;
  readonly value: T;
  readonly display: string;
}

interface Winner<T> {
  readonly value: T;
  readonly provenance: FieldProvenance;
}

/**
 * Общий отбор победителя. `specificity` возвращает более специфичное из двух
 * значений, если это МОЖНО ПРОВЕРИТЬ, и `undefined`, если нельзя — тогда
 * расхождение уходит в конфликт вместо тихого выбора.
 */
const elect = <T>(
  field: string,
  candidates: readonly Candidate<T>[],
  trustOf: (c: Candidate<T>) => number,
  specificity?: (a: T, b: T) => T | undefined,
): Winner<T> | undefined => {
  if (candidates.length === 0) return undefined;

  const distinct = new Map<string, Candidate<T>>();
  for (const c of candidates) if (!distinct.has(c.display)) distinct.set(c.display, c);

  const competitors = candidates.map((c) => ({ sourceId: c.sourceId, value: c.display }));

  if (distinct.size === 1) {
    const only = candidates[0]!;
    return {
      value: only.value,
      provenance: {
        field,
        sourceId: only.sourceId,
        sourceRecordId: only.recordId,
        rule: candidates.length === 1 ? 'only_candidate' : 'source_trust_for_field',
        value: only.display,
        competitors,
        conflict: false,
      },
    };
  }

  // 1. Проверяемая специфичность.
  if (specificity !== undefined) {
    let best = candidates[0]!;
    let verified = true;
    for (const c of candidates.slice(1)) {
      const more = specificity(best.value, c.value);
      if (more === undefined) {
        verified = false;
        break;
      }
      best = more === c.value ? c : best;
    }
    if (verified) {
      return {
        value: best.value,
        provenance: {
          field,
          sourceId: best.sourceId,
          sourceRecordId: best.recordId,
          rule: 'verified_specificity',
          value: best.display,
          competitors,
          conflict: false,
        },
      };
    }
  }

  // 2. Доверие к источнику по этому полю. Расхождение остаётся конфликтом
  //    даже после выбора победителя — оно не исчезает, оно задокументировано.
  const byTrust = [...candidates].sort((a, b) => {
    const d = trustOf(b) - trustOf(a);
    return d !== 0 ? d : a.recordId < b.recordId ? -1 : 1;
  });
  const winner = byTrust[0]!;
  return {
    value: winner.value,
    provenance: {
      field,
      sourceId: winner.sourceId,
      sourceRecordId: winner.recordId,
      rule: 'source_trust_for_field',
      value: winner.display,
      competitors,
      conflict: true,
    },
  };
};

const collect = <T>(
  members: readonly NormalizedRecord[],
  get: (r: NormalizedRecord) => T | undefined,
  show: (v: T) => string,
): Candidate<T>[] =>
  members.flatMap((r) => {
    const value = get(r);
    return value === undefined
      ? []
      : [{ sourceId: r.sourceId, recordId: r.id, value, display: show(value) }];
  });

export interface GoldenRecordInput {
  readonly cluster: Cluster;
  readonly trustOf: TrustLookup;
  readonly runId: RunId;
  readonly rulesetVersion: RulesetVersion;
}

export const buildGoldenRecord = ({
  cluster, trustOf, runId, rulesetVersion,
}: GoldenRecordInput): CatalogItem => {
  const { members } = cluster;
  const provenance: FieldProvenance[] = [];
  const trust = (field: keyof SourceManifest['trust']) => (c: { sourceId: SourceId }) =>
    trustOf(c.sourceId)[field];

  const tradeName = elect('tradeName', collect(members, (r) => r.tradeName, String), trust('tradeName'));
  const brandCore = elect('brandCore', collect(members, (r) => r.brandCore, String), trust('tradeName'));

  // Производитель — единственное поле, где специфичность ПРОВЕРЯЕМА:
  // одно имя структурно вложено в другое. Здесь уточнение побеждает законно.
  const manufacturer = elect(
    'manufacturer',
    collect(members, (r) => (r.manufacturerRaw === '' ? undefined : r.manufacturerRaw), String),
    trust('manufacturer'),
    moreSpecificOrganization,
  );

  const gtin = elect('gtin', collect(members, (r) => r.gtin, String), trust('gtin'));
  const strength = elect('strength', collect(members, (r) => r.strength, (v) => JSON.stringify(v)), trust('strength'));

  // Лекформа: сравнение и выбор идут по БАЗОВОЙ форме. Уточнение (`full`)
  // намеренно НЕ участвует в специфичности — оно непроверяемо, и в этих самых
  // данных оно неверно.
  const doseFormBasic = elect(
    'doseForm',
    collect(members, (r) => r.doseForm?.basic, String),
    trust('doseForm'),
  );
  const refinements = new Set(
    members.flatMap((r) => (r.doseForm?.full === undefined ? [] : [r.doseForm.full])),
  );

  const pack = elect('pack', collect(members, (r) => r.pack, (v) => `${v.count} ${v.unitOfPresentation}`), trust('pack'));
  const country = elect('country', collect(members, (r) => r.country, String), trust('country'));
  const registeredAt = elect('registeredAt', collect(members, (r) => r.registeredAt, String), trust('registeredAt'));
  const rxStatus = elect('rxStatus', collect(members, (r) => (r.rxStatus === 'unknown' ? undefined : r.rxStatus), String), trust('rxStatus'));

  for (const w of [tradeName, brandCore, manufacturer, gtin, strength, doseFormBasic, pack, country, registeredAt, rxStatus]) {
    if (w !== undefined) provenance.push(w.provenance);
  }

  // Заявленное уточнение формы сохраняется как отдельная строка провенанса
  // с пометкой конфликта: расхождение видно, но победителем не назначено.
  if (refinements.size > 0) {
    const claimant = members.find((r) => r.doseForm?.full !== undefined)!;
    provenance.push({
      field: 'doseForm.refinement',
      sourceId: claimant.sourceId,
      sourceRecordId: claimant.id,
      rule: 'source_trust_for_field',
      value: [...refinements].join(', '),
      competitors: members.map((r) => ({ sourceId: r.sourceId, value: r.doseForm?.full ?? '—' })),
      conflict: true,
    });
  }

  const flags = [...new Set(members.flatMap((r) => r.qualityFlags))] as QualityFlag[];
  const inn = [...new Set(members.flatMap((r) => r.inn))];
  const atc = members.find((r) => r.atc !== undefined)?.atc;
  const doseForm = doseFormBasic === undefined ? undefined : { basic: doseFormBasic.value };

  return {
    id: cluster.id,
    tradeName: tradeName?.value ?? members[0]!.tradeName,
    brandCore: brandCore?.value ?? members[0]!.brandCore,
    manufacturer: manufacturer?.value ?? '',
    ...(gtin === undefined ? {} : { gtin: gtin.value }),
    gtinValid: members.some((r) => r.gtinValid),
    ...(pack === undefined ? {} : { pack: pack.value }),
    ...(country === undefined ? {} : { country: country.value }),
    ...(registeredAt === undefined ? {} : { registeredAt: registeredAt.value }),
    attributes: {
      kind: 'medicine',
      inn,
      ...(doseForm === undefined ? {} : { doseForm }),
      ...(strength === undefined ? {} : { strength: strength.value }),
      rxStatus: rxStatus?.value ?? 'unknown',
      ...(atc === undefined ? {} : { atc }),
    },
    sources: members.map((r) => r.id),
    provenance,
    qualityFlags: flags,
    runId,
    rulesetVersion,
  };
};
