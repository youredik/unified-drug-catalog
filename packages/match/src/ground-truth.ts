/**
 * Размеченный набор пар — измерительный инструмент матчинга.
 *
 * Три записи об одном товаре из задания не доказывают ничего: на них любой
 * матчинг даёт 100%. Ценность набора — в ТРУДНЫХ ОТРИЦАТЕЛЬНЫХ: парах, которые
 * выглядят как дубликаты и таковыми не являются. Именно они ловят склонность
 * правил переобъединять.
 *
 * Самый важный случай здесь — «тот же МНН, другой бренд». Это не дубликат,
 * а взаимозаменяемый препарат: по статье 27.1 закона об обращении ЛС такие
 * позиции группируются внутри одного МНН, но остаются РАЗНЫМИ товарными
 * позициями. Система, которая их склеит, разрушит каталог тихо и необратимо.
 */

import {
  Gtin14, Inn, IsoDate, RulesetVersion, SourceId, SourceRecordId, UcumCode,
  type NormalizedRecord, type Strength,
} from '@catalog/domain';
import { brandCore, brandKey } from '@catalog/normalize';
import type { LabelledPair } from './metrics.ts';

const mg = (value: number): Strength => ({
  kind: 'quantity',
  amount: { value, unit: UcumCode('mg') },
});

interface Overrides {
  readonly source?: string;
  readonly name: string;
  readonly manufacturer?: string;
  readonly gtin?: string | undefined;
  readonly gtinValid?: boolean;
  readonly strength?: Strength | undefined;
  readonly form?: 'TABLET' | 'SYRUP' | 'CAPSULE';
  readonly packCount?: number;
  readonly inn?: string;
}

let counter = 0;
const record = (o: Overrides): NormalizedRecord => {
  counter += 1;
  const source = o.source ?? `src-${counter}`;
  return {
    id: SourceRecordId(`${source}:r${counter}`),
    sourceId: SourceId(source),
    externalId: `r${counter}`,
    kind: 'medicine',
    tradeName: o.name,
    brandCore: brandCore(o.name),
    brandKey: brandKey(o.name),
    manufacturerRaw: o.manufacturer ?? 'Acme Pharma',
    ...(o.gtin === undefined ? {} : { gtin: Gtin14(o.gtin) }),
    gtinValid: o.gtinValid ?? false,
    ...(o.strength === undefined ? {} : { strength: o.strength }),
    doseForm: { basic: o.form ?? 'TABLET' },
    pack: { count: o.packCount ?? 24, unitOfPresentation: 'Tablet' },
    rxStatus: 'otc',
    registeredAt: IsoDate('2023-01-15'),
    inn: o.inn === undefined ? [] : [Inn(o.inn)],
    qualityFlags: [],
    rulesetVersion: RulesetVersion('ground-truth'),
  };
};

const INVALID = '05050123456789'; // тот самый, с несошедшейся контрольной цифрой
const VALID = '05901234123457';

export const GROUND_TRUTH: readonly LabelledPair[] = [
  // ── Положительные ─────────────────────────────────────────────────────────
  {
    name: 'один товар, разные написания наименования',
    left: record({ name: 'Acmeflex 200 mg Tablets', gtin: INVALID, strength: mg(200) }),
    right: record({ name: 'Acmeflex Tablets 200mg', gtin: INVALID, strength: mg(200) }),
    isMatch: true,
    rationale: 'ровно случай из данных задания',
  },
  {
    name: 'кириллица против латиницы',
    left: record({ name: 'Нордамет 200 мг таблетки', strength: mg(200) }),
    right: record({ name: 'Nordamet 200 mg Tablets', strength: mg(200) }),
    isMatch: true,
    rationale: 'то, на чём чаще всего ошибаются языковые модели — снимается транслитерацией ДО матчинга',
  },
  {
    name: 'опечатка в наименовании',
    left: record({ name: 'Acmeflex 200 mg', strength: mg(200) }),
    right: record({ name: 'Acmefleex 200 mg', strength: mg(200) }),
    isMatch: true,
    rationale: 'ловится нечёткой блокировкой и триграммным уровнем',
  },
  {
    name: 'идентификатор отсутствует у обоих',
    left: record({ name: 'Acmeflex 200 mg', gtin: undefined, strength: mg(200) }),
    right: record({ name: 'Acmeflex 200 mg', gtin: undefined, strength: mg(200) }),
    isMatch: true,
    rationale: 'решение принимается составным ключом, а не идентификатором',
  },
  {
    name: 'производитель разной подробности',
    left: record({ name: 'Acmeflex 200 mg', manufacturer: 'Acme Pharma', strength: mg(200) }),
    right: record({ name: 'Acmeflex 200 mg', manufacturer: 'Acme Pharma Healthcare', strength: mg(200) }),
    isMatch: true,
    rationale: 'одна группа компаний, разная степень детализации имени',
  },
  {
    name: 'валидный идентификатор совпал',
    left: record({ name: 'Ibunord 200 mg', gtin: VALID, gtinValid: true, strength: mg(200), manufacturer: 'US Pharmacia' }),
    right: record({ name: 'Ibunord 200', gtin: VALID, gtinValid: true, strength: mg(200), manufacturer: 'US Pharmacia' }),
    isMatch: true,
    rationale: 'совпадение по прошедшему контрольную сумму идентификатору — сильнейший довод',
  },

  // ── Трудные отрицательные ─────────────────────────────────────────────────
  {
    name: 'та же дозировка и форма, ДРУГАЯ упаковка',
    left: record({ name: 'Acmeflex 200 mg', strength: mg(200), packCount: 24 }),
    right: record({ name: 'Acmeflex 200 mg', strength: mg(200), packCount: 12 }),
    isMatch: false,
    rationale: 'разные товарные позиции: 24 и 12 таблеток продаются раздельно',
  },
  {
    name: 'тот же бренд, ДРУГАЯ дозировка',
    left: record({ name: 'Acmeflex 200 mg', strength: mg(200) }),
    right: record({ name: 'Acmeflex 400 mg', strength: mg(400) }),
    isMatch: false,
    rationale: 'дозировка разводит позиции надёжнее всего остального',
  },
  {
    name: 'тот же МНН, ДРУГОЙ бренд — взаимозаменяемый, а не дубликат',
    left: record({ name: 'Acmeflex 200 mg', gtin: undefined, strength: mg(200), inn: 'ibuprofen', manufacturer: 'Acme Pharma' }),
    right: record({ name: 'Ibunord 200 mg', gtin: undefined, strength: mg(200), inn: 'ibuprofen', manufacturer: 'US Pharmacia' }),
    isMatch: false,
    rationale: 'ст. 27.1: одна группа взаимозаменяемости, но РАЗНЫЕ позиции каталога',
  },
  {
    name: 'тот же бренд, ДРУГАЯ лекформа',
    left: record({ name: 'Acmeflex 200 mg', strength: mg(200), form: 'TABLET' }),
    right: record({ name: 'Acmeflex 200 mg', strength: mg(200), form: 'SYRUP' }),
    isMatch: false,
    rationale: 'таблетки и сироп — разные позиции при одном бренде и одной дозировке',
  },
  {
    name: 'совсем разные препараты',
    left: record({ name: 'Acmeflex 200 mg', strength: mg(200) }),
    right: record({ name: 'Paracetamol 500 mg', strength: mg(500), manufacturer: 'Acme Pharma' }),
    isMatch: false,
    rationale: 'базовый отрицательный контроль',
  },
  {
    name: 'разные идентификаторы при похожем наименовании',
    left: record({ name: 'Acmeflex 200 mg', gtin: VALID, gtinValid: true, strength: mg(200) }),
    right: record({ name: 'Acmeflex 200 mg', gtin: INVALID, strength: mg(200), packCount: 12 }),
    isMatch: false,
    rationale: 'различающиеся идентификаторы — сильный довод против тождества',
  },
];

/**
 * Отдельный набор: ошибки поставщика, где правильный ответ — не «да» и не
 * «нет», а «поднять руку». Он оценивается иначе и в F1 не входит.
 */
export const CONFLICT_CASES: readonly LabelledPair[] = [
  {
    name: 'ОДИН идентификатор у явно разных товаров',
    left: record({ name: 'Acmeflex 200 mg', gtin: INVALID, strength: mg(200) }),
    right: record({ name: 'Acmeflex 400 mg', gtin: INVALID, strength: mg(400) }),
    isMatch: false,
    rationale: 'ошибка выгрузки поставщика: склеивать нельзя, нужен ручной разбор',
  },
];
