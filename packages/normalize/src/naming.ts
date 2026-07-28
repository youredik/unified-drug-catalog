/**
 * Нормализация наименований: торговое имя и производитель.
 *
 * Две разные задачи, которые часто путают.
 *
 * Торговое имя: три источника дают «Acmeflex 200 mg Tablets», «Acmeflex Tablets
 * 200mg» и «Acmeflex Film-coated Tabs». Ядро бренда одно, вокруг него шумят
 * дозировка, форма и упаковка — их надо вынести, чтобы получить сравнимый ключ.
 * Оригинал при этом сохраняется: он идёт в каталог, если этот источник выиграл
 * поле.
 *
 * Производитель: НЕ строка, а отдельная сущность со своими алиасами.
 * И здесь важная тонкость — «Healthcare» в «Acme Pharma Healthcare (UK)
 * Ltd» это часть полного наименования юрлица, а не
 * юридический суффикс. Слепой стриппинг «всего похожего на суффикс» срезал бы
 * различающую часть и склеил бы разные юрлица одной группы компаний.
 * Поэтому снимается только закрытый список организационно-правовых форм.
 */

import { foldForCompare, DOSE_FORM_TOKENS } from '@catalog/domain';

/** Закрытый список организационно-правовых форм. Ничего «похожего» — только это. */
const LEGAL_SUFFIXES: ReadonlySet<string> = new Set([
  'ltd', 'ltd.', 'limited', 'llc', 'l.l.c.', 'inc', 'inc.', 'incorporated',
  'plc', 'p.l.c.', 'corp', 'corp.', 'corporation', 'co', 'co.', 'company',
  'gmbh', 'ag', 'kg', 'ohg', 'sa', 's.a.', 'sas', 'sarl', 's.r.l.', 'srl',
  'spa', 's.p.a.', 'bv', 'b.v.', 'nv', 'n.v.', 'ab', 'as', 'a/s', 'oy', 'oyj',
  'pty', 'sp', 'sp.', 'zoo', 'z.o.o.', 'sro', 's.r.o.', 'dd', 'd.d.', 'doo',
  'ооо', 'оао', 'зао', 'пао', 'ао', 'нао', 'ип',
]);

/** Токены упаковки, шумящие в торговом наименовании. */
const PACK_TOKENS: ReadonlySet<string> = new Set([
  'pack', 'packs', 'blister', 'blisters', 'bottle', 'bottles', 'box', 'boxes',
  'уп', 'упак', 'упаковка', 'блистер', 'флакон',
]);

/** Единицы, встречающиеся приклеенными к числу: `200mg`, `5ml`. */
const UNIT_WORDS =
  'mg|milligram|milligrams|g|gram|grams|mcg|ug|kg|ml|milliliter|millilitre|l|liter|litre|iu|мг|г|мкг|кг|мл|л|ме';

const DOSE_FORM_WORDS: ReadonlySet<string> = new Set(
  DOSE_FORM_TOKENS.flatMap((t) => t.split(' ')),
);

const splitTokens = (s: string): string[] =>
  s
    .replace(/[-‐‑–—]/g, ' ')
    .replace(/[(),.;:]/g, ' ')
    .split(/\s+/)
    .filter((t) => t !== '');

/**
 * Ядро бренда: из наименования вынесены дозировка, форма выпуска и упаковка.
 * Все три записи примера дают `Acmeflex`.
 */
export const brandCore = (tradeName: string): string => {
  const tokens = splitTokens(tradeName);
  const kept = tokens.filter((tokenRaw) => {
    const t = tokenRaw.toLowerCase();
    if (/^\d+([.,]\d+)?$/.test(t)) return false;                       // голое число
    if (new RegExp(`^\\d+([.,]\\d+)?(${UNIT_WORDS})$`).test(t)) return false; // 200mg
    if (new RegExp(`^(${UNIT_WORDS})$`).test(t)) return false;          // отдельная единица
    if (DOSE_FORM_WORDS.has(t)) return false;                          // tablets, tabs, film, coated
    if (PACK_TOKENS.has(t)) return false;
    return true;
  });
  return (kept.length > 0 ? kept : tokens).join(' ');
};

/**
 * Ключ сравнения бренда: транслитерация ГОСТ 7.79 и схлопывание.
 * «Нурофен» и «Acmeflex» дают один ключ — без этого пара не встретится
 * даже в блокировке кандидатов.
 */
export const brandKey = (tradeName: string): string => foldForCompare(brandCore(tradeName));

/**
 * Каноническое имя организации: снимаются только организационно-правовые формы
 * и территориальные скобки. `Healthcare`, `Pharma`, `Labs` остаются — это
 * различающие части названия, а не суффиксы.
 */
export const organizationCore = (raw: string): string => {
  const withoutParens = raw.replace(/\([^)]*\)/g, ' ');
  const tokens = splitTokens(withoutParens).filter(
    (t) => !LEGAL_SUFFIXES.has(t.toLowerCase()),
  );
  return tokens.join(' ');
};

/** Ключ сравнения организаций — та же логика, что и для брендов. */
export const organizationKey = (raw: string): string => foldForCompare(organizationCore(raw));

/**
 * Более специфичное имя организации из двух — но только когда одно является
 * расширением другого. «Acme Pharma Healthcare» специфичнее, чем
 * «Acme Pharma»; «Bayer» и «Sandoz» несравнимы, и тогда `undefined`.
 */
export const moreSpecificOrganization = (a: string, b: string): string | undefined => {
  const ka = organizationKey(a);
  const kb = organizationKey(b);
  if (ka === kb) return a.length >= b.length ? a : b;
  if (ka.startsWith(kb)) return a;
  if (kb.startsWith(ka)) return b;
  return undefined;
};
