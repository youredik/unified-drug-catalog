/**
 * Реестр источников: три манифеста и три коннектора.
 *
 * Всё, что отличает одну аптечную сеть от другой, объявлено здесь данными,
 * а не размазано по коду. Чтобы подключить четвёртую, нужно добавить манифест,
 * ACL и точку входа в реестр — и прогнать conformance-набор.
 *
 * Веса доверия оставлены нейтральными намеренно. Соблазн был занизить
 * `doseForm` источнику C, раз он единожды ошибся, — но это подгонка под три
 * записи. Расхождение по лекформе снимается правилом выживания «проверяемая
 * специфичность» (уточнение без подтверждения справочником = конфликт),
 * а веса калибруются на реальных объёмах по отчёту качества.
 */

import {
  err, ok, sourceManifestSchema,
  type MappedFields, type MappingError, type ParseError, type Result, type SourceManifest,
} from '@catalog/domain';
import { mapSourceA } from './acl/source-a.ts';
import { mapSourceB } from './acl/source-b.ts';
import { mapSourceC } from './acl/source-c.ts';
import { parseJsonSafely } from './parsers/json.ts';
import { parseXmlSafely } from './parsers/xml.ts';
import { asArray, pick, type SourceConnector } from './spi.ts';
import { openTransport, readAllText } from './transports/index.ts';

const DATA_DIR = new URL('../../../data/sources/', import.meta.url).pathname;

export const MANIFESTS: readonly SourceManifest[] = [
  sourceManifestSchema.parse({
    id: 'chain-a',
    name: 'Аптечная сеть A',
    contractVersion: '2026-07-01',
    transport: { type: 'file', path: `${DATA_DIR}chain-a.json` },
    format: 'json',
    dateFormat: 'ISO_8601',
    // Источник присылает `dosage_mg: 200` голым числом. Единица объявлена
    // здесь, а не выводится из имени поля.
    defaultStrengthUnit: 'mg',
  }),
  sourceManifestSchema.parse({
    id: 'chain-b',
    name: 'Аптечная сеть B',
    contractVersion: '2026-07-01',
    transport: { type: 'file', path: `${DATA_DIR}chain-b.xml` },
    format: 'xml',
    // `15.01.2023`. Формат объявлен: `03.04.2023` без объявления неразрешима.
    dateFormat: 'DD.MM.YYYY',
  }),
  sourceManifestSchema.parse({
    id: 'chain-c',
    name: 'Аптечная сеть C',
    contractVersion: '2026-07-01',
    transport: { type: 'file', path: `${DATA_DIR}chain-c.json` },
    format: 'json',
    dateFormat: 'YYYY/MM/DD',
  }),
];

/** Где в разобранном документе лежат записи о товарах — своё у каждой сети. */
type RecordExtractor = (parsed: unknown) => readonly unknown[];

const EXTRACTORS: Readonly<Record<string, RecordExtractor>> = {
  'chain-a': (parsed) => asArray(parsed),
  'chain-b': (parsed) => asArray(pick(parsed, 'catalogue', 'item')),
  'chain-c': (parsed) => asArray(pick(parsed, 'products')),
};

const MAPPERS: Readonly<Record<string, (p: unknown) => Result<MappedFields, MappingError>>> = {
  'chain-a': mapSourceA,
  'chain-b': mapSourceB,
  'chain-c': mapSourceC,
};

class FileBackedConnector implements SourceConnector {
  readonly manifest: SourceManifest;
  constructor(manifest: SourceManifest) {
    this.manifest = manifest;
  }

  async *readRecords(): AsyncIterable<Result<unknown, ParseError>> {
    const transport = await openTransport(this.manifest.transport);
    if (!transport.ok) {
      yield err({ kind: 'malformed_payload', detail: transport.error.kind });
      return;
    }

    const text = await readAllText(transport.value);
    const parsed =
      this.manifest.format === 'xml'
        ? parseXmlSafely(text, this.manifest.limits)
        : parseJsonSafely(text, this.manifest.limits);

    if (!parsed.ok) {
      yield err(parsed.error);
      return;
    }

    const extract = EXTRACTORS[this.manifest.id];
    if (extract === undefined) {
      yield err({ kind: 'malformed_payload', detail: `нет экстрактора для ${this.manifest.id}` });
      return;
    }

    for (const record of extract(parsed.value)) yield ok(record);
  }

  toMappedFields(payload: unknown): Result<MappedFields, MappingError> {
    const map = MAPPERS[this.manifest.id];
    if (map === undefined) {
      return err({ kind: 'required_field_absent', field: `ACL для ${this.manifest.id}` });
    }
    return map(payload);
  }
}

export const buildConnectors = (): readonly SourceConnector[] =>
  MANIFESTS.map((m) => new FileBackedConnector(m));

export const connectorFor = (sourceId: string): SourceConnector | undefined =>
  buildConnectors().find((c) => c.manifest.id === sourceId);
