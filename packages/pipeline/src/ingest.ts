/**
 * Приём: коннекторы → сырые записи → канонические поля → нормализация.
 *
 * Здесь живёт разделение, ради которого весь пакет и существует:
 *
 *   не разобрали вообще        → карантин с типизированной причиной
 *   разобрали, не уложили      → карантин с типизированной причиной
 *   уложили, но поле сомнительно → запись ПРИНИМАЕТСЯ с флагом качества
 *
 * Ни одна запись не исчезает молча. Всё, что не прошло, лежит в карантине
 * с указанием причины и куском исходных данных — по нему видно, чинить
 * данные у поставщика или правило у себя.
 */

import { createHash } from 'node:crypto';
import type {
  IngestError, MappingError, NormalizedRecord, QuarantinedRecord, RawSourceRecord,
  RulesetVersion, RunId, SourceId, SourceManifest,
} from '@catalog/domain';
import { SourceRecordId } from '@catalog/domain';
import type { SourceConnector } from '@catalog/connectors';
import { normalizeRecord } from '@catalog/normalize';
import type { SourceIngestStats } from './ports.ts';
import { stableStringify } from './serialize.ts';

export interface IngestInput {
  readonly connectors: readonly SourceConnector[];
  readonly runId: RunId;
  readonly rulesetVersion: RulesetVersion;
  /** Время передаётся снаружи: иначе результат недетерминирован. */
  readonly ingestedAt: string;
  /** Хэши прошлого прогона — чтобы отчёт показал, что реально изменилось. */
  readonly knownHashes?: ReadonlySet<string>;
}

export interface IngestResult {
  readonly raw: readonly RawSourceRecord[];
  readonly normalized: readonly NormalizedRecord[];
  readonly quarantined: readonly QuarantinedRecord[];
  readonly perSource: readonly SourceIngestStats[];
  readonly manifests: readonly SourceManifest[];
  /** Мягкие ошибки: поле не разобралось, запись принята. Идут в отчёт качества. */
  readonly softErrors: readonly { readonly recordId: string; readonly error: MappingError }[];
}

/**
 * Хэш содержимого — по канонизированному представлению, а не по строке.
 * Иначе переставленные ключи или другой отступ у поставщика выглядят как
 * изменение данных, и каждый прогон объявляет изменившимся весь фид.
 */
export const contentHashOf = (payload: unknown): string =>
  createHash('sha256').update(stableStringify(payload)).digest('hex');

const excerpt = (payload: unknown, limit = 300): string => {
  const s = typeof payload === 'string' ? payload : stableStringify(payload);
  return s.length <= limit ? s : `${s.slice(0, limit)}…`;
};

export const ingest = async (input: IngestInput): Promise<IngestResult> => {
  const known = input.knownHashes ?? new Set<string>();

  const raw: RawSourceRecord[] = [];
  const normalized: NormalizedRecord[] = [];
  const quarantined: QuarantinedRecord[] = [];
  const perSource: SourceIngestStats[] = [];
  const softErrors: { recordId: string; error: MappingError }[] = [];

  for (const connector of input.connectors) {
    const manifest = connector.manifest;
    const sourceId = manifest.id as SourceId;
    let read = 0;
    let accepted = 0;
    let quarantinedHere = 0;
    let unchanged = 0;
    let softHere = 0;

    const quarantine = (reason: IngestError, externalId: string | undefined, payload: unknown): void => {
      quarantinedHere++;
      quarantined.push({
        sourceId,
        externalId,
        reason,
        rawExcerpt: excerpt(payload),
        quarantinedAt: input.ingestedAt,
      });
    };

    for await (const item of connector.readRecords()) {
      read++;

      if (!item.ok) {
        quarantine(item.error, undefined, '(запись не разобрана)');
        continue;
      }

      const payload = item.value;
      const contentHash = contentHashOf(payload);
      if (known.has(contentHash)) unchanged++;

      const mapped = connector.toMappedFields(payload);
      // Внешний идентификатор известен только после ACL: до него запись —
      // просто кусок чужого формата. Пока он неизвестен, роль ключа играет
      // порядковый номер в фиде.
      const externalId = mapped.ok ? mapped.value.externalId : `#${read}`;

      raw.push({
        id: SourceRecordId(`${manifest.id}:${externalId}`),
        sourceId,
        externalId,
        payload,
        contentHash,
        ingestedAt: input.ingestedAt,
        runId: input.runId,
        sourceContractVersion: manifest.contractVersion,
      });

      if (!mapped.ok) {
        quarantine(mapped.error, undefined, payload);
        continue;
      }

      const outcome = normalizeRecord(mapped.value, manifest, input.rulesetVersion);
      if (!outcome.ok) {
        quarantine(outcome.error, mapped.value.externalId, payload);
        continue;
      }

      accepted++;
      normalized.push(outcome.value.record);
      for (const error of outcome.value.softErrors) {
        softHere++;
        softErrors.push({ recordId: outcome.value.record.id, error });
      }
    }

    perSource.push({
      sourceId,
      read,
      accepted,
      quarantined: quarantinedHere,
      unchanged,
      softErrors: softHere,
    });
  }

  return {
    raw,
    normalized,
    quarantined,
    perSource,
    manifests: input.connectors.map((c) => c.manifest),
    softErrors,
  };
};
