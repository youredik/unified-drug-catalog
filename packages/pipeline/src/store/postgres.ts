/**
 * Адаптер хранилища на PostgreSQL — та же реализация порта, что и файловая.
 *
 * Конвейер их не различает: `runPipeline` работает с `CatalogStore`, а какой
 * именно, решает композиционный корень. Это и есть проверка того, что порт
 * проведён по правильной границе, — вторая реализация не потребовала ни одной
 * правки в ядре.
 *
 * Два момента, которые легко сделать неправильно:
 *
 *   1. Завершение прогона и запись события в outbox идут ОДНОЙ транзакцией.
 *      Иначе появляется окно, где каталог обновлён, а потребитель об этом
 *      не узнал (или наоборот — узнал о том, чего нет).
 *   2. Незавершённый прогон (`finished_at IS NULL`) не виден `latest()`.
 *      Упавший ночной прогон не должен подменять рабочий каталог.
 */

import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { openDb, schema, type Db } from '@catalog/db';
import { RulesetVersion, RunId, SourceId, SourceRecordId } from '@catalog/domain';
import type {
  CatalogItem, MatchDecision, NormalizedRecord, QuarantinedRecord, RawSourceRecord,
} from '@catalog/domain';
import type { PreviousAssignment } from '@catalog/match';
import type {
  CatalogStore, PipelineRun, RunSnapshot, RunSummary, RunWriter,
} from '../ports.ts';
import { assignmentOf } from './memory.ts';

/** Порция вставки: у PostgreSQL предел в 65535 параметров на запрос. */
const CHUNK = 500;

const chunked = <T>(items: readonly T[]): readonly (readonly T[])[] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
};

export class PostgresStore implements CatalogStore {
  readonly name = 'postgres';

  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  static open(connectionString?: string): PostgresStore {
    return new PostgresStore(openDb(connectionString));
  }

  async close(): Promise<void> {
    await this.db.close();
  }

  async beginRun(run: PipelineRun): Promise<RunWriter> {
    const orm = this.db.orm;
    await orm
      .insert(schema.pipelineRun)
      .values({
        id: run.id,
        startedAt: new Date(run.startedAt),
        rulesetVersion: run.rulesetVersion,
        adjudicator: run.adjudicator,
      })
      .onConflictDoNothing();

    return {
      putRaw: async (batch: readonly RawSourceRecord[]) => {
        for (const part of chunked(batch)) {
          await orm.insert(schema.sourceRecord).values(
            part.map((r) => ({
              runId: run.id,
              id: r.id,
              sourceId: r.sourceId,
              externalId: r.externalId,
              payload: r.payload,
              contentHash: r.contentHash,
              ingestedAt: new Date(r.ingestedAt),
              sourceContractVersion: r.sourceContractVersion,
            })),
          ).onConflictDoNothing();
        }
      },

      putQuarantined: async (batch: readonly QuarantinedRecord[]) => {
        for (const part of chunked(batch)) {
          await orm.insert(schema.quarantine).values(
            part.map((q) => ({
              runId: run.id,
              sourceId: q.sourceId,
              externalId: q.externalId ?? null,
              reason: q.reason,
              rawExcerpt: q.rawExcerpt,
              quarantinedAt: new Date(q.quarantinedAt),
            })),
          );
        }
      },

      putNormalized: async (batch: readonly NormalizedRecord[]) => {
        for (const part of chunked(batch)) {
          await orm.insert(schema.normalizedRecord).values(
            part.map((r) => ({
              runId: run.id,
              id: r.id,
              sourceId: r.sourceId,
              externalId: r.externalId,
              doc: r,
              brandKey: r.brandKey,
              gtin: r.gtin ?? null,
              gtinValid: r.gtinValid,
              rulesetVersion: r.rulesetVersion,
            })),
          ).onConflictDoNothing();
        }
      },

      putDecisions: async (batch: readonly MatchDecision[]) => {
        for (const part of chunked(batch)) {
          await orm.insert(schema.matchDecision).values(
            part.map((d) => ({
              runId: run.id,
              leftId: d.leftId,
              rightId: d.rightId,
              totalWeight: d.totalWeight,
              probability: d.probability,
              zone: d.zone,
              decidedBy: d.decidedBy,
              weights: d.weights,
              adjudication: d.adjudication ?? null,
              conflict: d.conflict ?? null,
            })),
          );
        }
      },

      putCatalog: async (batch: readonly CatalogItem[]) => {
        for (const part of chunked(batch)) {
          await orm.insert(schema.catalogItem).values(
            part.map((i) => ({
              runId: run.id,
              id: i.id,
              doc: i,
              tradeName: i.tradeName,
              brandCore: i.brandCore,
              manufacturer: i.manufacturer,
              gtin: i.gtin ?? null,
              gtinValid: i.gtinValid,
            })),
          ).onConflictDoNothing();
        }
        // Связь «позиция → записи источников» отдельной таблицей: требование
        // «сохраняет информацию обо всех источниках» должно быть запросом.
        const links = batch.flatMap((item) =>
          item.sources.map((sourceRecordId) => ({
            runId: run.id,
            itemId: item.id,
            sourceRecordId,
            sourceId: sourceRecordId.split(':')[0] ?? '',
          })),
        );
        for (const part of chunked(links)) {
          await orm.insert(schema.catalogItemSource).values([...part]).onConflictDoNothing();
        }
      },

      finish: async (summary: RunSummary) => {
        await orm.transaction(async (tx) => {
          await tx
            .update(schema.pipelineRun)
            .set({ finishedAt: new Date(summary.finishedAt), summary })
            .where(eq(schema.pipelineRun.id, run.id));
          // В ТОЙ ЖЕ транзакции — см. комментарий к модулю.
          await tx.insert(schema.outbox).values({
            runId: run.id,
            topic: 'run.finished',
            payload: { runId: run.id, items: summary.items, records: summary.sourceRecords },
          });
        });
      },
    };
  }

  async listRuns(): Promise<readonly PipelineRun[]> {
    const rows = await this.db.orm
      .select()
      .from(schema.pipelineRun)
      .where(isNotNull(schema.pipelineRun.finishedAt))
      .orderBy(desc(schema.pipelineRun.startedAt));

    return rows.map((r) => ({
      id: r.id as RunId,
      startedAt: r.startedAt.toISOString(),
      rulesetVersion: r.rulesetVersion as PipelineRun['rulesetVersion'],
      adjudicator: r.adjudicator,
    }));
  }

  async load(runId: RunId): Promise<RunSnapshot | undefined> {
    const orm = this.db.orm;
    const [row] = await orm
      .select()
      .from(schema.pipelineRun)
      .where(and(eq(schema.pipelineRun.id, runId), isNotNull(schema.pipelineRun.finishedAt)));
    if (row === undefined || row.summary === null) return undefined;

    const [raw, normalized, quarantined, catalog, decisions] = await Promise.all([
      orm.select().from(schema.sourceRecord).where(eq(schema.sourceRecord.runId, runId)),
      orm.select().from(schema.normalizedRecord).where(eq(schema.normalizedRecord.runId, runId)),
      orm.select().from(schema.quarantine).where(eq(schema.quarantine.runId, runId)),
      orm.select().from(schema.catalogItem).where(eq(schema.catalogItem.runId, runId)),
      orm.select().from(schema.matchDecision).where(eq(schema.matchDecision.runId, runId)),
    ]);

    // Обратный переход в типизированный мир — ЯВНЫЙ. База отдаёт строки;
    // брендированный идентификатор из строки получается только через
    // конструктор, и компилятор не даст сделать это молча. Именно поэтому
    // здесь нет одного общего `as` на весь результат: каждое поле,
    // пересекающее границу, названо.
    return {
      run: {
        id: RunId(row.id),
        startedAt: row.startedAt.toISOString(),
        rulesetVersion: RulesetVersion(row.rulesetVersion),
        adjudicator: row.adjudicator,
      },
      summary: row.summary as RunSummary,
      raw: raw.map((r) => ({
        id: SourceRecordId(r.id),
        sourceId: SourceId(r.sourceId),
        externalId: r.externalId,
        payload: r.payload,
        contentHash: r.contentHash,
        ingestedAt: r.ingestedAt.toISOString(),
        runId: RunId(r.runId),
        sourceContractVersion: r.sourceContractVersion,
      })),
      // `doc` — это jsonb: у него нет типа, который проверил бы компилятор.
      // Гарантию даёт то, что писали мы сами, и golden-снапшот на выгрузке.
      normalized: normalized.map((r) => r.doc) as readonly NormalizedRecord[],
      quarantined: quarantined.map((q) => ({
        sourceId: SourceId(q.sourceId),
        externalId: q.externalId ?? undefined,
        reason: q.reason as QuarantinedRecord['reason'],
        rawExcerpt: q.rawExcerpt,
        quarantinedAt: q.quarantinedAt.toISOString(),
      })),
      catalog: catalog.map((i) => i.doc) as readonly CatalogItem[],
      decisions: decisions.map((d) => ({
        leftId: SourceRecordId(d.leftId),
        rightId: SourceRecordId(d.rightId),
        totalWeight: d.totalWeight,
        probability: d.probability,
        zone: d.zone as MatchDecision['zone'],
        decidedBy: d.decidedBy as MatchDecision['decidedBy'],
        weights: d.weights as MatchDecision['weights'],
        ...(d.adjudication === null
          ? {}
          : { adjudication: d.adjudication as NonNullable<MatchDecision['adjudication']> }),
        ...(d.conflict === null
          ? {}
          : { conflict: d.conflict as NonNullable<MatchDecision['conflict']> }),
      })),
    };
  }

  async latest(): Promise<RunSnapshot | undefined> {
    const [first] = await this.listRuns();
    return first === undefined ? undefined : this.load(first.id);
  }

  async previousAssignment(): Promise<PreviousAssignment> {
    return assignmentOf(await this.latest());
  }

  async knownHashes(): Promise<ReadonlySet<string>> {
    const [first] = await this.listRuns();
    if (first === undefined) return new Set();
    const rows = await this.db.orm
      .select({ hash: schema.sourceRecord.contentHash })
      .from(schema.sourceRecord)
      .where(eq(schema.sourceRecord.runId, first.id));
    return new Set(rows.map((r) => r.hash));
  }

  /**
   * Перекладывает события из outbox в брокер.
   *
   * Порядок внутри транзакции существенный: сначала строки захватываются
   * `FOR UPDATE SKIP LOCKED` (несколько воркеров тянут очередь параллельно
   * и не дерутся за одни и те же), затем публикуются, и только потом
   * помечаются опубликованными. Если публикация упала — откат, событие
   * останется неопубликованным. Если упал коммит уже после публикации —
   * событие уедет повторно.
   *
   * Второе и есть at-least-once: exactly-once между базой и брокером без
   * внешнего координатора недостижим, поэтому обработчик обязан быть
   * идемпотентным. Здесь он такой: повторный экспорт того же прогона даёт
   * побайтово тот же файл.
   */
  async drainOutbox(
    publish: (topic: string, payload: unknown) => Promise<void>,
    limit = 100,
  ): Promise<number> {
    return this.db.orm.transaction(async (tx) => {
      const claimed = await tx.execute<{ id: number; topic: string; payload: unknown }>(
        sql`SELECT id, topic, payload FROM bronze.outbox
            WHERE published_at IS NULL
            ORDER BY id
            LIMIT ${limit}
            FOR UPDATE SKIP LOCKED`,
      );
      const rows = claimed.rows;
      if (rows.length === 0) return 0;

      for (const row of rows) await publish(row.topic, row.payload);

      await tx
        .update(schema.outbox)
        .set({ publishedAt: new Date() })
        .where(inArray(schema.outbox.id, rows.map((r) => r.id)));

      return rows.length;
    });
  }
}
