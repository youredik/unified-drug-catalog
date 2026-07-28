/**
 * Манифест источника.
 *
 * Три независимые оси, которые нельзя схлопывать в один «адаптер»:
 *
 *   transport   откуда берём байты      file | http | sftp | s3
 *   format      как их разбираем        json | xml | csv
 *   mapping     как кладём в канон      anti-corruption layer, свой на источник
 *
 * «В разных форматах И через разные источники» — это разные вещи.
 * Добавление четвёртой сети = манифест + ACL + зелёный conformance-набор,
 * без единой строчки в ядре.
 *
 * Здесь же объявляется формат даты. `15.01.2023` разбирается однозначно,
 * а `03.04.2023` — нет; угадывать нельзя, иначе четвёртый источник тихо
 * испортит данные.
 */

import { z } from 'zod';

export const DATE_FORMATS = ['ISO_8601', 'DD.MM.YYYY', 'MM/DD/YYYY', 'YYYY/MM/DD', 'DD/MM/YYYY'] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export const transportSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('file'), path: z.string().min(1) }),
  z.object({
    type: z.literal('http'),
    url: z.url(),
    /** S3 — SSRF. Разрешённые хосты объявляются явно, а проверенный IP
     *  закрепляется на соединение: allowlist по имени обходится подменой DNS. */
    allowedHosts: z.array(z.string().min(1)).min(1),
    headers: z.record(z.string(), z.string()).optional(),
  }),
  z.object({ type: z.literal('sftp'), host: z.string(), path: z.string() }),
  z.object({ type: z.literal('s3'), bucket: z.string(), key: z.string() }),
]);

export const parserLimitsSchema = z.object({
  /** Отсекается ДО разбора: XML-бомба не должна доехать до парсера. */
  maxBytes: z.number().int().positive().default(64 * 1024 * 1024),
  maxDepth: z.number().int().positive().default(64),
  /** Защита от архивных бомб: отношение распакованного к упакованному. */
  maxCompressionRatio: z.number().positive().default(200),
});

/**
 * Доверие к источнику — по полю, а не по источнику целиком.
 *
 * Проверено на данных: источник C самый точный по производителю и неверный
 * по лекарственной форме. Глобальный рейтинг источников неверен по построению.
 */
export const fieldTrustSchema = z.object({
  tradeName: z.number().min(0).max(1).default(0.5),
  manufacturer: z.number().min(0).max(1).default(0.5),
  gtin: z.number().min(0).max(1).default(0.5),
  strength: z.number().min(0).max(1).default(0.5),
  doseForm: z.number().min(0).max(1).default(0.5),
  pack: z.number().min(0).max(1).default(0.5),
  rxStatus: z.number().min(0).max(1).default(0.5),
  country: z.number().min(0).max(1).default(0.5),
  registeredAt: z.number().min(0).max(1).default(0.5),
});

export const sourceManifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Версия контракта поставщика: смена схемы = новая версия ACL. */
  contractVersion: z.string().min(1),

  transport: transportSchema,
  format: z.enum(['json', 'xml', 'csv']),
  /** Потоковый разбор для больших фидов; буферный — для малых. */
  streaming: z.boolean().default(false),

  dateFormat: z.enum(DATE_FORMATS),
  timezone: z.string().default('UTC'),

  /**
   * Единица дозировки по умолчанию. Источник A присылает `dosage_mg: 200`
   * без единицы — она объявляется здесь, а не угадывается по имени поля.
   */
  defaultStrengthUnit: z.string().optional(),

  limits: parserLimitsSchema.prefault({}),
  trust: fieldTrustSchema.prefault({}),
});

export type SourceManifest = z.infer<typeof sourceManifestSchema>;
export type Transport = z.infer<typeof transportSchema>;
export type ParserLimits = z.infer<typeof parserLimitsSchema>;
export type FieldTrust = z.infer<typeof fieldTrustSchema>;
