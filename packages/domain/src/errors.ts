/**
 * Типизированные причины неудач.
 *
 * Разделение, которое легко потерять и дорого потом искать:
 *
 *   ParseError        — запись не удалось разобрать вообще → карантин
 *   MappingError      — разобрали, но не смогли уложить в канон → карантин
 *   QualityFlag       — уложили, но значение сомнительно → запись принимается
 *
 * Одно плохое поле не убивает запись. Карантин — только для того, что
 * нечитаемо; сомнительное принимается с пометкой. Смешать эти случаи значит
 * терять данные.
 */

import type { SourceId } from './brands.ts';

export type ParseError =
  | { readonly kind: 'malformed_payload'; readonly detail: string }
  | { readonly kind: 'input_too_large'; readonly bytes: number; readonly limit: number }
  | { readonly kind: 'nesting_too_deep'; readonly depth: number; readonly limit: number }
  | { readonly kind: 'forbidden_xml_construct'; readonly construct: 'doctype' | 'entity' | 'external_reference' }
  | { readonly kind: 'compression_ratio_exceeded'; readonly ratio: number; readonly limit: number };

export type MappingError =
  | { readonly kind: 'required_field_absent'; readonly field: string }
  | { readonly kind: 'unparseable_date'; readonly raw: string; readonly declaredFormat: string }
  | { readonly kind: 'ambiguous_date'; readonly raw: string }
  | { readonly kind: 'unparseable_strength'; readonly raw: string }
  | { readonly kind: 'unknown_unit'; readonly raw: string }
  | { readonly kind: 'unknown_dose_form'; readonly raw: string }
  | { readonly kind: 'unknown_country'; readonly raw: string }
  | { readonly kind: 'unparseable_pack'; readonly raw: string }
  | { readonly kind: 'unparseable_boolean'; readonly raw: string };

export type TransportError =
  | { readonly kind: 'source_unreachable'; readonly detail: string }
  | { readonly kind: 'blocked_address'; readonly host: string; readonly resolved: string; readonly reason: string }
  | { readonly kind: 'redirect_to_unverified'; readonly location: string };

export type IngestError = ParseError | MappingError | TransportError;

/** Запись, отложенная в карантин: она не потеряна и её причина известна. */
export interface QuarantinedRecord {
  readonly sourceId: SourceId;
  readonly externalId: string | undefined;
  readonly reason: IngestError;
  readonly rawExcerpt: string;
  readonly quarantinedAt: string;
}

export const describeError = (e: IngestError): string => {
  switch (e.kind) {
    case 'malformed_payload': return `не разобрано: ${e.detail}`;
    case 'input_too_large': return `вход ${e.bytes} Б превышает лимит ${e.limit} Б`;
    case 'nesting_too_deep': return `вложенность ${e.depth} превышает лимит ${e.limit}`;
    case 'forbidden_xml_construct': return `запрещённая XML-конструкция: ${e.construct}`;
    case 'compression_ratio_exceeded': return `коэффициент сжатия ${e.ratio} превышает лимит ${e.limit}`;
    case 'required_field_absent': return `отсутствует обязательное поле «${e.field}»`;
    case 'unparseable_date': return `дата «${e.raw}» не разбирается форматом ${e.declaredFormat}`;
    case 'ambiguous_date': return `дата «${e.raw}» неоднозначна без объявленного формата`;
    case 'unparseable_strength': return `дозировка «${e.raw}» не разбирается`;
    case 'unknown_unit': return `неизвестная единица измерения «${e.raw}»`;
    case 'unknown_dose_form': return `неизвестная лекарственная форма «${e.raw}»`;
    case 'unknown_country': return `неизвестная страна «${e.raw}»`;
    case 'unparseable_pack': return `упаковка «${e.raw}» не разбирается`;
    case 'unparseable_boolean': return `не логическое значение: «${e.raw}»`;
    case 'source_unreachable': return `источник недоступен: ${e.detail}`;
    case 'blocked_address': return `адрес заблокирован: ${e.host} → ${e.resolved} (${e.reason})`;
    case 'redirect_to_unverified': return `редирект на непроверенный адрес: ${e.location}`;
  }
};
