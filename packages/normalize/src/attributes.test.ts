import { describe, expect, it } from 'vitest';
import { normalizeCountry, normalizeDate, normalizeDoseForm, normalizePack, normalizeRxStatus } from './attributes.ts';

describe('дата: формат объявлен, а не угадан', () => {
  it('три написания одной даты дают один канон', () => {
    // Ровно то, что в данных: A — ISO, B — DD.MM.YYYY, C — YYYY/MM/DD.
    expect(normalizeDate('2023-01-15', 'ISO_8601')).toEqual({ ok: true, value: '2023-01-15' });
    expect(normalizeDate('15.01.2023', 'DD.MM.YYYY')).toEqual({ ok: true, value: '2023-01-15' });
    expect(normalizeDate('2023/01/15', 'YYYY/MM/DD')).toEqual({ ok: true, value: '2023-01-15' });
  });

  it('одна и та же строка разбирается ПО-РАЗНОМУ разными форматами', () => {
    // Вот почему формат нельзя угадывать: `03.04.2023` это и третье апреля,
    // и четвёртое марта. Эвристика не ошибётся на данных примера и тихо
    // испортит данные на четвёртом источнике.
    const asDMY = normalizeDate('03/04/2023', 'DD/MM/YYYY');
    const asMDY = normalizeDate('03/04/2023', 'MM/DD/YYYY');
    expect(asDMY).toEqual({ ok: true, value: '2023-04-03' });
    expect(asMDY).toEqual({ ok: true, value: '2023-03-04' });
    expect(asDMY).not.toEqual(asMDY);
  });

  it('несуществующая дата не проходит, даже если форма верна', () => {
    const r = normalizeDate('31.02.2023', 'DD.MM.YYYY');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('unparseable_date');
  });

  it('строка не в объявленном формате уходит в ошибку, а не разбирается наугад', () => {
    expect(normalizeDate('15.01.2023', 'ISO_8601').ok).toBe(false);
    expect(normalizeDate('', 'ISO_8601').ok).toBe(false);
  });
});

describe('страна: словарь, а не эвристика', () => {
  it('три написания из данных дают GB', () => {
    for (const raw of ['GB', 'United Kingdom', 'UK']) {
      const r = normalizeCountry(raw);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.country).toBe('GB');
    }
  });

  it('UK помечается как разрешённый синоним, а не как готовый код', () => {
    // `UK` — не валидный alpha-2, а лишь exceptionally reserved.
    const r = normalizeCountry('UK');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.flags).toContain('country_synonym_resolved');
  });

  it('неизвестная страна не превращается в мусорный код', () => {
    expect(normalizeCountry('Freedonia').ok).toBe(false);
  });
});

describe('рецептурность: tri-state', () => {
  it.each([
    [false, 'otc'],
    ['false', 'otc'],
    ['no', 'otc'],
    [0, 'otc'],
    ['нет', 'otc'],
    [true, 'prescription'],
    ['true', 'prescription'],
    ['yes', 'prescription'],
    ['да', 'prescription'],
  ] as const)('%s → %s', (raw, expected) => {
    expect(normalizeRxStatus(raw).status).toBe(expected);
  });

  it('неизвестное НИКОГДА не схлопывается в безрецептурный', () => {
    // Потребитель каталога может принимать на этом решения об отпуске,
    // а дистанционная продажа Rx регулируется отдельно.
    for (const raw of [null, undefined, '', 'по назначению врача', 42]) {
      const r = normalizeRxStatus(raw);
      expect(r.status).toBe('unknown');
      expect(r.status).not.toBe('otc');
      expect(r.flags).toContain('rx_status_unknown');
    }
  });
});

describe('лекарственная форма', () => {
  it('tablet, tablets и tabs — одна базовая форма', () => {
    for (const raw of ['tablet', 'tablets', 'tabs', 'Tablets', ' TAB ']) {
      const r = normalizeDoseForm(raw);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.doseForm.basic).toBe('TABLET');
    }
  });

  it('уточнение сохраняется, но помечается непроверенным', () => {
    // Источник C утверждает Film-coated при `tabs` в структурном поле.
    // Более подробное значение оказалось не более точным, а просто неверным,
    // поэтому уточнение не назначается победителем автоматически.
    const r = normalizeDoseForm('Film-coated Tabs');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.doseForm.basic).toBe('TABLET');
      expect(r.value.doseForm.full).toBe('FILM_COATED_TABLET');
      expect(r.value.flags).toContain('dose_form_refined_unverified');
    }
  });

  it('плёночная и сахарная оболочка — разные формы, а не синонимы', () => {
    const film = normalizeDoseForm('film coated tablet');
    const sugar = normalizeDoseForm('sugar coated tablet');
    expect(film.ok && sugar.ok).toBe(true);
    if (film.ok && sugar.ok) {
      expect(film.value.doseForm.full).not.toBe(sugar.value.doseForm.full);
      expect(film.value.doseForm.basic).toBe(sugar.value.doseForm.basic); // но сравнение по basic
    }
  });

  it('кириллица разбирается наравне с латиницей', () => {
    const r = normalizeDoseForm('таблетки');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.doseForm.basic).toBe('TABLET');
  });

  it('неизвестная форма уходит в ошибку, а не в TABLET по умолчанию', () => {
    expect(normalizeDoseForm('лиофилизат непонятный').ok).toBe(false);
  });
});

describe('упаковка', () => {
  const tablet = { basic: 'TABLET' } as const;

  it('три написания из данных дают одну упаковку', () => {
    const fromNumber = normalizePack(24, tablet);
    const fromString = normalizePack('24 tablets', tablet);
    const fromObject = normalizePack({ count: 24, type: 'tabs' }, tablet);
    for (const r of [fromNumber, fromString, fromObject]) {
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value.pack.count).toBe(24);
        expect(r.value.pack.unitOfPresentation).toBe('Tablet');
      }
    }
  });

  it('голое число получает единицу из лекформы и отмечает это флагом', () => {
    const r = normalizePack(24, tablet);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.flags).toContain('pack_unit_inferred_from_dose_form');
  });

  it('явно указанная единица не считается выводом', () => {
    const r = normalizePack({ count: 24, type: 'tabs' }, tablet);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.flags).toHaveLength(0);
  });
});
