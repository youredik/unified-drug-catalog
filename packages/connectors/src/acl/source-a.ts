/**
 * Аптечная сеть A. Плоский JSON-массив, snake_case.
 *
 *   { "sku": "A-1001", "title": "Acmeflex 200 mg Tablets", "strength_mg": 200, ... }
 *
 * Особенность источника: дозировка приезжает голым числом. Единица объявлена
 * в манифесте (`defaultStrengthUnit`), а НЕ выводится из имени поля `strength_mg`:
 * завтра поле переименуют в `dose`, и молчаливое предположение превратится
 * в неверные данные.
 */

import { err, ok, type MappedFields, type MappingError, type Result } from '@catalog/domain';
import { pick } from '../spi.ts';

export const mapSourceA = (payload: unknown): Result<MappedFields, MappingError> => {
  const externalId = pick(payload, 'sku');
  if (typeof externalId !== 'string' || externalId === '') {
    return err({ kind: 'required_field_absent', field: 'sku' });
  }
  return ok({
    externalId,
    tradeName: pick(payload, 'title'),
    manufacturer: pick(payload, 'maker'),
    gtin: pick(payload, 'barcode'),
    strength: pick(payload, 'strength_mg'),
    doseForm: pick(payload, 'form'),
    pack: pick(payload, 'qty'),
    rx: pick(payload, 'is_rx'),
    country: pick(payload, 'country'),
    registeredAt: pick(payload, 'reg_date'),
  });
};
