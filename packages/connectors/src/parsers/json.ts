/**
 * Разбор недоверенного JSON.
 *
 * У JSON нет сущностей и DTD, но остаются два вектора: объём и глубина.
 * Глубоко вложенный документ кладёт рекурсивный обход стеком, а большой —
 * памятью. Оба лимита объявлены в манифесте источника и проверяются до того,
 * как документ пойдёт дальше.
 */

import { err, ok, type ParseError, type ParserLimits, type Result } from '@catalog/domain';

const depthOf = (value: unknown, current = 0, limit = 1024): number => {
  if (current > limit) return current;
  if (typeof value !== 'object' || value === null) return current;
  let max = current;
  for (const v of Object.values(value as Record<string, unknown>)) {
    max = Math.max(max, depthOf(v, current + 1, limit));
    if (max > limit) return max;
  }
  return max;
};

export const parseJsonSafely = (
  raw: string,
  limits: ParserLimits,
): Result<unknown, ParseError> => {
  const bytes = Buffer.byteLength(raw, 'utf8');
  if (bytes > limits.maxBytes) {
    return err({ kind: 'input_too_large', bytes, limit: limits.maxBytes });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e: unknown) {
    return err({ kind: 'malformed_payload', detail: e instanceof Error ? e.message : String(e) });
  }

  const depth = depthOf(parsed, 0, limits.maxDepth + 1);
  if (depth > limits.maxDepth) {
    return err({ kind: 'nesting_too_deep', depth, limit: limits.maxDepth });
  }

  return ok(parsed);
};
