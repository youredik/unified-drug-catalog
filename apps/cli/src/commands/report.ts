/**
 * `pnpm report` — отчёт качества по прогону.
 *
 * Способ проверки корректности, который работает не на фикстурах, а на тех
 * данных, что пришли сегодня: распределение флагов качества, содержимое
 * карантина с причинами, статистика по зонам матчинга и зафиксированные
 * расхождения.
 */

import { buildReport, renderReport } from '@catalog/pipeline';
import type { CliOptions } from '../context.ts';
import { snapshotFor } from './export.ts';

export const runReport = async (options: CliOptions): Promise<void> => {
  const snapshot = await snapshotFor(options);
  console.log(renderReport(buildReport(snapshot)));
};
