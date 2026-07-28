/**
 * Детерминированная сериализация каталога.
 *
 * «Детерминированная» здесь означает буквально: одни и те же входные данные
 * дают побайтово один и тот же файл. Без этого golden-снапшот проверяет
 * случайность, а `catalog:diff` показывает шум вместо изменений.
 *
 * Поэтому время и идентификатор прогона — ВХОДНЫЕ ПАРАМЕТРЫ, а не результат
 * обращения к часам внутри. Функция, которая сама смотрит на `Date.now()`,
 * недетерминирована по построению, и никакая сортировка ключей этого не лечит.
 */

import type {
  CatalogItem, FieldProvenance, NormalizedRecord, RulesetVersion, RunId,
  SourceManifest, SourceRecordId,
} from '@catalog/domain';

/**
 * JSON со стабильным порядком ключей на любой глубине.
 *
 * Порядок ключей в объекте JavaScript зависит от порядка присваивания, а он
 * зависит от порядка веток в коде. `JSON.stringify` это наследует — и файл
 * начинает меняться от безобидной правки. Здесь порядок задаётся сортировкой.
 */
export const stableStringify = (value: unknown, indent = 0): string => {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === 'object') {
      const entries = Object.entries(v as Record<string, unknown>)
        .filter(([, val]) => val !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return Object.fromEntries(entries.map(([k, val]) => [k, walk(val)]));
    }
    return v;
  };
  return JSON.stringify(walk(value), null, indent);
};

/** Ссылка на источник в выгрузке: не голый идентификатор, а откуда он. */
export interface SourceRef {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly sourceRecordId: string;
  readonly externalId: string;
  readonly contractVersion: string;
}

export interface SerializeInput {
  readonly catalog: readonly CatalogItem[];
  readonly records: readonly NormalizedRecord[];
  readonly manifests: readonly SourceManifest[];
  readonly runId: RunId;
  readonly rulesetVersion: RulesetVersion;
  /** Время передаётся снаружи — см. комментарий к модулю. */
  readonly generatedAt: string;
}

const refFor = (
  id: SourceRecordId,
  byId: ReadonlyMap<string, NormalizedRecord>,
  manifestOf: (sourceId: string) => SourceManifest | undefined,
): SourceRef => {
  const record = byId.get(id);
  const sourceId = record?.sourceId ?? 'unknown';
  const manifest = manifestOf(sourceId);
  return {
    sourceId,
    sourceName: manifest?.name ?? sourceId,
    sourceRecordId: id,
    externalId: record?.externalId ?? '',
    contractVersion: manifest?.contractVersion ?? '',
  };
};

const provenanceView = (p: FieldProvenance) => ({
  field: p.field,
  value: p.value,
  wonBy: p.rule,
  sourceId: p.sourceId,
  sourceRecordId: p.sourceRecordId,
  conflict: p.conflict,
  competitors: p.competitors.map((c) => ({ sourceId: c.sourceId, value: c.value })),
});

const itemView = (
  item: CatalogItem,
  byId: ReadonlyMap<string, NormalizedRecord>,
  manifestOf: (sourceId: string) => SourceManifest | undefined,
) => ({
  id: item.id,
  tradeName: item.tradeName,
  brandCore: item.brandCore,
  manufacturer: item.manufacturer,
  // Идентификатор идёт вместе с признаком валидности, а не отдельным полем
  // где-то ниже: потребитель каталога не должен догадываться, можно ли на нём
  // строить тождество.
  gtin: item.gtin === undefined ? null : { value: item.gtin, checkDigitValid: item.gtinValid },
  pack: item.pack ?? null,
  country: item.country ?? null,
  registeredAt: item.registeredAt ?? null,
  attributes: item.attributes,
  qualityFlags: [...item.qualityFlags].sort(),
  // Сведения обо всех источниках — вот они.
  sources: [...item.sources]
    .sort()
    .map((id) => refFor(id, byId, manifestOf)),
  provenance: [...item.provenance]
    .sort((a, b) => (a.field < b.field ? -1 : a.field > b.field ? 1 : 0))
    .map(provenanceView),
  // Расхождения вынесены отдельным списком, чтобы их было видно без чтения
  // всего провенанса. Они не погашены выбором победителя — они зафиксированы.
  conflicts: item.provenance
    .filter((p) => p.conflict)
    .map((p) => ({
      field: p.field,
      chosen: p.value,
      chosenFrom: p.sourceId,
      rejected: p.competitors
        .filter((c) => c.value !== p.value)
        .map((c) => `${c.sourceId}: ${c.value}`),
    })),
});

export const buildCatalogDocument = (input: SerializeInput): Record<string, unknown> => {
  const byId = new Map(input.records.map((r) => [r.id as string, r]));
  const manifestById = new Map(input.manifests.map((m) => [m.id, m]));
  const manifestOf = (id: string): SourceManifest | undefined => manifestById.get(id);

  const items = [...input.catalog]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((item) => itemView(item, byId, manifestOf));

  return {
    catalogVersion: 1,
    generatedAt: input.generatedAt,
    runId: input.runId,
    rulesetVersion: input.rulesetVersion,
    sources: [...input.manifests]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((m) => ({
        id: m.id,
        name: m.name,
        contractVersion: m.contractVersion,
        format: m.format,
        dateFormat: m.dateFormat,
        records: input.records.filter((r) => r.sourceId === m.id).length,
      })),
    stats: {
      sourceRecords: input.records.length,
      items: items.length,
      merged: input.records.length - items.length,
      withInvalidGtin: items.filter(
        (i) => i.gtin !== null && !i.gtin.checkDigitValid,
      ).length,
      withConflicts: items.filter((i) => i.conflicts.length > 0).length,
    },
    items,
  };
};

export const serializeCatalog = (input: SerializeInput): string =>
  `${stableStringify(buildCatalogDocument(input), 2)}\n`;
