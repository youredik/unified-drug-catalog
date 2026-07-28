/**
 * Схема хранения. Слои разведены схемами PostgreSQL, а не префиксами в именах:
 *
 *   bronze   как пришло от поставщика, без интерпретации
 *   silver   приведённое к канону, с флагами качества
 *   gold     каталог: позиции, провенанс по полям, связь с источниками
 *   audit    решения матчинга и события кластеризации
 *
 * Смысл разделения — воспроизводимость. Каталог можно пересобрать из bronze
 * любой версией правил и сравнить результаты (`catalog:diff`). Если бы сырьё
 * не сохранялось, любая правка правила была бы необратимой.
 *
 * Пакет знает только канонические типы из `domain` — это проверяется гейтом
 * `db-knows-only-domain`. Он не знает ни про приём, ни про матчинг, ни про
 * очередь; порт хранилища реализуется снаружи, в `pipeline`.
 */

import { sql } from 'drizzle-orm';
import {
  boolean, doublePrecision, index, integer, jsonb, pgSchema, primaryKey, text,
  timestamp, uniqueIndex,
} from 'drizzle-orm/pg-core';

export const bronze = pgSchema('bronze');
export const silver = pgSchema('silver');
export const gold = pgSchema('gold');
export const audit = pgSchema('audit');

// ─── bronze ──────────────────────────────────────────────────────────────────

/** Реестр источников: то, что в файловом варианте живёт в манифестах. */
export const source = bronze.table('source', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  contractVersion: text('contract_version').notNull(),
  format: text('format').notNull(),
  dateFormat: text('date_format').notNull(),
  manifest: jsonb('manifest').notNull(),
  registeredAt: timestamp('registered_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Прогон. `finished_at IS NULL` означает «идёт или оборвался»: такой прогон
 * не считается завершённым и не подменяет собой рабочий каталог. Тот же
 * приём, что и атомарная подмена симлинка при выкладке.
 */
export const pipelineRun = bronze.table('pipeline_run', {
  id: text('id').primaryKey(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  rulesetVersion: text('ruleset_version').notNull(),
  adjudicator: text('adjudicator').notNull(),
  summary: jsonb('summary'),
});

export const sourceRecord = bronze.table(
  'source_record',
  {
    runId: text('run_id').notNull().references(() => pipelineRun.id, { onDelete: 'cascade' }),
    id: text('id').notNull(),
    sourceId: text('source_id').notNull(),
    externalId: text('external_id').notNull(),
    payload: jsonb('payload').notNull(),
    /** Хэш канонизированного содержимого: основа идемпотентности приёма. */
    contentHash: text('content_hash').notNull(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull(),
    sourceContractVersion: text('source_contract_version').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.runId, t.id] }),
    index('source_record_hash_idx').on(t.contentHash),
  ],
);

/**
 * Транзакционный outbox.
 *
 * Событие пишется В ТОЙ ЖЕ транзакции, что и завершение прогона, а публикует
 * его отдельный воркер. Иначе есть окно, в котором прогон завершён, а событие
 * потеряно (или наоборот). Exactly-once между базой и брокером без внешнего
 * координатора недостижим; at-least-once плюс идемпотентный обработчик даёт
 * тот же наблюдаемый эффект.
 */
export const outbox = bronze.table(
  'outbox',
  {
    id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
    runId: text('run_id').notNull(),
    topic: text('topic').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (t) => [index('outbox_unpublished_idx').on(t.publishedAt)],
);

// ─── silver ──────────────────────────────────────────────────────────────────

export const normalizedRecord = silver.table(
  'normalized_record',
  {
    runId: text('run_id').notNull().references(() => pipelineRun.id, { onDelete: 'cascade' }),
    id: text('id').notNull(),
    sourceId: text('source_id').notNull(),
    externalId: text('external_id').notNull(),
    /** Канон целиком. Отдельные колонки ниже — только то, по чему ищем. */
    doc: jsonb('doc').notNull(),
    brandKey: text('brand_key').notNull(),
    gtin: text('gtin'),
    gtinValid: boolean('gtin_valid').notNull(),
    rulesetVersion: text('ruleset_version').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.runId, t.id] }),
    // Точная блокировка кандидатов по идентификатору.
    index('normalized_gtin_idx').on(t.gtin),
    // Нечёткая блокировка: триграммный индекс по ядру бренда. Именно он
    // не даёт перебору стать квадратичным на реальных объёмах.
    index('normalized_brand_trgm_idx').using('gin', sql`${t.brandKey} gin_trgm_ops`),
  ],
);

/** Отвергнутое — с типизированной причиной и куском исходных данных. */
export const quarantine = silver.table('quarantine', {
  id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
  runId: text('run_id').notNull().references(() => pipelineRun.id, { onDelete: 'cascade' }),
  sourceId: text('source_id').notNull(),
  externalId: text('external_id'),
  reason: jsonb('reason').notNull(),
  rawExcerpt: text('raw_excerpt').notNull(),
  quarantinedAt: timestamp('quarantined_at', { withTimezone: true }).notNull(),
});

// ─── gold ────────────────────────────────────────────────────────────────────

export const catalogItem = gold.table(
  'catalog_item',
  {
    runId: text('run_id').notNull().references(() => pipelineRun.id, { onDelete: 'cascade' }),
    id: text('id').notNull(),
    doc: jsonb('doc').notNull(),
    tradeName: text('trade_name').notNull(),
    brandCore: text('brand_core').notNull(),
    manufacturer: text('manufacturer').notNull(),
    gtin: text('gtin'),
    gtinValid: boolean('gtin_valid').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.runId, t.id] }),
    index('catalog_item_brand_trgm_idx').using('gin', sql`${t.brandCore} gin_trgm_ops`),
  ],
);

/**
 * Связь позиции с записями источников — отдельной таблицей, а не только
 * внутри JSON. Сохранение сведений обо всех источниках
 * должно быть запросом, а не разбором документа.
 */
export const catalogItemSource = gold.table(
  'catalog_item_source',
  {
    runId: text('run_id').notNull().references(() => pipelineRun.id, { onDelete: 'cascade' }),
    itemId: text('item_id').notNull(),
    sourceRecordId: text('source_record_id').notNull(),
    sourceId: text('source_id').notNull(),
  },
  (t) => [
    uniqueIndex('catalog_item_source_uq').on(t.runId, t.itemId, t.sourceRecordId),
    index('catalog_item_source_record_idx').on(t.runId, t.sourceRecordId),
  ],
);

// ─── audit ───────────────────────────────────────────────────────────────────

/**
 * Разбор каждого сравнения. Хранится не «склеили/не склеили», а вклад
 * каждого поля в вес: без этого на вопрос «почему эти две записи объединены»
 * нет ответа, а в каталоге лекарств такой ответ обязан быть.
 */
export const matchDecision = audit.table(
  'match_decision',
  {
    id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
    runId: text('run_id').notNull().references(() => pipelineRun.id, { onDelete: 'cascade' }),
    leftId: text('left_id').notNull(),
    rightId: text('right_id').notNull(),
    totalWeight: doublePrecision('total_weight').notNull(),
    probability: doublePrecision('probability').notNull(),
    zone: text('zone').notNull(),
    decidedBy: text('decided_by').notNull(),
    weights: jsonb('weights').notNull(),
    adjudication: jsonb('adjudication'),
    conflict: text('conflict'),
  },
  (t) => [
    index('match_decision_run_idx').on(t.runId, t.zone),
    index('match_decision_left_idx').on(t.runId, t.leftId),
  ],
);
