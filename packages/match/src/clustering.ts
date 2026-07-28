/**
 * Кластеризация и стабильные идентификаторы.
 *
 * Кластеры собираются объединением непересекающихся множеств (union-find)
 * по парам из зоны совпадения. Обход идёт по ВСЕМ записям, а не только по
 * межисточниковым парам: одна сеть может прислать один товар дважды под
 * разными внутренними SKU, и дедупликация внутри источника — та же задача,
 * что и связывание между источниками.
 *
 * Вторая половина файла решает проблему, о которой обычно вспоминают поздно:
 * ИДЕНТИФИКАТОР КЛАСТЕРА ДОЛЖЕН ПЕРЕЖИВАТЬ ПРОГОН. Если позиция каталога
 * получает новый id при каждом пересчёте, ломается всё, что на него ссылалось.
 * Поэтому новый кластер наследует идентификатор того прежнего, с которым у него
 * наибольшее пересечение по исходным записям, а слияния и расщепления
 * протоколируются.
 */

import { CatalogItemId, type NormalizedRecord, type SourceRecordId } from '@catalog/domain';

class DisjointSet {
  private readonly parent = new Map<string, string>();

  find(x: string): string {
    const p = this.parent.get(x);
    if (p === undefined) {
      this.parent.set(x, x);
      return x;
    }
    if (p === x) return x;
    const root = this.find(p);
    this.parent.set(x, root); // сжатие пути
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

export interface Cluster {
  readonly id: CatalogItemId;
  readonly members: readonly NormalizedRecord[];
}

export interface ClusterEvent {
  readonly type: 'created' | 'carried_over' | 'merged' | 'split';
  readonly id: CatalogItemId;
  readonly detail: string;
}

export interface ClusteringResult {
  readonly clusters: readonly Cluster[];
  readonly events: readonly ClusterEvent[];
}

/** Прежнее состояние: какая запись к какой позиции каталога относилась. */
export type PreviousAssignment = ReadonlyMap<SourceRecordId, CatalogItemId>;

/**
 * Детерминированный идентификатор для нового кластера.
 *
 * Берётся из наименьшего идентификатора исходной записи, а не из счётчика
 * и не из случайности: одни и те же входные данные обязаны дать один и тот же
 * каталог, иначе golden-снапшот и диф версий ничего не проверяют.
 */
const deriveId = (members: readonly NormalizedRecord[]): CatalogItemId => {
  const seed = [...members.map((m) => m.id)].sort()[0] ?? 'empty';
  return CatalogItemId(`item:${seed}`);
};

export const clusterRecords = (
  records: readonly NormalizedRecord[],
  matchedPairs: readonly (readonly [SourceRecordId, SourceRecordId])[],
  previous: PreviousAssignment = new Map(),
): ClusteringResult => {
  const ds = new DisjointSet();
  for (const r of records) ds.find(r.id);
  for (const [a, b] of matchedPairs) ds.union(a, b);

  const grouped = new Map<string, NormalizedRecord[]>();
  for (const r of records) {
    const root = ds.find(r.id);
    const bucket = grouped.get(root);
    if (bucket === undefined) grouped.set(root, [r]);
    else bucket.push(r);
  }

  const events: ClusterEvent[] = [];
  const usedIds = new Set<string>();

  const clusters = [...grouped.values()]
    // Сначала внутри кластера, потом между кластерами — и обязательно
    // в этом порядке. Сортировка групп по «первому попавшемуся» участнику
    // зависела бы от того, в каком порядке прочитаны источники: содержимое
    // кластеров получалось бы то же, а последовательность позиций — разной.
    // Это ловит property-тест «результат не зависит от порядка источников»;
    // на трёх записях примера кластер один, и увидеть это там нечем.
    .map((members) => [...members].sort((x, y) => (x.id < y.id ? -1 : 1)))
    .sort((x, y) => (x[0]!.id < y[0]!.id ? -1 : 1))
    .map((sorted) => {
      // Наибольшее пересечение с прежними кластерами — так позиция сохраняет
      // идентификатор, даже если в неё добавилась или из неё ушла запись.
      const overlap = new Map<CatalogItemId, number>();
      for (const m of sorted) {
        const prev = previous.get(m.id);
        if (prev !== undefined) overlap.set(prev, (overlap.get(prev) ?? 0) + 1);
      }

      let id: CatalogItemId | undefined;
      let best = 0;
      for (const [candidate, count] of [...overlap.entries()].sort((a, b) =>
        a[0] < b[0] ? -1 : 1,
      )) {
        if (count > best && !usedIds.has(candidate)) {
          best = count;
          id = candidate;
        }
      }

      if (id === undefined) {
        id = deriveId(sorted);
        events.push({ type: 'created', id, detail: `записей: ${sorted.length}` });
      } else {
        events.push({
          type: overlap.size > 1 ? 'merged' : 'carried_over',
          id,
          detail:
            overlap.size > 1
              ? `объединены прежние позиции: ${[...overlap.keys()].join(', ')}`
              : `перенесён с прошлого прогона (${best} из ${sorted.length} записей)`,
        });
      }
      usedIds.add(id);

      return { id, members: sorted };
    });

  // Расщепление: прежняя позиция, чей идентификатор больше никем не занят.
  const carried = new Set(clusters.map((c) => c.id));
  for (const prevId of new Set(previous.values())) {
    if (!carried.has(prevId)) {
      events.push({ type: 'split', id: prevId, detail: 'позиция распалась или исчезла' });
    }
  }

  return { clusters, events };
};
