/**
 * Правило зависимостей как гейт, а не как договорённость.
 *
 *   domain  ←  normalize  ←  match  ←  connectors  ←  pipeline  ←  cli
 *      ↑ стрелки только внутрь
 *
 * Архитектура, которую не проверяет машина, разъезжается за две недели.
 * Поэтому конфиг заводится на первом этапе, до прикладного кода, и все
 * правила стоят на `error`.
 *
 * Самое ценное здесь — не порядок слоёв, а запрет I/O в ядре: `normalize`
 * и `match` физически не могут дотянуться до файловой системы, сети или БД.
 * Это то, что делает их чистыми функциями не на словах, и то, что делает
 * property-тесты возможными.
 */

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Циклы между модулями. Обычно признак того, что граница проведена не там.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'domain-is-a-leaf',
      severity: 'error',
      comment:
        'domain — Published Language. Он не знает ни о ком; знают о нём. ' +
        'Любая зависимость отсюда наружу означает, что общий словарь протёк в частность.',
      from: { path: '^packages/domain/' },
      to: { path: '^(packages/(?!domain)|apps/)' },
    },
    {
      name: 'core-has-no-io',
      severity: 'error',
      comment:
        'normalize и match — чистые функции. Ни файловой системы, ни сети, ни процессов. ' +
        'Именно это делает их тестируемыми property-тестами и переносимыми между окружениями.',
      from: { path: '^packages/(normalize|match)/' },
      to: {
        dependencyTypes: ['core'],
        path: '^(fs|fs/promises|net|http|https|dns|child_process|worker_threads|cluster|tls|dgram|http2|zlib|node:fs|node:net|node:http|node:https|node:dns|node:child_process|node:worker_threads|node:cluster|node:tls|node:dgram|node:http2|node:zlib)$',
      },
    },
    {
      name: 'core-does-not-know-infrastructure',
      severity: 'error',
      comment:
        'normalize и match не знают ни про БД, ни про транспорты, ни про очередь. ' +
        'Хранилище подключается снаружи, через порт.',
      from: { path: '^packages/(normalize|match)/' },
      to: { path: '^packages/(db|pipeline|connectors|adjudicator)/' },
    },
    {
      name: 'connectors-do-not-know-matching',
      severity: 'error',
      comment:
        'Приём данных ничего не знает про объединение дубликатов. ' +
        'Добавление источника не должно требовать понимания матчинга.',
      from: { path: '^packages/connectors/' },
      to: { path: '^packages/(match|db|pipeline|adjudicator)/' },
    },
    {
      name: 'db-knows-only-domain',
      severity: 'error',
      comment: 'Слой хранения знает канон и больше ничего.',
      from: { path: '^packages/db/' },
      to: { path: '^packages/(normalize|match|connectors|pipeline|adjudicator)/' },
    },
    {
      name: 'adjudicator-is-an-adapter',
      severity: 'error',
      comment:
        'Арбитр реализует порт из match и не тянет за собой ни приём, ни хранение. ' +
        'Он должен подменяться заглушкой без единого изменения в ядре.',
      from: { path: '^packages/adjudicator/' },
      to: { path: '^packages/(connectors|db|pipeline)/' },
    },
    {
      name: 'no-orphans',
      severity: 'error',
      comment: 'Модуль, который никто не импортирует и который ничего не импортирует.',
      from: {
        orphan: true,
        pathNot: ['\\.d\\.ts$', '(^|/)(index|main)\\.ts$', '\\.config\\.(js|cjs|ts)$'],
      },
      to: {},
    },
    {
      name: 'no-unresolvable',
      severity: 'error',
      comment: 'Импорт, который не разрешается. Обычно опечатка или забытая зависимость.',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'not-to-dev-dep-in-src',
      severity: 'error',
      comment: 'Прод-код не должен зависеть от devDependencies.',
      from: { path: '^(packages|apps)/[^/]+/src/', pathNot: '\\.(test|spec)\\.ts$' },
      to: { dependencyTypes: ['npm-dev'] },
    },
  ],

  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(\\.test\\.ts$|\\.spec\\.ts$|/fixtures/)' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'default', 'types'],
      extensions: ['.ts', '.js'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
