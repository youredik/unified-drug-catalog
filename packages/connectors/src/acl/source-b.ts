/**
 * Аптечная сеть B. XML, camelCase.
 *
 *   <medicine><externalId>b-777</externalId><dosage>200 mg</dosage>…</medicine>
 *
 * Особенности источника: всё приходит строками (включая логическое `rx`),
 * идентификатор разделён дефисами (`0505-0123-4567-89`), дата в DD.MM.YYYY,
 * а страна написана полным названием («United Kingdom»). Ни одно из этих
 * различий сюда не просачивается — ACL только раскладывает поля по местам,
 * а приведением значений занимается нормализация.
 */

import { err, ok, type MappedFields, type MappingError, type Result } from '@catalog/domain';
import { asTrimmedText } from '@catalog/normalize';
import { pick } from '../spi.ts';

export const mapSourceB = (payload: unknown): Result<MappedFields, MappingError> => {
  // XML отдаёт значения строками, но узел с атрибутами приезжает объектом.
  // Приводить объект к тексту нельзя: «[object Object]» выглядит как
  // идентификатор и молча становится ключом записи.
  const externalId = asTrimmedText(pick(payload, 'code'));
  if (externalId === undefined) {
    return err({ kind: 'required_field_absent', field: 'code' });
  }
  return ok({
    externalId,
    tradeName: pick(payload, 'name'),
    manufacturer: pick(payload, 'vendor'),
    gtin: pick(payload, 'ean'),
    strength: pick(payload, 'strength'),
    doseForm: pick(payload, 'form'),
    pack: pick(payload, 'packaging'),
    rx: pick(payload, 'prescription'),
    country: pick(payload, 'country'),
    registeredAt: pick(payload, 'registered'),
  });
};
