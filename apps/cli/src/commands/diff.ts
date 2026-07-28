/**
 * `pnpm catalog:diff [runA runB]` — что изменилось между двумя прогонами.
 *
 * Тест ловит то, что автор предвидел. Диф показывает всё, что изменил новый
 * набор правил, включая непредвиденное: поправили правило ради одного
 * источника — поехали позиции трёх других.
 *
 * Без аргументов сравнивает два последних завершённых прогона.
 */

import { RunId } from '@catalog/domain';
import { diffCatalogs, nameLookup, renderDiff } from '@catalog/pipeline';
import { storeFrom, type CliOptions } from '../context.ts';

export const runDiff = async (options: CliOptions): Promise<void> => {
  const store = storeFrom(options);
  const [, first, second] = options.positionals;

  const runs = await store.listRuns();
  const beforeId = second !== undefined ? first : runs[1]?.id;
  const afterId = second ?? first ?? runs[0]?.id;

  if (beforeId === undefined || afterId === undefined) {
    console.error(
      'нужны два прогона. Сейчас завершённых: ' +
        `${runs.length}. Сделайте pnpm ingest ещё раз или укажите прогоны явно.`,
    );
    process.exitCode = 1;
    return;
  }

  const before = await store.load(RunId(beforeId));
  const after = await store.load(RunId(afterId));
  if (before === undefined || after === undefined) {
    console.error(`прогон не найден: ${before === undefined ? beforeId : afterId}`);
    process.exitCode = 1;
    return;
  }

  const diff = diffCatalogs(before.catalog, after.catalog);
  console.log(
    renderDiff(
      diff,
      `${beforeId} (${before.run.rulesetVersion})`,
      `${afterId} (${after.run.rulesetVersion})`,
      nameLookup(before.catalog, after.catalog),
    ),
  );
};
