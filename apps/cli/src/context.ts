/**
 * Композиционный корень: единственное место, где решается, из чего собран
 * работающий конвейер.
 *
 * Здесь же — единственное место, где берётся текущее время и генерируются
 * идентификаторы прогона. Ниже по стеку и то и другое приходит параметром,
 * поэтому весь конвейер детерминирован: одни и те же входы дают один и тот же
 * каталог, и golden-снапшот проверяет результат, а не удачу.
 */

import { parseArgs } from 'node:util';
import { RulesetVersion, RunId } from '@catalog/domain';
import { buildConnectors } from '@catalog/connectors';
import { NoopAdjudicator, type AdjudicatorPort } from '@catalog/match';
import { ClaudeAdjudicator, hasCredentials } from '@catalog/adjudicator';
import { FileStore, PostgresStore, type CatalogStore } from '@catalog/pipeline';

export const PROJECT_ROOT = new URL('../../../', import.meta.url).pathname;
export const OUT_DIR = `${PROJECT_ROOT}out`;

/**
 * Строка подключения по умолчанию совпадает с docker-compose.yml. Это
 * локальные учётные данные для разработки и ничего больше; в любой другой
 * среде она приходит из `DATABASE_URL`, который валидируется на старте.
 */
export const DEFAULT_DATABASE_URL = 'postgres://catalog:catalog@localhost:55432/catalog';

/**
 * Версия набора правил. Её смысл — не бухгалтерия, а `catalog:diff`: поднять
 * версию, перегнать те же исходные данные и увидеть, что именно изменилось
 * в каталоге от правки правила.
 */
export const RULESET_VERSION = RulesetVersion('v1');

export interface CliOptions {
  readonly positionals: readonly string[];
  readonly values: Readonly<Record<string, string | boolean | undefined>>;
}

export const parseCliArgs = (argv: readonly string[]): CliOptions => {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      out: { type: 'string' },
      run: { type: 'string' },
      ruleset: { type: 'string' },
      adjudicator: { type: 'string' },
      store: { type: 'string' },
      'store-dir': { type: 'string' },
      db: { type: 'string' },
      enqueue: { type: 'boolean' },
    },
  });
  return { positionals, values };
};

export const databaseUrl = (options: CliOptions): string =>
  (typeof options.values['db'] === 'string' ? options.values['db'] : undefined) ??
  process.env['DATABASE_URL'] ??
  DEFAULT_DATABASE_URL;

/**
 * Хранилище — один экземпляр на процесс: у PostgreSQL за ним пул соединений,
 * и создавать его на каждую команду значит забыть закрыть половину.
 */
let active: CatalogStore | undefined;

export const storeFrom = (options: CliOptions): CatalogStore => {
  if (active !== undefined) return active;
  active =
    options.values['store'] === 'postgres'
      ? PostgresStore.open(databaseUrl(options))
      : new FileStore(
          typeof options.values['store-dir'] === 'string' ? options.values['store-dir'] : OUT_DIR,
        );
  return active;
};

export const closeStore = async (): Promise<void> => {
  const store = active;
  active = undefined;
  if (store instanceof PostgresStore) await store.close();
};

export const rulesetFrom = (options: CliOptions): ReturnType<typeof RulesetVersion> =>
  typeof options.values['ruleset'] === 'string'
    ? RulesetVersion(options.values['ruleset'])
    : RULESET_VERSION;

/**
 * Арбитр по умолчанию — заглушка, и это решение, а не заготовка.
 *
 * На размеченном наборе правила дают precision 1.000 / recall 1.000: модель
 * купила бы разбор четырёх спорных пар из двенадцати, которые и так уходят
 * человеку. Платить за это деньгами, задержкой, недетерминированностью и
 * поверхностью для инъекции — плохая сделка. Адаптер написан, проверен
 * и включается флагом `--adjudicator=claude`, когда серая зона перестанет
 * помещаться в ручной разбор.
 */
export const adjudicatorFrom = (options: CliOptions): AdjudicatorPort => {
  if (options.values['adjudicator'] !== 'claude') return new NoopAdjudicator();
  if (!hasCredentials()) {
    console.warn('арбитр запрошен, но ключа нет — работаем без него');
    return new NoopAdjudicator();
  }
  return new ClaudeAdjudicator();
};

export const connectors = buildConnectors;

/** Идентификатор прогона: сортируемый по времени и пригодный как имя каталога. */
export const newRunId = (now: Date): ReturnType<typeof RunId> =>
  RunId(`run-${now.toISOString().replace(/[:.]/g, '-')}`);
