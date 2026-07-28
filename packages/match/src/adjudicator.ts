/**
 * Порт арбитра серой зоны.
 *
 * Порт объявлен здесь, у потребителя, а не у реализации — это и есть смысл
 * гексагональной архитектуры. `match` знает, ЧТО ему нужно от арбитра, и ничего
 * не знает о том, кто и как это делает: языковая модель, человек в очереди
 * разбора или заглушка.
 *
 * Зачем арбитр вообще нужен, и почему именно в этой точке.
 *
 * Правила и языковые модели ошибаются КОМПЛЕМЕНТАРНО. По данным OpenSanctions
 * Pairs (arXiv 2603.11051, февраль 2026; 755 540 размеченных пар из 293
 * источников) продакшн-правила дают 91.33% F1 с перевесом ложноположительных —
 * они переобъединяют; модели доходят до 98.95%, но валятся на кросс-скриптовой
 * транслитерации и мелких расхождениях идентификаторов и дат.
 *
 * Отсюда конструкция:
 *   — нормализация идёт ПЕРВОЙ и снимает ровно то, на чём слаба модель
 *     (транслитерация ГОСТ 7.79, приведение идентификаторов и дат);
 *   — модель применяется ТОЛЬКО к зоне неопределённости, то есть туда,
 *     где живут ложноположительные правил;
 *   — вклад измеряется против зафиксированной базовой линии, а не «на глаз».
 */

import type { MatchDecision, NormalizedRecord, SourceRecordId } from '@catalog/domain';
import type { Scored } from './fellegi-sunter.ts';

/** Пара, попавшая в зону неопределённости, вместе с разбором весов. */
export interface AdjudicationRequest {
  readonly left: NormalizedRecord;
  readonly right: NormalizedRecord;
  readonly scored: Scored;
}

/**
 * Вердикт. Форма намеренно узкая: `isMatch` — логическое значение,
 * `discriminatingField` — имя поля или null. Из такой схемы нельзя выйти,
 * и это первая линия защиты от инъекции через содержимое товара.
 */
export interface Verdict {
  readonly isMatch: boolean;
  readonly confidence: number;
  readonly discriminatingField: string | null;
  readonly reasoning: string;
}

export interface AdjudicatorPort {
  readonly name: string;
  /**
   * Разбирает пачку пар. Пачкой, а не по одной: у арбитра на языковой модели
   * это позволяет уйти в Batch API и кэширование промпта.
   */
  adjudicate(requests: readonly AdjudicationRequest[]): Promise<ReadonlyMap<string, Verdict>>;
}

export const requestKey = (left: SourceRecordId, right: SourceRecordId): string =>
  left < right ? `${left}|${right}` : `${right}|${left}`;

/**
 * Арбитр по умолчанию: не решает ничего.
 *
 * Это не заглушка «чтобы компилировалось», а рабочий режим. Без ключа к модели
 * конвейер обязан отработать целиком, отправив зону неопределённости в очередь
 * ручного разбора. Он же используется в детерминированных тестах и в замере
 * базовой линии — иначе вклад модели не с чем сравнивать.
 */
export class NoopAdjudicator implements AdjudicatorPort {
  readonly name = 'noop';
  async adjudicate(): Promise<ReadonlyMap<string, Verdict>> {
    return new Map();
  }
}

/** Применяет вердикты к решениям: то, что арбитр не тронул, остаётся как было. */
export const applyVerdicts = (
  decisions: readonly MatchDecision[],
  verdicts: ReadonlyMap<string, Verdict>,
): readonly MatchDecision[] =>
  decisions.map((d) => {
    const verdict = verdicts.get(requestKey(d.leftId, d.rightId));
    if (verdict === undefined) return d;
    return {
      ...d,
      zone: verdict.isMatch ? ('match' as const) : ('non_match' as const),
      decidedBy: 'adjudicator' as const,
      adjudication: verdict,
    };
  });
