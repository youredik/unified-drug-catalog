/**
 * Адаптер арбитра на Claude Opus 5.
 *
 * Это ЕДИНСТВЕННОЕ место в решении, где вызывается языковая модель, и она
 * здесь спроектирована как компонент, а не как магия:
 *
 *   — работает только по зоне неопределённости, а не по всем парам;
 *   — вывод ограничен схемой (structured outputs), парсить нечего;
 *   — системный промпт кэшируется: он неизменен, чтения кэша стоят около
 *     десятой доли базовой цены;
 *   — нет инструментов и побочных эффектов — см. модель угроз в prompt.ts;
 *   — отказ модели (`stop_reason: refusal`) обрабатывается ДО чтения ответа;
 *   — вклад измеряется против зафиксированной базовой линии, а не «на глаз».
 *
 * Отсутствие ключа — не ошибка, а штатный режим: конвейер отрабатывает
 * с `NoopAdjudicator`, отправляя спорное в ручной разбор.
 */

import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { requestKey, type AdjudicationRequest, type AdjudicatorPort, type Verdict } from '@catalog/match';
import { buildUserMessage, SYSTEM_PROMPT, verdictSchema } from './prompt.ts';

export interface ClaudeAdjudicatorOptions {
  readonly apiKey?: string;
  /** Модель по умолчанию — самая способная из доступных на задаче суждения. */
  readonly model?: string;
  readonly effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  readonly maxConcurrency?: number;
  /** Куда писать сырые вердикты для воспроизводимого прогона тестов. */
  readonly onVerdict?: (key: string, verdict: Verdict, usage: TokenUsage) => void;
}

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}

export const hasCredentials = (): boolean =>
  Boolean(process.env['ANTHROPIC_API_KEY'] ?? process.env['ANTHROPIC_AUTH_TOKEN']);

export class ClaudeAdjudicator implements AdjudicatorPort {
  readonly name = 'claude-opus-5';

  private readonly client: Anthropic;
  private readonly model: string;
  private readonly effort: NonNullable<ClaudeAdjudicatorOptions['effort']>;
  private readonly maxConcurrency: number;
  private readonly onVerdict: ClaudeAdjudicatorOptions['onVerdict'];

  private totals: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

  constructor(options: ClaudeAdjudicatorOptions = {}) {
    this.client = new Anthropic(
      options.apiKey === undefined ? {} : { apiKey: options.apiKey },
    );
    this.model = options.model ?? 'claude-opus-5';
    this.effort = options.effort ?? 'high';
    this.maxConcurrency = options.maxConcurrency ?? 4;
    this.onVerdict = options.onVerdict;
  }

  get usage(): TokenUsage {
    return this.totals;
  }

  async adjudicate(requests: readonly AdjudicationRequest[]): Promise<ReadonlyMap<string, Verdict>> {
    const out = new Map<string, Verdict>();
    // Пары независимы, поэтому идут пачками с ограничением параллелизма.
    for (let i = 0; i < requests.length; i += this.maxConcurrency) {
      const slice = requests.slice(i, i + this.maxConcurrency);
      const settled = await Promise.all(slice.map(async (r) => [r, await this.judge(r)] as const));
      for (const [req, verdict] of settled) {
        if (verdict !== undefined) out.set(requestKey(req.left.id, req.right.id), verdict);
      }
    }
    return out;
  }

  private async judge(req: AdjudicationRequest): Promise<Verdict | undefined> {
    const message = await this.client.beta.messages.parse({
      model: this.model,
      max_tokens: 2048,
      // Кэшируется системный промпт: он одинаков для всех пар прогона.
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      thinking: { type: 'adaptive' },
      output_config: { effort: this.effort },
      output_format: betaZodOutputFormat(verdictSchema),
      messages: [{ role: 'user', content: buildUserMessage(req) }],
    });

    const usage: TokenUsage = {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
    };
    this.totals = {
      inputTokens: this.totals.inputTokens + usage.inputTokens,
      outputTokens: this.totals.outputTokens + usage.outputTokens,
      cacheReadTokens: this.totals.cacheReadTokens + usage.cacheReadTokens,
      cacheWriteTokens: this.totals.cacheWriteTokens + usage.cacheWriteTokens,
    };

    // Отказ проверяется ДО чтения содержимого: на отказе `parsed` пуст,
    // и обращение к нему без проверки уронило бы весь прогон.
    if (message.stop_reason === 'refusal') return undefined;
    const parsed = message.parsed_output;
    if (parsed === null || parsed === undefined) return undefined;

    const verdict: Verdict = {
      isMatch: parsed.isMatch,
      confidence: parsed.confidence,
      discriminatingField: parsed.discriminatingField,
      reasoning: parsed.reasoning,
    };
    this.onVerdict?.(requestKey(req.left.id, req.right.id), verdict, usage);
    return verdict;
  }
}
