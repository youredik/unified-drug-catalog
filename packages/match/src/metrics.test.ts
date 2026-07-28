import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, scorePair } from './fellegi-sunter.ts';
import { CONFLICT_CASES, GROUND_TRUTH } from './ground-truth.ts';
import { bestByF1, evaluate, sweepThresholds } from './metrics.ts';

describe('качество матчинга на размеченном наборе', () => {
  it('зазор между классами узкий — порогу нельзя доверять как единственному решению', () => {
    // Разделяющий порог на этом наборе существует, но щель между худшим
    // положительным и лучшим отрицательным крайне узка. Подобрать его по
    // дюжине пар и объявить пригодным для прода — переобучение: на реальных
    // объёмах классы почти наверняка сомкнутся. Отсюда третья зона.
    const pos = GROUND_TRUTH.filter((p) => p.isMatch).map((p) => scorePair(p.left, p.right).totalWeight);
    const neg = GROUND_TRUTH.filter((p) => !p.isMatch).map((p) => scorePair(p.left, p.right).totalWeight);
    const worstPositive = Math.min(...pos);
    const bestNegative = Math.max(...neg);
    const margin = worstPositive - bestNegative;
    console.log(
      `\n  положительные: ${worstPositive.toFixed(2)} … ${Math.max(...pos).toFixed(2)}\n` +
      `  отрицательные: ${Math.min(...neg).toFixed(2)} … ${bestNegative.toFixed(2)}\n` +
      `  зазор между классами: ${margin.toFixed(2)} в log2 ` +
      `(множитель ${(2 ** margin).toFixed(2)} по шансам) — на ${GROUND_TRUTH.length} парах`,
    );
    expect(margin).toBeGreaterThan(0);   // разделение есть
    expect(margin).toBeLessThan(2);      // но настолько узкое, что одним порогом обойтись нельзя
  });

  it('БАЗОВАЯ ЛИНИЯ: правила не ошибаются, но часть пар оставляют неопределёнными', () => {
    const { metrics, failures } = evaluate(GROUND_TRUTH, DEFAULT_CONFIG);
    console.log(
      `\n  базовая линия (слои 0-2, арбитр выключен):\n` +
      `    пар ${metrics.total}   precision ${metrics.precision.toFixed(3)}   ` +
      `recall ${metrics.recall.toFixed(3)}   F1 ${metrics.f1.toFixed(3)}\n` +
      `    TP ${metrics.truePositive}  FP ${metrics.falsePositive}  TN ${metrics.trueNegative}  ` +
      `FN ${metrics.falseNegative}  НЕОПРЕДЕЛЁННЫХ ${metrics.undecided}`,
    );
    // Планка порогов выбрана так, чтобы ошибок не было вовсе.
    expect(failures).toHaveLength(0);
    expect(metrics.falsePositive).toBe(0);
    expect(metrics.falseNegative).toBe(0);
    // Ценой этого остаётся зона неопределённости — работа для арбитра.
    expect(metrics.undecided).toBeGreaterThan(0);
  });

  it('свип по порогам показывает цену каждой планки', () => {
    const points = sweepThresholds(GROUND_TRUTH);
    console.log(
      '\n  свип по порогам:\n' +
      points.map((p) =>
        `    upper ${String(p.upper).padStart(2)} / lower ${String(p.lower).padStart(3)}  ` +
        `P ${p.metrics.precision.toFixed(3)}  R ${p.metrics.recall.toFixed(3)}  ` +
        `F1 ${p.metrics.f1.toFixed(3)}  неопр. ${p.metrics.undecided}`,
      ).join('\n'),
    );
    // Низкий порог даёт ложноположительные — известная слабость правил.
    const low = points.find((p) => p.upper === 4)!;
    expect(low.metrics.falsePositive).toBeGreaterThan(0);
    expect(bestByF1(points)).toBeDefined();
  });

  it('конфликт по идентификатору уходит в разбор, а не в склейку', () => {
    const { rows } = evaluate(CONFLICT_CASES);
    for (const r of rows) expect(r.zone).toBe('possible');
  });
});
