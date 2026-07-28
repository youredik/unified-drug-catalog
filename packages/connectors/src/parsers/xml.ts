/**
 * Разбор недоверенного XML.
 *
 * Фид приходит от третьей стороны, поэтому парсер настраивается как враждебный
 * вход, а не как удобный формат.
 *
 * `processEntities: false` — не косметика. У fast-xml-parser есть актуальная
 * CVE-2026-26278 на расширение сущностей (обход защиты от Billion Laughs
 * в DocTypeReader). Отключение сущностей и DTD закрывает сразу два класса атак:
 *
 *   XXE            `<!ENTITY x SYSTEM "file:///etc/passwd">` — чтение файлов
 *                  и SSRF через внешнюю сущность;
 *   Billion Laughs  вложенные сущности, разворачивающие килобайт в гигабайты.
 *
 * Лимит размера проверяется ДО парсера: бомба не должна доехать до разбора.
 */

import { XMLParser } from 'fast-xml-parser';
import { err, ok, type ParseError, type ParserLimits, type Result } from '@catalog/domain';

/** Конструкции, само присутствие которых во входе — повод отказаться. */
const FORBIDDEN = [
  { re: /<!DOCTYPE/i, construct: 'doctype' as const },
  { re: /<!ENTITY/i, construct: 'entity' as const },
  { re: /SYSTEM\s+["']|PUBLIC\s+["']/i, construct: 'external_reference' as const },
];

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  // Сущности и DTD выключены: CVE-2026-26278 и XXE.
  processEntities: false,
  // Числа и логические значения не угадываются парсером — этим занимается
  // нормализация, где решение видно и проверяемо.
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

const depthOf = (value: unknown, current = 0): number => {
  if (typeof value !== 'object' || value === null) return current;
  let max = current;
  for (const v of Object.values(value as Record<string, unknown>)) {
    max = Math.max(max, depthOf(v, current + 1));
  }
  return max;
};

export const parseXmlSafely = (
  raw: string,
  limits: ParserLimits,
): Result<unknown, ParseError> => {
  const bytes = Buffer.byteLength(raw, 'utf8');
  if (bytes > limits.maxBytes) {
    return err({ kind: 'input_too_large', bytes, limit: limits.maxBytes });
  }

  for (const { re, construct } of FORBIDDEN) {
    if (re.test(raw)) return err({ kind: 'forbidden_xml_construct', construct });
  }

  let parsed: unknown;
  try {
    parsed = parser.parse(raw);
  } catch (e: unknown) {
    return err({ kind: 'malformed_payload', detail: e instanceof Error ? e.message : String(e) });
  }

  const depth = depthOf(parsed);
  if (depth > limits.maxDepth) {
    return err({ kind: 'nesting_too_deep', depth, limit: limits.maxDepth });
  }

  return ok(parsed);
};
