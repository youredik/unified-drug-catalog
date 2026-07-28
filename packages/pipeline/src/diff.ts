/**
 * Сравнение двух версий каталога.
 *
 * Это способ проверки, который нельзя заменить тестами: тест ловит то, что
 * автор предвидел, а диф показывает ВСЁ, что изменил новый набор правил, —
 * включая то, чего автор не ждал. Правило поправили ради одного источника,
 * а поехали позиции трёх других — это видно только здесь.
 *
 * Работает потому, что идентификаторы позиций стабильны между прогонами
 * (перенос по максимальному пересечению в `clustering.ts`) и потому, что
 * сериализация детерминирована. Без этих двух свойств диф показывал бы шум.
 */

import type { CatalogItem, NormalizedRecord } from '@catalog/domain';
import { stableStringify } from './serialize.ts';

export interface FieldChange {
  readonly field: string;
  readonly before: string;
  readonly after: string;
}

export interface ItemChange {
  readonly id: string;
  readonly changes: readonly FieldChange[];
  /** Записи, пришедшие в позицию и ушедшие из неё: это и есть пере-склейка. */
  readonly sourcesAdded: readonly string[];
  readonly sourcesRemoved: readonly string[];
}

export interface CatalogDiff {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly changed: readonly ItemChange[];
  readonly unchanged: number;
}

/** Поля, по которым сравниваем. Провенанс намеренно не здесь: он меняется
 *  вместе со значениями и утроил бы вывод, ничего не добавив. */
const comparable = (item: CatalogItem): Record<string, string> => ({
  tradeName: item.tradeName,
  brandCore: item.brandCore,
  manufacturer: item.manufacturer,
  gtin: item.gtin ?? '—',
  gtinValid: String(item.gtinValid),
  pack: item.pack === undefined ? '—' : `${item.pack.count} ${item.pack.unitOfPresentation}`,
  country: item.country ?? '—',
  registeredAt: item.registeredAt ?? '—',
  attributes: stableStringify(item.attributes),
  qualityFlags: [...item.qualityFlags].sort().join(','),
});

export const diffCatalogs = (
  before: readonly CatalogItem[],
  after: readonly CatalogItem[],
): CatalogDiff => {
  const beforeById = new Map(before.map((i) => [i.id as string, i]));
  const afterById = new Map(after.map((i) => [i.id as string, i]));

  const added = [...afterById.keys()].filter((id) => !beforeById.has(id)).sort();
  const removed = [...beforeById.keys()].filter((id) => !afterById.has(id)).sort();

  const changed: ItemChange[] = [];
  let unchanged = 0;

  for (const [id, afterItem] of [...afterById.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const beforeItem = beforeById.get(id);
    if (beforeItem === undefined) continue;

    const b = comparable(beforeItem);
    const a = comparable(afterItem);
    const changes: FieldChange[] = [];
    for (const field of Object.keys(a).sort()) {
      if (b[field] !== a[field]) {
        changes.push({ field, before: b[field] ?? '—', after: a[field] ?? '—' });
      }
    }

    const beforeSources = new Set<string>(beforeItem.sources);
    const afterSources = new Set<string>(afterItem.sources);
    const sourcesAdded = [...afterSources].filter((s) => !beforeSources.has(s)).sort();
    const sourcesRemoved = [...beforeSources].filter((s) => !afterSources.has(s)).sort();

    if (changes.length === 0 && sourcesAdded.length === 0 && sourcesRemoved.length === 0) {
      unchanged++;
    } else {
      changed.push({ id, changes, sourcesAdded, sourcesRemoved });
    }
  }

  return { added, removed, changed, unchanged };
};

export const renderDiff = (
  diff: CatalogDiff,
  labelBefore: string,
  labelAfter: string,
  nameOf: (id: string) => string = (id) => id,
): string => {
  const lines: string[] = [];
  const add = (s = ''): void => void lines.push(s);

  add(`Диф каталога: ${labelBefore} → ${labelAfter}`);
  add(
    `  добавлено ${diff.added.length}` +
      ` · исчезло ${diff.removed.length}` +
      ` · изменено ${diff.changed.length}` +
      ` · без изменений ${diff.unchanged}`,
  );
  add();

  for (const id of diff.added) add(`+ ${id}  ${nameOf(id)}`);
  for (const id of diff.removed) add(`− ${id}  ${nameOf(id)}`);
  if (diff.added.length > 0 || diff.removed.length > 0) add();

  for (const item of diff.changed) {
    add(`~ ${item.id}  ${nameOf(item.id)}`);
    for (const c of item.changes) add(`    ${c.field}: «${c.before}» → «${c.after}»`);
    for (const s of item.sourcesAdded) add(`    + запись источника ${s}`);
    for (const s of item.sourcesRemoved) add(`    − запись источника ${s}`);
  }

  return lines.join('\n');
};

/** Имя позиции для читаемого вывода дифа. */
export const nameLookup = (
  ...catalogs: readonly (readonly CatalogItem[])[]
): ((id: string) => string) => {
  const names = new Map<string, string>();
  for (const catalog of catalogs) {
    for (const item of catalog) names.set(item.id, item.tradeName);
  }
  return (id) => names.get(id) ?? '';
};

/** Записи, изменившиеся между прогонами по содержимому источника. */
export const changedRecords = (
  before: readonly NormalizedRecord[],
  after: readonly NormalizedRecord[],
): readonly string[] => {
  const beforeById = new Map(before.map((r) => [r.id as string, stableStringify(r)]));
  return after
    .filter((r) => beforeById.get(r.id) !== stableStringify(r))
    .map((r) => r.id as string)
    .sort();
};
