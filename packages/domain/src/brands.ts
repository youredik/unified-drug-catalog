/**
 * Брендированные типы.
 *
 * Смысл не в педантизме: `SourceId` и `CatalogItemId` — обе строки, и без
 * брендов их можно перепутать в сигнатуре, а компилятор промолчит. Здесь
 * молчать он не станет.
 */

declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

/** Идентификатор аптечной сети в реестре источников. */
export type SourceId = Brand<string, 'SourceId'>;
export const SourceId = (v: string): SourceId => v as SourceId;

/** Идентификатор сырой записи источника (bronze). */
export type SourceRecordId = Brand<string, 'SourceRecordId'>;
export const SourceRecordId = (v: string): SourceRecordId => v as SourceRecordId;

/** Стабильный идентификатор товарной позиции, переживающий прогоны. */
export type CatalogItemId = Brand<string, 'CatalogItemId'>;
export const CatalogItemId = (v: string): CatalogItemId => v as CatalogItemId;

/** Идентификатор узла концепта (МНН + лекформа + дозировка). */
export type DrugConceptId = Brand<string, 'DrugConceptId'>;
export const DrugConceptId = (v: string): DrugConceptId => v as DrugConceptId;

/** Идентификатор организации после разрешения алиасов. */
export type OrganizationId = Brand<string, 'OrganizationId'>;
export const OrganizationId = (v: string): OrganizationId => v as OrganizationId;

/** Прогон конвейера. Каждая золотая запись знает, каким прогоном рождена. */
export type RunId = Brand<string, 'RunId'>;
export const RunId = (v: string): RunId => v as RunId;

/** Версия набора правил нормализации и матчинга. */
export type RulesetVersion = Brand<string, 'RulesetVersion'>;
export const RulesetVersion = (v: string): RulesetVersion => v as RulesetVersion;

/**
 * GTIN, приведённый к 14 знакам. Бренд не утверждает, что контрольная цифра
 * сошлась — валидность живёт отдельным флагом качества, потому что невалидный
 * идентификатор всё ещё полезен для блокировки кандидатов.
 */
export type Gtin14 = Brand<string, 'Gtin14'>;
export const Gtin14 = (v: string): Gtin14 => v as Gtin14;

/** Код страны ISO 3166-1 alpha-2. `UK` сюда не попадает — только `GB`. */
export type CountryCode = Brand<string, 'CountryCode'>;
export const CountryCode = (v: string): CountryCode => v as CountryCode;

/** Код единицы измерения UCUM: `mg`, `mL`, `[IU]`. */
export type UcumCode = Brand<string, 'UcumCode'>;
export const UcumCode = (v: string): UcumCode => v as UcumCode;

/** Международное непатентованное наименование, нормализованное. */
export type Inn = Brand<string, 'Inn'>;
export const Inn = (v: string): Inn => v as Inn;

/** Код анатомо-терапевтическо-химической классификации, напр. `M01AE01`. */
export type AtcCode = Brand<string, 'AtcCode'>;
export const AtcCode = (v: string): AtcCode => v as AtcCode;

/** Дата в формате ISO 8601 (`YYYY-MM-DD`), уже разобранная по формату источника. */
export type IsoDate = Brand<string, 'IsoDate'>;
export const IsoDate = (v: string): IsoDate => v as IsoDate;
