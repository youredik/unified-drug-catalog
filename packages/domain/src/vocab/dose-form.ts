/**
 * Лекарственные формы по EDQM Standard Terms.
 *
 * Ключевое различение: `basic` и `full`.
 *
 * `full` — точный термин EDQM: «Film-coated tablet», «Sugar-coated tablet»,
 * «Coated tablet» — это РАЗНЫЕ формы, а не синонимы. Проверено на данных:
 * источник C утверждает `Film-coated Tabs`, тогда как в его же структурном поле
 * структурное поле у него — просто `tabs`. То есть более подробное
 * значение оказалось не более точным, а просто неверным.
 *
 * Отсюда правило: матчинг сравнивает по `basic` (обе записи — TABLET),
 * а расхождение по `full` фиксируется как конфликт и не назначается
 * победителем «по специфичности», пока не подтверждено справочником.
 */

/** Базовая форма — ось сравнения при матчинге. */
export type BasicDoseForm =
  | 'TABLET'
  | 'CAPSULE'
  | 'SOLUTION'
  | 'SUSPENSION'
  | 'SYRUP'
  | 'OINTMENT'
  | 'CREAM'
  | 'GEL'
  | 'SUPPOSITORY'
  | 'POWDER'
  | 'DROPS'
  | 'SPRAY'
  | 'PATCH';

/** Уточнённая форма — сохраняется, но сама по себе не решает исход матчинга. */
export type FullDoseForm =
  | BasicDoseForm
  | 'FILM_COATED_TABLET'
  | 'COATED_TABLET'
  | 'SUGAR_COATED_TABLET'
  | 'EFFERVESCENT_TABLET'
  | 'CHEWABLE_TABLET'
  | 'PROLONGED_RELEASE_TABLET'
  | 'HARD_CAPSULE'
  | 'SOFT_CAPSULE'
  | 'ORAL_SOLUTION'
  | 'ORAL_SUSPENSION'
  | 'SOLUTION_FOR_INJECTION';

export interface DoseForm {
  readonly basic: BasicDoseForm;
  /** Присутствует, только если источник дал уточнение сверх базовой формы. */
  readonly full?: FullDoseForm;
}

/** Человекочитаемое имя EDQM — идёт в выгрузку каталога. */
export const EDQM_LABEL: Readonly<Record<FullDoseForm, string>> = {
  TABLET: 'Tablet',
  CAPSULE: 'Capsule',
  SOLUTION: 'Solution',
  SUSPENSION: 'Suspension',
  SYRUP: 'Syrup',
  OINTMENT: 'Ointment',
  CREAM: 'Cream',
  GEL: 'Gel',
  SUPPOSITORY: 'Suppository',
  POWDER: 'Powder',
  DROPS: 'Drops',
  SPRAY: 'Spray',
  PATCH: 'Patch',
  FILM_COATED_TABLET: 'Film-coated tablet',
  COATED_TABLET: 'Coated tablet',
  SUGAR_COATED_TABLET: 'Sugar-coated tablet',
  EFFERVESCENT_TABLET: 'Effervescent tablet',
  CHEWABLE_TABLET: 'Chewable tablet',
  PROLONGED_RELEASE_TABLET: 'Prolonged-release tablet',
  HARD_CAPSULE: 'Hard capsule',
  SOFT_CAPSULE: 'Soft capsule',
  ORAL_SOLUTION: 'Oral solution',
  ORAL_SUSPENSION: 'Oral suspension',
  SOLUTION_FOR_INJECTION: 'Solution for injection',
};

/** Уточнённая форма → её базовая. Основа правила «сравниваем по basic». */
const TO_BASIC: Readonly<Record<FullDoseForm, BasicDoseForm>> = {
  TABLET: 'TABLET',
  FILM_COATED_TABLET: 'TABLET',
  COATED_TABLET: 'TABLET',
  SUGAR_COATED_TABLET: 'TABLET',
  EFFERVESCENT_TABLET: 'TABLET',
  CHEWABLE_TABLET: 'TABLET',
  PROLONGED_RELEASE_TABLET: 'TABLET',
  CAPSULE: 'CAPSULE',
  HARD_CAPSULE: 'CAPSULE',
  SOFT_CAPSULE: 'CAPSULE',
  SOLUTION: 'SOLUTION',
  ORAL_SOLUTION: 'SOLUTION',
  SOLUTION_FOR_INJECTION: 'SOLUTION',
  SUSPENSION: 'SUSPENSION',
  ORAL_SUSPENSION: 'SUSPENSION',
  SYRUP: 'SYRUP',
  OINTMENT: 'OINTMENT',
  CREAM: 'CREAM',
  GEL: 'GEL',
  SUPPOSITORY: 'SUPPOSITORY',
  POWDER: 'POWDER',
  DROPS: 'DROPS',
  SPRAY: 'SPRAY',
  PATCH: 'PATCH',
};

export const toBasic = (full: FullDoseForm): BasicDoseForm => TO_BASIC[full];

/**
 * Токен источника → форма EDQM. Ключи в нижнем регистре, пробелы схлопнуты,
 * дефисы приведены к пробелу — так `Film-coated Tabs` и `film coated tabs`
 * попадают в одну строку таблицы.
 */
const TOKENS: ReadonlyMap<string, FullDoseForm> = new Map([
  ['tablet', 'TABLET'],
  ['tablets', 'TABLET'],
  ['tab', 'TABLET'],
  ['tabs', 'TABLET'],
  ['таблетка', 'TABLET'],
  ['таблетки', 'TABLET'],
  ['таб', 'TABLET'],

  ['film coated tablet', 'FILM_COATED_TABLET'],
  ['film coated tablets', 'FILM_COATED_TABLET'],
  ['film coated tabs', 'FILM_COATED_TABLET'],
  ['film coated tab', 'FILM_COATED_TABLET'],
  ['таблетки покрытые пленочной оболочкой', 'FILM_COATED_TABLET'],

  ['coated tablet', 'COATED_TABLET'],
  ['coated tablets', 'COATED_TABLET'],
  ['coated tabs', 'COATED_TABLET'],

  ['sugar coated tablet', 'SUGAR_COATED_TABLET'],
  ['sugar coated tablets', 'SUGAR_COATED_TABLET'],
  ['драже', 'SUGAR_COATED_TABLET'],

  ['effervescent tablet', 'EFFERVESCENT_TABLET'],
  ['effervescent tablets', 'EFFERVESCENT_TABLET'],
  ['шипучие таблетки', 'EFFERVESCENT_TABLET'],

  ['chewable tablet', 'CHEWABLE_TABLET'],
  ['chewable tablets', 'CHEWABLE_TABLET'],

  ['prolonged release tablet', 'PROLONGED_RELEASE_TABLET'],
  ['prolonged release tablets', 'PROLONGED_RELEASE_TABLET'],

  ['capsule', 'CAPSULE'],
  ['capsules', 'CAPSULE'],
  ['caps', 'CAPSULE'],
  ['капсула', 'CAPSULE'],
  ['капсулы', 'CAPSULE'],
  ['hard capsule', 'HARD_CAPSULE'],
  ['hard capsules', 'HARD_CAPSULE'],
  ['soft capsule', 'SOFT_CAPSULE'],
  ['soft capsules', 'SOFT_CAPSULE'],
  ['liquid capsule', 'SOFT_CAPSULE'],
  ['liquid capsules', 'SOFT_CAPSULE'],

  ['solution', 'SOLUTION'],
  ['oral solution', 'ORAL_SOLUTION'],
  ['раствор', 'SOLUTION'],
  ['solution for injection', 'SOLUTION_FOR_INJECTION'],
  ['раствор для инъекций', 'SOLUTION_FOR_INJECTION'],

  ['suspension', 'SUSPENSION'],
  ['oral suspension', 'ORAL_SUSPENSION'],
  ['суспензия', 'SUSPENSION'],

  ['syrup', 'SYRUP'],
  ['сироп', 'SYRUP'],
  ['ointment', 'OINTMENT'],
  ['мазь', 'OINTMENT'],
  ['cream', 'CREAM'],
  ['крем', 'CREAM'],
  ['gel', 'GEL'],
  ['гель', 'GEL'],
  ['suppository', 'SUPPOSITORY'],
  ['suppositories', 'SUPPOSITORY'],
  ['свечи', 'SUPPOSITORY'],
  ['суппозитории', 'SUPPOSITORY'],
  ['powder', 'POWDER'],
  ['порошок', 'POWDER'],
  ['drops', 'DROPS'],
  ['капли', 'DROPS'],
  ['spray', 'SPRAY'],
  ['спрей', 'SPRAY'],
  ['patch', 'PATCH'],
  ['пластырь', 'PATCH'],
]);

const canonicalKey = (raw: string): string =>
  raw.trim().toLowerCase().replace(/[-‐‑–—]/g, ' ').replace(/[.,]/g, '').replace(/\s+/g, ' ');

export const lookupDoseForm = (raw: string): DoseForm | undefined => {
  const full = TOKENS.get(canonicalKey(raw));
  if (full === undefined) return undefined;
  const basic = toBasic(full);
  return basic === full ? { basic } : { basic, full };
};

/** Токены, встречающиеся в торговом наименовании и подлежащие выносу. */
export const DOSE_FORM_TOKENS: readonly string[] = [...TOKENS.keys()];
