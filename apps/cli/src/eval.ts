/**
 * Замер вклада арбитра: один и тот же размеченный набор прогоняется
 * с языковой моделью и без неё.
 *
 * Три режима, и выбор между ними явный:
 *
 *   есть ключ            → живой прогон Claude Opus 5, вердикты пишутся
 *                          в фикстуру для воспроизводимости;
 *   есть фикстура        → воспроизведение записанного прогона, без сети;
 *   ни того, ни другого  → отчёт честно говорит, что замер не проводился.
 *
 * Последний режим существует именно затем, чтобы в README не появились
 * цифры, которых никто не получал.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { GROUND_TRUTH, measureContribution, NoopAdjudicator, type AdjudicatorPort, type Verdict } from '@catalog/match';
import { ClaudeAdjudicator, hasCredentials, RecordedAdjudicator } from '@catalog/adjudicator';

const FIXTURE = new URL('../../../fixtures/adjudicator-verdicts.json', import.meta.url);

const pct = (n: number): string => (n * 100).toFixed(1).padStart(5) + '%';

export const runEval = async (record: boolean): Promise<void> => {
  const recorded: Verdict[] = [];
  const captured: Record<string, Verdict> = {};

  let adjudicator: AdjudicatorPort;
  let mode: string;

  if (hasCredentials()) {
    adjudicator = new ClaudeAdjudicator({
      onVerdict: (key, verdict) => { captured[key] = verdict; recorded.push(verdict); },
    });
    mode = 'живой прогон Claude Opus 5';
  } else {
    const raw = JSON.parse(await readFile(FIXTURE, 'utf8')) as {
      model: string; recordedAt: string | null; verdicts: Record<string, Verdict>;
    };
    const count = Object.keys(raw.verdicts).length;
    if (count === 0) {
      adjudicator = new NoopAdjudicator();
      mode = 'БЕЗ АРБИТРА — ключа нет, записанных вердиктов нет';
    } else {
      adjudicator = new RecordedAdjudicator({ ...raw, recordedAt: raw.recordedAt ?? '' });
      mode = `воспроизведение записи от ${raw.recordedAt} (${raw.model})`;
    }
  }

  const r = await measureContribution(GROUND_TRUTH, adjudicator);

  console.log(`\nЗАМЕР ВКЛАДА АРБИТРА`);
  console.log(`режим: ${mode}\n`);
  console.log(`                     precision   recall      F1    неопределённых`);
  console.log(`  базовая линия      ${pct(r.baseline.precision)}   ${pct(r.baseline.recall)}  ${pct(r.baseline.f1)}   ${String(r.baseline.undecided).padStart(6)}`);
  console.log(`  с арбитром         ${pct(r.withAdjudicator.precision)}   ${pct(r.withAdjudicator.recall)}  ${pct(r.withAdjudicator.f1)}   ${String(r.withAdjudicator.undecided).padStart(6)}`);
  console.log(`\n  пар в серой зоне: ${r.greyZoneSize}   разобрано: ${r.adjudicated}   верно: ${r.resolvedCorrectly}   неверно: ${r.resolvedIncorrectly}`);

  if (r.verdicts.length > 0) {
    console.log('\n  вердикты:');
    for (const v of r.verdicts) {
      console.log(`    ${v.correct ? '✓' : '✗'} ${v.pair}`);
      console.log(`       ожидалось ${v.expected ? 'ДА' : 'НЕТ'}, модель: ${v.verdict.isMatch ? 'ДА' : 'НЕТ'} (${v.verdict.confidence.toFixed(2)}), решило поле: ${v.verdict.discriminatingField ?? '—'}`);
      console.log(`       ${v.verdict.reasoning}`);
    }
  } else if (r.greyZoneSize > 0) {
    console.log('\n  Вердиктов нет: замер с моделью НЕ ПРОВОДИЛСЯ.');
    console.log('  Запустить: ANTHROPIC_API_KEY=... pnpm eval:record');
  }

  if (record && Object.keys(captured).length > 0) {
    await writeFile(FIXTURE, JSON.stringify({
      model: 'claude-opus-5',
      recordedAt: new Date().toISOString(),
      verdicts: captured,
    }, null, 2) + '\n');
    console.log(`\n  записано вердиктов: ${Object.keys(captured).length} → fixtures/adjudicator-verdicts.json`);
  }
};
