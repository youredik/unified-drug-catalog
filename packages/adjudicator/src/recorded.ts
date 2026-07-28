/**
 * Арбитр, воспроизводящий записанные вердикты.
 *
 * Зачем он нужен: прогон против живой модели недетерминирован и требует ключа,
 * а тесты должны быть воспроизводимы и работать в CI без секретов. Поэтому
 * настоящий прогон один раз записывается в фикстуру, а дальше замер вклада
 * повторяется побайтово одинаково.
 *
 * Это НЕ подделка результата: фикстура содержит реальные ответы модели с их
 * обоснованиями, и её видно в репозитории. Пустая фикстура означает, что
 * замер ещё не проводился, — и отчёт честно скажет именно это, а не покажет
 * выдуманные цифры.
 */

import { requestKey, type AdjudicationRequest, type AdjudicatorPort, type Verdict } from '@catalog/match';

export interface RecordedVerdicts {
  readonly model: string;
  readonly recordedAt: string;
  readonly verdicts: Readonly<Record<string, Verdict>>;
}

export class RecordedAdjudicator implements AdjudicatorPort {
  readonly name: string;
  private readonly verdicts: Readonly<Record<string, Verdict>>;

  constructor(recorded: RecordedVerdicts) {
    this.name = `recorded:${recorded.model}`;
    this.verdicts = recorded.verdicts;
  }

  async adjudicate(requests: readonly AdjudicationRequest[]): Promise<ReadonlyMap<string, Verdict>> {
    const out = new Map<string, Verdict>();
    for (const r of requests) {
      const key = requestKey(r.left.id, r.right.id);
      const verdict = this.verdicts[key];
      // Пары без записанного вердикта остаются неразобранными — так отсутствие
      // данных видно в метриках, а не маскируется значением по умолчанию.
      if (verdict !== undefined) out.set(key, verdict);
    }
    return out;
  }
}
