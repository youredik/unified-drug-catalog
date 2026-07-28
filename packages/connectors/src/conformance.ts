/**
 * Conformance-набор — ключевой артефакт масштабируемости по числу источников.
 *
 * Смысл: новый коннектор не пишет собственных тестов «на что хватило совести».
 * Он обязан пройти общий пакет проверок, одинаковый для всех сетей. Это и
 * превращает «каждый поставщик — отдельный интеграционный проект» в заполнение
 * контракта с понятной планкой.
 *
 * Здесь только чистые проверки без vitest — сам прогон живёт в conformance.test.ts.
 * Так прод-код не тянет devDependencies (это отдельное правило гейта).
 */

import { createHash } from 'node:crypto';
import {
  sourceManifestSchema, type MappedFields, type RulesetVersion,
} from '@catalog/domain';
import { normalizeRecord } from '@catalog/normalize';
import type { SourceConnector } from './spi.ts';

export interface CheckResult {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

const check = (name: string, ok: boolean, detail: string): CheckResult => ({ name, ok, detail });

export const contentHash = (payload: unknown): string =>
  createHash('sha256').update(JSON.stringify(payload)).digest('hex');

export const runConformance = async (
  connector: SourceConnector,
  rulesetVersion: RulesetVersion,
): Promise<readonly CheckResult[]> => {
  const results: CheckResult[] = [];
  const { manifest } = connector;

  // 1. Манифест валиден по схеме — иначе всё остальное бессмысленно.
  const manifestParse = sourceManifestSchema.safeParse(manifest);
  results.push(check('манифест валиден', manifestParse.success, manifest.id));

  // 2. Источник читается и отдаёт хотя бы одну запись.
  const collected: unknown[] = [];
  let parseErrors = 0;
  for await (const r of connector.readRecords()) {
    if (r.ok) collected.push(r.value);
    else parseErrors++;
  }
  results.push(
    check('читается хотя бы одна запись', collected.length > 0, `записей: ${collected.length}`),
  );
  results.push(
    check('поток не оборвался ошибкой разбора', parseErrors === 0, `ошибок разбора: ${parseErrors}`),
  );

  // 3. ACL раскладывает каждую запись, и внешний идентификатор не теряется.
  const mapped: MappedFields[] = [];
  let mapErrors = 0;
  for (const payload of collected) {
    const m = connector.toMappedFields(payload);
    if (m.ok) mapped.push(m.value);
    else mapErrors++;
  }
  results.push(check('ACL разложил все записи', mapErrors === 0, `ошибок ACL: ${mapErrors}`));
  results.push(
    check(
      'внешний идентификатор присутствует у всех',
      mapped.every((m) => m.externalId !== ''),
      `записей: ${mapped.length}`,
    ),
  );

  // 4. Идемпотентность: повторное чтение даёт те же хэши содержимого.
  const secondPass: unknown[] = [];
  for await (const r of connector.readRecords()) if (r.ok) secondPass.push(r.value);
  const h1 = collected.map(contentHash).join('|');
  const h2 = secondPass.map(contentHash).join('|');
  results.push(check('повторное чтение идемпотентно', h1 === h2, `${collected.length} записей'`));

  // 5. Объявленный формат даты реально разбирает даты этого источника.
  //    Проверка ловит рассинхрон манифеста и фида — самый тихий вид поломки.
  const dateFailures = mapped.filter((m) => {
    const r = normalizeRecord(m, manifest, rulesetVersion);
    return r.ok && r.value.softErrors.some((e) => e.kind === 'unparseable_date');
  }).length;
  results.push(
    check(
      'объявленный формат даты подходит фиду',
      dateFailures === 0,
      `не разобрано дат: ${dateFailures} из ${mapped.length}`,
    ),
  );

  // 6. Нормализация не роняет записи целиком.
  const hardFailures = mapped.filter((m) => !normalizeRecord(m, manifest, rulesetVersion).ok).length;
  results.push(
    check('нормализация не отбраковала записи', hardFailures === 0, `в карантин: ${hardFailures}`),
  );

  // 7. Лимиты парсера объявлены — иначе бомба доедет до разбора.
  results.push(
    check(
      'лимиты разбора объявлены',
      manifest.limits.maxBytes > 0 && manifest.limits.maxDepth > 0,
      `${manifest.limits.maxBytes} Б / глубина ${manifest.limits.maxDepth}`,
    ),
  );

  return results;
};
