/**
 * Отчёт качества — способ проверки корректности
 * в его непрерывной форме.
 *
 * Тесты отвечают на вопрос «работает ли правило на известном случае».
 * Отчёт отвечает на другой: «что происходит с данными, которые пришли
 * сегодня». Второе важнее в эксплуатации, потому что данные меняются
 * без спроса, а тесты — нет.
 *
 * Здесь намеренно нет ни одной агрегированной «оценки качества». Число
 * вроде «качество 87%» невозможно ни проверить, ни починить. Вместо него —
 * распределения: сколько записей с каким флагом, что и почему в карантине,
 * какие расхождения зафиксированы и по каким полям.
 */

import { describeError, type CatalogItem, type QualityFlag } from '@catalog/domain';
import type { PipelineRun, RunSnapshot, SourceIngestStats } from './ports.ts';

export interface Counted<T> {
  readonly key: T;
  readonly count: number;
}

export interface ConflictRow {
  readonly itemId: string;
  readonly field: string;
  readonly chosen: string;
  readonly rejected: readonly string[];
}

export interface QualityReport {
  readonly run: PipelineRun;
  readonly perSource: readonly SourceIngestStats[];
  readonly sourceRecords: number;
  readonly items: number;
  /** Сколько записей схлопнулось: главное число для требования «объединяет дубликаты». */
  readonly merged: number;
  readonly qualityFlags: readonly Counted<QualityFlag>[];
  readonly quarantine: readonly Counted<string>[];
  readonly matching: {
    readonly comparedPairs: number;
    readonly matched: number;
    readonly possible: number;
    readonly nonMatch: number;
    readonly conflicts: number;
    readonly adjudicated: number;
  };
  readonly conflicts: readonly ConflictRow[];
}

const tally = <T>(values: readonly T[]): readonly Counted<T>[] => {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key)));
};

const conflictsOf = (items: readonly CatalogItem[]): readonly ConflictRow[] =>
  items.flatMap((item) =>
    item.provenance
      .filter((p) => p.conflict)
      .map((p) => ({
        itemId: item.id,
        field: p.field,
        chosen: `${p.value}  (${p.sourceId})`,
        // Победитель тоже лежит среди кандидатов — в списке отклонённых
        // ему не место, иначе отчёт читается как «отвергли то, что выбрали».
        rejected: p.competitors
          .filter((c) => c.value !== p.value)
          .map((c) => `${c.sourceId}: ${c.value}`),
      })),
  );

export const buildReport = (snapshot: RunSnapshot): QualityReport => {
  const { normalized, quarantined, catalog, decisions } = snapshot;

  return {
    run: snapshot.run,
    perSource: snapshot.summary.perSource,
    sourceRecords: normalized.length,
    items: catalog.length,
    merged: normalized.length - catalog.length,
    qualityFlags: tally(normalized.flatMap((r) => r.qualityFlags)),
    quarantine: tally(quarantined.map((q) => describeError(q.reason))),
    matching: {
      comparedPairs: decisions.length,
      matched: decisions.filter((d) => d.zone === 'match').length,
      possible: decisions.filter((d) => d.zone === 'possible').length,
      nonMatch: decisions.filter((d) => d.zone === 'non_match').length,
      conflicts: decisions.filter((d) => d.conflict !== undefined).length,
      adjudicated: decisions.filter((d) => d.decidedBy === 'adjudicator').length,
    },
    conflicts: conflictsOf(catalog),
  };
};

const pct = (part: number, whole: number): string =>
  whole === 0 ? '—' : `${((part / whole) * 100).toFixed(1)}%`;

export const renderReport = (r: QualityReport): string => {
  const lines: string[] = [];
  const add = (s = ''): void => void lines.push(s);

  add(`Отчёт качества — прогон ${r.run.id}`);
  add(`правила ${r.run.rulesetVersion} · арбитр ${r.run.adjudicator} · ${r.run.startedAt}`);
  add();

  add('Источники');
  for (const s of r.perSource) {
    add(
      `  ${s.sourceId.padEnd(12)} прочитано ${s.read}` +
        `  принято ${s.accepted}` +
        `  карантин ${s.quarantined}` +
        `  без изменений ${s.unchanged}` +
        `  мягких ошибок ${s.softErrors}`,
    );
  }
  add();

  add('Объединение');
  add(`  записей источников  ${r.sourceRecords}`);
  add(`  позиций каталога    ${r.items}`);
  add(`  схлопнуто           ${r.merged}`);
  add();

  add('Сравнение пар');
  add(`  сравнено после блокировки  ${r.matching.comparedPairs}`);
  add(`  совпадение                 ${r.matching.matched}`);
  add(`  зона неопределённости      ${r.matching.possible}   ← ручной разбор`);
  add(`  разные                     ${r.matching.nonMatch}`);
  add(`  конфликт по идентификатору ${r.matching.conflicts}`);
  add(`  решено арбитром            ${r.matching.adjudicated}`);
  add();

  add('Флаги качества');
  if (r.qualityFlags.length === 0) add('  нет');
  for (const f of r.qualityFlags) {
    add(`  ${String(f.key).padEnd(36)} ${String(f.count).padStart(4)}  ${pct(f.count, r.sourceRecords)}`);
  }
  add();

  add('Карантин');
  if (r.quarantine.length === 0) add('  пусто');
  for (const q of r.quarantine) add(`  ${String(q.count).padStart(4)}  ${q.key}`);
  add();

  add('Зафиксированные расхождения');
  if (r.conflicts.length === 0) add('  нет');
  for (const c of r.conflicts) {
    add(`  ${c.itemId} · ${c.field}`);
    add(`      выбрано:   ${c.chosen}`);
    for (const rejected of c.rejected) add(`      отклонено: ${rejected}`);
  }

  return lines.join('\n');
};
