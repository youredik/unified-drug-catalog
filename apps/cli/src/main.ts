#!/usr/bin/env node
/**
 * CLI — композиционный корень. Единственное место, знающее про все контексты
 * сразу; всё остальное общается через Published Language.
 */

import { closeStore, parseCliArgs } from './context.ts';
import { runDb } from './commands/db.ts';
import { runDiff } from './commands/diff.ts';
import { runExplain } from './commands/explain.ts';
import { runExport } from './commands/export.ts';
import { runIngest } from './commands/ingest.ts';
import { runReport } from './commands/report.ts';
import { runWorker } from './commands/worker.ts';
import { runEval } from './eval.ts';

const HELP = `unified-drug-catalog — единый каталог лекарств

  ingest                приём всех источников, нормализация, объединение, сохранение прогона
  export [--out=путь]   итоговый каталог в JSON (по умолчанию catalog.json)
  report                отчёт качества: флаги, карантин, зоны матчинга, расхождения
  explain <id>          разбор позиции: провенанс по полям и веса сравнений
  diff [runA runB]      что изменилось между двумя прогонами
  migrate               применить миграции к базе
  worker                фоновый обработчик очереди (нужен PostgreSQL)
  eval                  замер вклада арбитра против базовой линии
  eval:record           живой прогон модели с записью вердиктов (нужен ANTHROPIC_API_KEY)

Общие флаги:
  --run=<id>            работать с конкретным прогоном, а не с последним
  --store=file|postgres где хранить прогоны (по умолчанию file)
  --store-dir=<путь>    каталог файлового хранилища (по умолчанию out/)
  --db=<строка>         подключение к PostgreSQL (иначе DATABASE_URL)
  --enqueue             поставить приём в очередь вместо выполнения на месте
  --ruleset=<версия>    версия набора правил — основа для diff
  --adjudicator=claude  включить арбитра на языковой модели (по умолчанию выключен)`;

const options = parseCliArgs(process.argv.slice(2));
const [command] = options.positionals;

const commands: Record<string, () => Promise<void>> = {
  ingest: () => runIngest(options),
  export: () => runExport(options),
  report: () => runReport(options),
  explain: () => runExplain(options),
  diff: () => runDiff(options),
  migrate: () => runDb(options),
  worker: () => runWorker(options),
  eval: () => runEval(false),
  'eval:record': () => runEval(true),
};

const run = commands[command ?? ''];
if (run === undefined) {
  console.error(`неизвестная команда: ${command ?? '(нет)'}\n\n${HELP}`);
  process.exit(1);
}

try {
  await run();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  // Пул соединений держит процесс живым: без явного закрытия команда
  // отработает и не завершится.
  await closeStore();
}
