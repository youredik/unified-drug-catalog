/**
 * Блокировка кандидатов.
 *
 * Наивное сравнение квадратично: на миллионе записей это 5·10¹¹ пар, то есть
 * задача просто не считается. Блокировка отбирает пары, которые вообще имеет
 * смысл сравнивать, и делает матчинг линейным по числу блоков.
 *
 * Три слоя, от дешёвого к дорогому:
 *
 *   1) точный по идентификатору        — включая НЕвалидный: он не годится
 *                                        утверждать тождество, но годится
 *                                        собрать кандидатов в один блок;
 *   2) точный по составному ключу      — бренд + дозировка + базовая форма;
 *   3) нечёткий по триграммам бренда   — ловит опечатки и перестановки.
 *
 * Слой 3 в проде переезжает в Postgres на `pg_trgm` с GIN-индексом; здесь он
 * реализован в памяти той же мерой Жаккара, чтобы ядро оставалось чистым
 * и тестируемым без БД.
 */

import type { NormalizedRecord, SourceRecordId } from '@catalog/domain';
import { comparableStrength } from '@catalog/normalize';
import { trigramSimilarity, trigrams } from './comparison.ts';

export interface CandidatePair {
  readonly left: NormalizedRecord;
  readonly right: NormalizedRecord;
  /** Какой слой свёл пару — попадает в аудит и помогает настраивать блокировку. */
  readonly via: 'gtin' | 'composite' | 'trigram';
}

const pairKey = (a: SourceRecordId, b: SourceRecordId): string =>
  a < b ? `${a}|${b}` : `${b}|${a}`;

const compositeKey = (r: NormalizedRecord): string | undefined => {
  if (r.brandKey === '') return undefined;
  const strength = r.strength === undefined ? '?' : comparableStrength(r.strength);
  const form = r.doseForm?.basic ?? '?';
  return `${r.brandKey}::${strength}::${form}`;
};

const groupBy = (
  records: readonly NormalizedRecord[],
  key: (r: NormalizedRecord) => string | undefined,
): Map<string, NormalizedRecord[]> => {
  const out = new Map<string, NormalizedRecord[]>();
  for (const r of records) {
    const k = key(r);
    if (k === undefined) continue;
    const bucket = out.get(k);
    if (bucket === undefined) out.set(k, [r]);
    else bucket.push(r);
  }
  return out;
};

export interface BlockingStats {
  readonly records: number;
  readonly pairs: number;
  /** Сколько пар дало бы сравнение «каждый с каждым». */
  readonly naivePairs: number;
  readonly reductionRatio: number;
  readonly byLayer: Readonly<Record<CandidatePair['via'], number>>;
}

export interface BlockingResult {
  readonly pairs: readonly CandidatePair[];
  readonly stats: BlockingStats;
}

export const blockCandidates = (
  records: readonly NormalizedRecord[],
  trigramThreshold = 0.5,
): BlockingResult => {
  const seen = new Set<string>();
  const pairs: CandidatePair[] = [];
  const byLayer = { gtin: 0, composite: 0, trigram: 0 };

  const add = (a: NormalizedRecord, b: NormalizedRecord, via: CandidatePair['via']): void => {
    if (a.id === b.id) return;
    const k = pairKey(a.id, b.id);
    if (seen.has(k)) return;
    seen.add(k);
    pairs.push({ left: a, right: b, via });
    byLayer[via]++;
  };

  // Слой 1 — идентификатор. Невалидный тоже блокирует: понижен в роли,
  // но не отброшен.
  for (const bucket of groupBy(records, (r) => r.gtin).values()) {
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) add(bucket[i]!, bucket[j]!, 'gtin');
    }
  }

  // Слой 2 — составной ключ: ловит записи без идентификатора.
  for (const bucket of groupBy(records, compositeKey).values()) {
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) add(bucket[i]!, bucket[j]!, 'composite');
    }
  }

  // Слой 3 — нечёткий по триграммам. Инвертированный индекс: запись попадает
  // в корзину каждой своей триграммы, сравниваются только соседи по корзине.
  const byTrigram = new Map<string, NormalizedRecord[]>();
  for (const r of records) {
    if (r.brandKey === '') continue;
    for (const t of trigrams(r.brandKey)) {
      const bucket = byTrigram.get(t);
      if (bucket === undefined) byTrigram.set(t, [r]);
      else bucket.push(r);
    }
  }
  const checked = new Set<string>();
  for (const bucket of byTrigram.values()) {
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const a = bucket[i]!;
        const b = bucket[j]!;
        const k = pairKey(a.id, b.id);
        if (checked.has(k)) continue;
        checked.add(k);
        if (trigramSimilarity(a.brandKey, b.brandKey) >= trigramThreshold) add(a, b, 'trigram');
      }
    }
  }

  const n = records.length;
  const naivePairs = (n * (n - 1)) / 2;

  return {
    pairs,
    stats: {
      records: n,
      pairs: pairs.length,
      naivePairs,
      reductionRatio: naivePairs === 0 ? 1 : pairs.length / naivePairs,
      byLayer,
    },
  };
};
