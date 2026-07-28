/**
 * Разбор решения по одной позиции каталога.
 *
 * Вероятностный матчинг без разбора — чёрный ящик, а чёрный ящик в каталоге
 * лекарств неприемлем: на вопрос «почему эти две записи склеены» должен быть
 * ответ построчно, с вкладом каждого поля в общий вес.
 *
 * Здесь же видно и обратное — почему НЕ склеены: пара с весом ниже порога
 * показывается с тем же разбором. Это то, чем разбор отличается от лога.
 */

import type { CatalogItem, MatchDecision, NormalizedRecord } from '@catalog/domain';
import type { RunSnapshot } from './ports.ts';

export interface Explanation {
  readonly item: CatalogItem;
  readonly members: readonly NormalizedRecord[];
  /** Решения, в которых участвовала хотя бы одна запись позиции. */
  readonly decisions: readonly MatchDecision[];
}

export const explainItem = (
  snapshot: RunSnapshot,
  itemId: string,
): Explanation | undefined => {
  const item = snapshot.catalog.find((i) => i.id === itemId);
  if (item === undefined) return undefined;

  const ids = new Set<string>(item.sources);
  return {
    item,
    members: snapshot.normalized.filter((r) => ids.has(r.id)),
    decisions: snapshot.decisions.filter((d) => ids.has(d.leftId) || ids.has(d.rightId)),
  };
};

const ZONE_LABEL: Record<MatchDecision['zone'], string> = {
  match: 'совпадение',
  possible: 'зона неопределённости',
  non_match: 'разные',
};

export const renderDecision = (d: MatchDecision): string => {
  const lines = [`  ${d.leftId}  ↔  ${d.rightId}`];
  for (const w of d.weights) {
    const sign = w.weight >= 0 ? '+' : '';
    lines.push(`    ${w.field.padEnd(14)} ${w.level.padEnd(20)} ${sign}${w.weight.toFixed(2)}`);
  }
  lines.push(
    `    ${'ИТОГО'.padEnd(35)} ${d.totalWeight.toFixed(2)}` +
      `   вероятность ${(d.probability * 100).toFixed(2)}%`,
  );
  lines.push(`    вывод: ${ZONE_LABEL[d.zone]} (решил: ${d.decidedBy})`);
  if (d.conflict !== undefined) lines.push(`    КОНФЛИКТ: ${d.conflict}`);
  if (d.adjudication !== undefined) {
    lines.push(
      `    арбитр: ${d.adjudication.isMatch ? 'один товар' : 'разные'}` +
        ` (уверенность ${d.adjudication.confidence.toFixed(2)},` +
        ` решающее поле: ${d.adjudication.discriminatingField ?? '—'})`,
    );
    lines.push(`    обоснование: ${d.adjudication.reasoning}`);
  }
  return lines.join('\n');
};

export const renderExplanation = (e: Explanation): string => {
  const lines: string[] = [];
  const add = (s = ''): void => void lines.push(s);

  add(`Позиция ${e.item.id}`);
  add(`  ${e.item.tradeName} · ${e.item.manufacturer}`);
  add();

  add(`Собрана из ${e.members.length} записей:`);
  for (const m of e.members) {
    add(`  ${m.sourceId.padEnd(12)} ${m.externalId.padEnd(8)} ${m.tradeName}`);
  }
  add();

  add('Победители по полям');
  for (const p of [...e.item.provenance].sort((a, b) => a.field.localeCompare(b.field))) {
    add(`  ${p.field.padEnd(18)} ${p.value}`);
    add(`      правило: ${p.rule} · источник: ${p.sourceId}${p.conflict ? ' · РАСХОЖДЕНИЕ' : ''}`);
    for (const c of p.competitors) {
      if (c.value !== p.value) add(`      уступил: ${c.sourceId}: ${c.value}`);
    }
  }
  add();

  add('Разбор сравнений');
  if (e.decisions.length === 0) add('  пар не было: позиция собрана из одной записи');
  for (const d of e.decisions) {
    add(renderDecision(d));
    add();
  }

  if (e.item.qualityFlags.length > 0) {
    add(`Флаги качества: ${[...e.item.qualityFlags].sort().join(', ')}`);
  }

  return lines.join('\n');
};
