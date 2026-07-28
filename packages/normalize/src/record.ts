/**
 * Сборка нормализованной записи из выхода anti-corruption layer.
 *
 * Здесь реализовано разделение, которое легко потерять и дорого потом искать:
 *
 *   нет обязательного поля      → жёсткая ошибка → карантин
 *   поле не разобралось         → мягкая ошибка → поле пустое + флаг качества,
 *                                 запись принимается
 *
 * Одно плохое поле не убивает запись. Карантин — только для того, что
 * нечитаемо целиком. Смешать эти случаи значит терять данные.
 */

import {
  err, Inn, ok, SourceId, SourceRecordId,
  type AtcCode, type MappedFields, type MappingError, type NormalizedRecord,
  type QualityFlag, type Result, type RulesetVersion, type SourceManifest,
} from '@catalog/domain';
import { AtcCode as makeAtc } from '@catalog/domain';
import { doseFormHintFromText, normalizeDate, normalizeCountry, normalizeDoseForm, normalizePack, normalizeRxStatus } from './attributes.ts';
import { normalizeGtin } from './gtin.ts';
import { brandCore, brandKey } from './naming.ts';
import { normalizeStrength } from './strength.ts';

export interface NormalizationOutcome {
  readonly record: NormalizedRecord;
  /** Поля, которые не разобрались. Запись принята, но это видно в отчёте. */
  readonly softErrors: readonly MappingError[];
}

export const normalizeRecord = (
  mapped: MappedFields,
  manifest: SourceManifest,
  rulesetVersion: RulesetVersion,
): Result<NormalizationOutcome, MappingError> => {
  // Торговое наименование — единственное поле, без которого записи нет.
  const tradeName = typeof mapped.tradeName === 'string' ? mapped.tradeName.trim() : '';
  if (tradeName === '') return err({ kind: 'required_field_absent', field: 'tradeName' });

  const flags: QualityFlag[] = [];
  const softErrors: MappingError[] = [];

  const gtin = normalizeGtin(mapped.gtin);
  flags.push(...gtin.flags);

  const doseFormResult = normalizeDoseForm(mapped.doseForm);
  if (doseFormResult.ok) flags.push(...doseFormResult.value.flags);
  else {
    softErrors.push(doseFormResult.error);
    flags.push('dose_form_unmapped');
  }
  let doseForm = doseFormResult.ok ? doseFormResult.value.doseForm : undefined;

  // Уточнение формы может прятаться в наименовании, а не в структурном поле:
  // источник C кладёт `packaging.type: "tabs"`, а «Film-coated» пишет в имени.
  // Подсказка принимается, только если не спорит с базовой формой, и всегда
  // помечается непроверенной: подтверждения в справочнике у неё нет.
  if (doseForm !== undefined && doseForm.full === undefined) {
    const hint = doseFormHintFromText(tradeName);
    if (hint !== undefined && hint.basic === doseForm.basic && hint.full !== undefined) {
      doseForm = { basic: doseForm.basic, full: hint.full };
      flags.push('dose_form_refined_unverified');
    }
  }

  const strengthResult = normalizeStrength(mapped.strength, manifest.defaultStrengthUnit);
  if (strengthResult.ok) flags.push(...strengthResult.value.flags);
  else softErrors.push(strengthResult.error);
  const strength = strengthResult.ok ? strengthResult.value.strength : undefined;

  const packResult = normalizePack(mapped.pack, doseForm);
  if (packResult.ok) flags.push(...packResult.value.flags);
  else softErrors.push(packResult.error);
  const pack = packResult.ok ? packResult.value.pack : undefined;

  const rx = normalizeRxStatus(mapped.rx);
  flags.push(...rx.flags);

  const countryResult = normalizeCountry(mapped.country);
  if (countryResult.ok) flags.push(...countryResult.value.flags);
  else softErrors.push(countryResult.error);
  const country = countryResult.ok ? countryResult.value.country : undefined;

  const dateResult = normalizeDate(mapped.registeredAt, manifest.dateFormat);
  if (!dateResult.ok) softErrors.push(dateResult.error);
  const registeredAt = dateResult.ok ? dateResult.value : undefined;

  const inn = (mapped.inn ?? []).map((v) => Inn(v.trim().toLowerCase()));
  if (inn.length === 0) flags.push('inn_absent');

  const manufacturerRaw =
    typeof mapped.manufacturer === 'string' ? mapped.manufacturer.trim() : '';

  const atc: AtcCode | undefined =
    mapped.atc === undefined ? undefined : makeAtc(mapped.atc.trim().toUpperCase());

  const record: NormalizedRecord = {
    id: SourceRecordId(`${manifest.id}:${mapped.externalId}`),
    sourceId: SourceId(manifest.id),
    externalId: mapped.externalId,
    kind: mapped.kind ?? 'medicine',
    tradeName,
    brandCore: brandCore(tradeName),
    brandKey: brandKey(tradeName),
    manufacturerRaw,
    ...(gtin.gtin === undefined ? {} : { gtin: gtin.gtin }),
    gtinValid: gtin.valid,
    ...(strength === undefined ? {} : { strength }),
    ...(doseForm === undefined ? {} : { doseForm }),
    ...(pack === undefined ? {} : { pack }),
    rxStatus: rx.status,
    ...(country === undefined ? {} : { country }),
    ...(registeredAt === undefined ? {} : { registeredAt }),
    inn,
    ...(atc === undefined ? {} : { atc }),
    qualityFlags: [...new Set(flags)],
    rulesetVersion,
  };

  return ok({ record, softErrors });
};
