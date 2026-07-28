/**
 * Воркеры на pg-boss.
 *
 * Очередь живёт в той же базе, что и данные, и это осознанный выбор:
 * отдельный брокер — ещё один компонент, который надо поднимать, мониторить
 * и синхронизировать с транзакциями. При объёмах этой задачи PostgreSQL
 * как очередь честно закрывает вопрос; порог перехода на выделенный брокер
 * — сотни джоб в секунду, и он записан в плане.
 *
 * Цепочка событий:
 *
 *   catalog.ingest ──▶ прогон конвейера ──▶ (в транзакции) outbox
 *                                              │
 *                              drainOutbox ────┘
 *                                              ▼
 *                                    catalog.run-finished ──▶ выгрузка
 *
 * Событие пишется в ту же транзакцию, что и завершение прогона, а публикуется
 * отдельно. Обработчик обязан быть идемпотентным — см. `drainOutbox`.
 */

import { PgBoss, type Job } from 'pg-boss';
import type { RunSnapshot } from './ports.ts';
import type { PostgresStore } from './store/postgres.ts';

export const QUEUES = {
  ingest: 'catalog.ingest',
  runFinished: 'catalog.run-finished',
} as const;

export interface RunFinishedPayload {
  readonly runId: string;
  readonly items: number;
  readonly records: number;
}

export interface WorkerDeps {
  readonly connectionString: string;
  readonly store: PostgresStore;
  /** Прогон конвейера. Приходит снаружи: воркер не знает, из чего он собран. */
  readonly ingest: () => Promise<RunSnapshot>;
  /** Что делать по завершении прогона — обычно выгрузить каталог. */
  readonly onRunFinished: (payload: RunFinishedPayload) => Promise<void>;
  readonly outboxIntervalMs?: number;
  readonly log?: (message: string) => void;
}

export interface RunningWorker {
  readonly boss: PgBoss;
  /** Разово прогнать outbox — используется тестами вместо ожидания таймера. */
  drainOnce(): Promise<number>;
  enqueueIngest(): Promise<string | null>;
  stop(): Promise<void>;
}

/**
 * Поставить задачу приёма, не поднимая воркер: так работает планировщик
 * или ручной запуск в проде — задачу ставит один процесс, выполняет другой.
 */
export const enqueueIngest = async (connectionString: string): Promise<string | null> => {
  const boss = new PgBoss(connectionString);
  await boss.start();
  try {
    await boss.createQueue(QUEUES.ingest);
    return await boss.send(QUEUES.ingest, {});
  } finally {
    await boss.stop({ graceful: true });
  }
};

export const startWorker = async (deps: WorkerDeps): Promise<RunningWorker> => {
  const log = deps.log ?? ((m: string) => console.log(m));
  const boss = new PgBoss(deps.connectionString);
  await boss.start();

  // Очереди создаются явно: pg-boss не заводит их сам, и джоба в
  // несуществующую очередь молча никуда не поедет.
  await boss.createQueue(QUEUES.ingest);
  await boss.createQueue(QUEUES.runFinished);

  await boss.work<Record<string, never>>(QUEUES.ingest, async (jobs: Job<Record<string, never>>[]) => {
    for (const _job of jobs) {
      const snapshot = await deps.ingest();
      log(`приём завершён: ${snapshot.run.id}, позиций ${snapshot.catalog.length}`);
    }
  });

  await boss.work<RunFinishedPayload>(QUEUES.runFinished, async (jobs: Job<RunFinishedPayload>[]) => {
    for (const job of jobs) {
      await deps.onRunFinished(job.data);
      log(`каталог выгружен по событию прогона ${job.data.runId}`);
    }
  });

  const drainOnce = (): Promise<number> =>
    deps.store.drainOutbox(async (topic, payload) => {
      if (topic === 'run.finished') await boss.send(QUEUES.runFinished, payload as object);
    });

  const timer = setInterval(() => {
    void drainOnce().catch((e: unknown) => {
      // Ошибка перекладки не должна ронять воркер: строки останутся
      // неопубликованными и уедут на следующем тике.
      log(`outbox: ${e instanceof Error ? e.message : String(e)}`);
    });
  }, deps.outboxIntervalMs ?? 1000);
  timer.unref();

  return {
    boss,
    drainOnce,
    enqueueIngest: () => boss.send(QUEUES.ingest, {}),
    stop: async () => {
      clearInterval(timer);
      await boss.stop({ graceful: true });
    },
  };
};
