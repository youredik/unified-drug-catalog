/**
 * Аптечная сеть C. Вложенный JSON.
 *
 *   { "uid": "sku_30041", "attributes": { "dose": { "amount": 200, "units": "mg" },
 *     "codes": { "ean14": … }, "pack": { "units": 24, "kind": "tabs" } } }
 *
 * Особенность источника: он самый подробный — и именно поэтому на нём видно,
 * что подробность не равна точности. По производителю он даёт самое полное имя
 * юридического лица, а по лекарственной форме заявляет уточнение, которое
 * не подтверждает ни один справочник: `Film-coated` в наименовании при
 * `kind: "tabs"` в структурном поле.
 *
 * Отсюда правило выживания на уровне ПОЛЕЙ, а не источников — см. packages/match.
 */

import { err, ok, type MappedFields, type MappingError, type Result } from '@catalog/domain';
import { pick } from '../spi.ts';

export const mapSourceC = (payload: unknown): Result<MappedFields, MappingError> => {
  const externalId = pick(payload, 'uid');
  if (typeof externalId !== 'string' || externalId === '') {
    return err({ kind: 'required_field_absent', field: 'uid' });
  }
  const d = (...path: readonly string[]): unknown => pick(payload, 'attributes', ...path);

  // Вот ради этого ACL и существует. У источника свои имена вложенных полей:
  // `{ amount, units }` вместо `{ value, unit }`, `{ units, kind }` вместо
  // `{ count, type }`. Переименование делается ЗДЕСЬ, а не в нормализации:
  // иначе каждый новый поставщик добавлял бы ветку в общее правило, и правило
  // превратилось бы в свалку частных случаев.
  return ok({
    externalId,
    tradeName: d('name'),
    manufacturer: d('producer', 'title'),
    gtin: d('codes', 'ean14'),
    strength: { value: d('dose', 'amount'), unit: d('dose', 'units') },
    doseForm: d('pack', 'kind'),
    pack: { count: d('pack', 'units'), type: d('pack', 'kind') },
    rx: d('rx'),
    country: d('market'),
    registeredAt: d('reg'),
  });
};
