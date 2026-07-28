/**
 * `pnpm explain <id>` — почему позиция каталога выглядит именно так.
 *
 * Показывает, из каких записей она собрана, какое правило выживания выбрало
 * каждое поле и кто уступил, а затем разбирает каждое сравнение построчно
 * с вкладом полей в общий вес. Вероятностный матчинг без такого разбора —
 * чёрный ящик, а в каталоге лекарств это неприемлемо.
 */

import { explainItem, renderExplanation } from '@catalog/pipeline';
import type { CliOptions } from '../context.ts';
import { snapshotFor } from './export.ts';

export const runExplain = async (options: CliOptions): Promise<void> => {
  const [, itemId] = options.positionals;
  const snapshot = await snapshotFor(options);

  if (itemId === undefined) {
    console.error('нужен идентификатор позиции. Доступные:');
    for (const item of snapshot.catalog) console.error(`  ${item.id}  ${item.tradeName}`);
    process.exitCode = 1;
    return;
  }

  const explanation = explainItem(snapshot, itemId);
  if (explanation === undefined) {
    console.error(`позиция не найдена: ${itemId}`);
    process.exitCode = 1;
    return;
  }

  console.log(renderExplanation(explanation));
};
