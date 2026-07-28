/**
 * Порт хранилища.
 *
 * Ядро (`normalize`, `match`) о существовании этого файла не знает — это
 * проверяется гейтом `core-does-not-know-infrastructure`. Хранилище приходит
 * снаружи, поэтому сегодня конвейер работает на файлах, а завтра — на
 * PostgreSQL, без единой правки в правилах нормализации и матчинга.
 *
 * Запись — ПОРЦИЯМИ, чтение — снимком. Асимметрия намеренная: приём должен
 * оставаться потоковым (фид на миллион позиций не обязан помещаться в память),
 * а отчёт и разбор по завершённому прогону читают уже посчитанное.
 *
 * Слои bronze / silver / gold из плана — это не другой порт, а другая
 * реализация того же: `putRaw` ложится в bronze, `putNormalized` в silver,
 * `putCatalog` в gold.
 */

import type {
  CatalogItem, MatchDecision, NormalizedRecord, QuarantinedRecord, RawSourceRecord,
  RulesetVersion, RunId, SourceId,
} from '@catalog/domain';
import type { PreviousAssignment } from '@catalog/match';

export interface PipelineRun {
  readonly id: RunId;
  readonly startedAt: string;
  readonly rulesetVersion: RulesetVersion;
  /** Имя арбитра, участвовавшего в прогоне. Без него результат невоспроизводим. */
  readonly adjudicator: string;
}

export interface SourceIngestStats {
  readonly sourceId: SourceId;
  readonly read: number;
  readonly accepted: number;
  readonly quarantined: number;
  /** Записи с тем же содержимым, что и в прошлом прогоне. */
  readonly unchanged: number;
  readonly softErrors: number;
}

export interface RunSummary {
  readonly finishedAt: string;
  readonly sourceRecords: number;
  readonly quarantined: number;
  readonly items: number;
  readonly pendingReview: number;
  readonly adjudicated: number;
  readonly perSource: readonly SourceIngestStats[];
}

/** Всё, что нужно, чтобы объяснить и повторить один прогон. */
export interface RunSnapshot {
  readonly run: PipelineRun;
  readonly summary: RunSummary;
  readonly raw: readonly RawSourceRecord[];
  readonly normalized: readonly NormalizedRecord[];
  readonly quarantined: readonly QuarantinedRecord[];
  readonly catalog: readonly CatalogItem[];
  readonly decisions: readonly MatchDecision[];
}

/**
 * Писатель одного прогона. Возвращается из `beginRun` и живёт ровно столько,
 * сколько идёт прогон; незавершённый прогон (`finish` не вызван) не должен
 * подменять собой последний успешный — иначе упавший ночной прогон снесёт
 * рабочий каталог.
 */
export interface RunWriter {
  putRaw(batch: readonly RawSourceRecord[]): Promise<void>;
  putQuarantined(batch: readonly QuarantinedRecord[]): Promise<void>;
  putNormalized(batch: readonly NormalizedRecord[]): Promise<void>;
  putDecisions(batch: readonly MatchDecision[]): Promise<void>;
  putCatalog(batch: readonly CatalogItem[]): Promise<void>;
  finish(summary: RunSummary): Promise<void>;
}

export interface CatalogStore {
  readonly name: string;
  beginRun(run: PipelineRun): Promise<RunWriter>;
  /** Завершённые прогоны, новейший первым. */
  listRuns(): Promise<readonly PipelineRun[]>;
  load(runId: RunId): Promise<RunSnapshot | undefined>;
  latest(): Promise<RunSnapshot | undefined>;
  /**
   * Прежнее сопоставление «запись → позиция каталога».
   *
   * Это то, что делает идентификаторы позиций стабильными между прогонами:
   * без него каждый прогон выдаёт новые id, и внешний потребитель каталога
   * не может на них ссылаться.
   */
  previousAssignment(): Promise<PreviousAssignment>;
  /** Хэши содержимого прошлого прогона — основа для отчёта об изменениях. */
  knownHashes(): Promise<ReadonlySet<string>>;
}
