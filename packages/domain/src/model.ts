/**
 * Каноническая модель — Published Language между контекстами.
 *
 * Три уровня:
 *
 *   DrugConcept    МНН + лекформа + дозировка      узел СМНН; группирует взаимозаменяемые
 *         ↑
 *   CatalogItem    + бренд, производитель,         товарная позиция;
 *                  упаковка, идентификатор         сюда схлопываются дубликаты
 *         ↑
 *   SourceRecord   нормализованная запись          хранятся все, с провенансом
 *
 * Концепт не украшение: без него легко склеить взаимозаменяемые препараты как
 * дубликаты. В российском контуре это понятие юридическое — статья 27.1 закона
 * об обращении ЛС, перечень формирует НЦЭСМП внутри одного МНН.
 */

import type {
  AtcCode, CatalogItemId, CountryCode, DrugConceptId, Gtin14, Inn, IsoDate,
  OrganizationId, RulesetVersion, RunId, SourceId, SourceRecordId, UcumCode,
} from './brands.ts';
import type { DoseForm } from './vocab/dose-form.ts';

// ─── Дозировка ───────────────────────────────────────────────────────────────

export interface Quantity {
  readonly value: number;
  readonly unit: UcumCode;
}

/**
 * Три случая, а не один. См. комментарий в vocab/ucum.ts: приведение всего
 * к массе теряет концентрацию и биологическую активность.
 */
export type Strength =
  | { readonly kind: 'quantity'; readonly amount: Quantity }
  | { readonly kind: 'ratio'; readonly numerator: Quantity; readonly denominator: Quantity };

export interface PackSize {
  readonly count: number;
  /** Единица представления: чего именно `count` штук. Выводится из лекформы. */
  readonly unitOfPresentation: string;
}

// ─── Рецептурность ───────────────────────────────────────────────────────────

/**
 * Tri-state, и это не педантизм. `unknown` НИКОГДА не схлопывается в `otc`:
 * потребитель каталога может принимать на этом решения об отпуске, а
 * дистанционная продажа рецептурных препаратов регулируется отдельно.
 * Неизвестное должно оставаться неизвестным.
 */
export type RxStatus = 'prescription' | 'otc' | 'unknown';

// ─── Качество данных ─────────────────────────────────────────────────────────

/**
 * Флаги качества — аннотации, а не приговор. Запись с флагом остаётся рабочей;
 * флаг влияет на вес поля при матчинге и попадает в отчёт качества.
 */
export type QualityFlag =
  | 'gtin_check_digit_invalid'
  | 'gtin_absent'
  | 'gtin_malformed'
  | 'gtin_non_numeric_stripped'
  | 'dose_form_unmapped'
  | 'dose_form_refined_unverified'
  | 'strength_unit_assumed_from_manifest'
  | 'pack_unit_inferred_from_dose_form'
  | 'country_synonym_resolved'
  | 'rx_status_unknown'
  | 'inn_absent';

// ─── Уровень 3: запись источника ─────────────────────────────────────────────

/** Сырая запись как пришла. Bronze — то, из чего каталог пересобирается. */
export interface RawSourceRecord {
  readonly id: SourceRecordId;
  readonly sourceId: SourceId;
  /** Идентификатор записи внутри источника (`A-1001`, `NET2-88`, `sku_30041`). */
  readonly externalId: string;
  /** Полезная нагрузка как пришла, без интерпретации. */
  readonly payload: unknown;
  /** Хэш содержимого — основа идемпотентности повторного приёма. */
  readonly contentHash: string;
  readonly ingestedAt: string;
  readonly runId: RunId;
  readonly sourceContractVersion: string;
}

/** Запись после нормализации. Silver. */
export interface NormalizedRecord {
  readonly id: SourceRecordId;
  readonly sourceId: SourceId;
  readonly externalId: string;

  readonly kind: ProductKind;
  readonly tradeName: string;
  /** Ядро бренда: из наименования вынесены дозировка, форма и упаковка. */
  readonly brandCore: string;
  /** Ключ сравнения: транслитерация ГОСТ 7.79 + схлопывание. */
  readonly brandKey: string;

  readonly manufacturerRaw: string;
  readonly organizationId?: OrganizationId;

  readonly gtin?: Gtin14;
  readonly gtinValid: boolean;

  readonly strength?: Strength;
  readonly doseForm?: DoseForm;
  readonly pack?: PackSize;
  readonly rxStatus: RxStatus;
  readonly country?: CountryCode;
  readonly registeredAt?: IsoDate;

  readonly inn: readonly Inn[];
  readonly atc?: AtcCode;

  readonly qualityFlags: readonly QualityFlag[];
  readonly rulesetVersion: RulesetVersion;
}

/**
 * Выход anti-corruption layer: поля разложены по каноническим именам,
 * но значения ещё сырые — как прислал источник.
 *
 * Это и есть граница между «формат поставщика» и «наш канон»: ACL знает про
 * `strength_mg`, `<packaging>` и `attributes.dose.amount`, а нормализация про
 * них уже не знает и работать с ними не обязана.
 */
export interface MappedFields {
  readonly externalId: string;
  readonly tradeName: unknown;
  readonly manufacturer: unknown;
  readonly gtin: unknown;
  readonly strength: unknown;
  readonly doseForm: unknown;
  readonly pack: unknown;
  readonly rx: unknown;
  readonly country: unknown;
  readonly registeredAt: unknown;
  readonly kind?: ProductKind;
  readonly inn?: readonly string[];
  readonly atc?: string;
}

// ─── Уровень 2: товарная позиция ─────────────────────────────────────────────

export type ProductKind = 'medicine' | 'supplement' | 'medicalDevice' | 'cosmetics' | 'other';

/**
 * Размеченное объединение, а не плоская таблица с обнуляемыми полями:
 * у ЛП, БАДа и медизделия разные регуляторы, реестры и обязательные атрибуты.
 * Пример-датасет целиком `medicine`, но модель обязана держать остальные —
 * иначе четвёртый поставщик со списком БАДов её ломает.
 */
export type ProductAttributes =
  | {
      readonly kind: 'medicine';
      readonly inn: readonly Inn[];
      readonly doseForm?: DoseForm;
      readonly strength?: Strength;
      readonly rxStatus: RxStatus;
      readonly atc?: AtcCode;
    }
  | {
      readonly kind: 'supplement';
      readonly activeIngredients: readonly string[];
      readonly registry: 'rospotrebnadzor';
    }
  | {
      readonly kind: 'medicalDevice';
      readonly registrationNumber?: string;
      readonly nomenclatureClass?: string;
    }
  | { readonly kind: 'cosmetics' }
  | { readonly kind: 'other' };

export interface CatalogItem {
  readonly id: CatalogItemId;
  readonly conceptId?: DrugConceptId;

  readonly tradeName: string;
  readonly brandCore: string;
  readonly manufacturer: string;
  readonly organizationId?: OrganizationId;

  readonly gtin?: Gtin14;
  readonly gtinValid: boolean;

  readonly pack?: PackSize;
  readonly country?: CountryCode;
  readonly registeredAt?: IsoDate;

  readonly attributes: ProductAttributes;

  /** Все источники, из которых собрана позиция. */
  readonly sources: readonly SourceRecordId[];
  /** Провенанс по каждому полю — откуда, по какому правилу, был ли конфликт. */
  readonly provenance: readonly FieldProvenance[];
  readonly qualityFlags: readonly QualityFlag[];

  readonly runId: RunId;
  readonly rulesetVersion: RulesetVersion;
}

// ─── Уровень 1: концепт ──────────────────────────────────────────────────────

export interface DrugConcept {
  readonly id: DrugConceptId;
  readonly inn: readonly Inn[];
  readonly doseForm?: DoseForm;
  readonly strength?: Strength;
  /** Позиции внутри концепта взаимозаменяемы в смысле ст. 27.1. */
  readonly items: readonly CatalogItemId[];
}

// ─── Провенанс и выживание ───────────────────────────────────────────────────

/**
 * Порядок правил выживания. Первым идёт ПРОВЕРЯЕМАЯ специфичность, а не
 * специфичность вообще: источник C дал `Film-coated Tabs` при `tabs`
 * в собственном структурном поле, и справочник это уточнение не подтверждает.
 * Более подробное значение вполне может оказаться просто неверным, поэтому
 * уточнение без подтверждения справочником — конфликт, а не победа.
 */
export type SurvivorshipRule =
  | 'verified_specificity'
  | 'source_trust_for_field'
  | 'completeness'
  | 'recency'
  | 'only_candidate';

export interface FieldProvenance {
  readonly field: string;
  readonly sourceId: SourceId;
  readonly sourceRecordId: SourceRecordId;
  readonly rule: SurvivorshipRule;
  readonly value: string;
  readonly competitors: readonly { readonly sourceId: SourceId; readonly value: string }[];
  /** Расхождение зафиксировано, а не погашено выбором победителя. */
  readonly conflict: boolean;
}

// ─── Аудит матчинга ──────────────────────────────────────────────────────────

export type MatchZone = 'match' | 'possible' | 'non_match';
export type MatchDecidedBy = 'deterministic' | 'fellegi_sunter' | 'adjudicator' | 'manual';

export interface ComparisonWeight {
  readonly field: string;
  readonly level: string;
  /** log2(m/u) — вклад поля в общий вес. */
  readonly weight: number;
}

export interface MatchDecision {
  readonly leftId: SourceRecordId;
  readonly rightId: SourceRecordId;
  readonly totalWeight: number;
  readonly probability: number;
  readonly zone: MatchZone;
  readonly decidedBy: MatchDecidedBy;
  readonly weights: readonly ComparisonWeight[];
  /** Заполняется, когда решала языковая модель. */
  readonly adjudication?: {
    readonly isMatch: boolean;
    readonly confidence: number;
    readonly discriminatingField: string | null;
    readonly reasoning: string;
  };
  /** Один идентификатор у явно разных товаров — конфликт, а не совпадение. */
  readonly conflict?: 'same_gtin_different_products';
}
