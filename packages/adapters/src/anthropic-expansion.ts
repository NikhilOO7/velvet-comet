/**
 * Production ExpansionPort backed by Claude (PLAN.md §5a — the LLM lives only
 * at this leaf, structured in/out, no tool access). Asks for K angled
 * sub-queries as strict JSON; any parse/transport failure degrades to an
 * EXPANSION_FAILED in the shared taxonomy so the engine can fall back.
 */
import { z } from 'zod';
import type { Intent, SourceClass } from '@velvet-comet/contracts';
import { SourceClass as SourceClassSchema } from '@velvet-comet/contracts';
import {
  type ExpansionPort,
  type SubQuery,
  type Result,
  type EngineError,
  type Logger,
  ok,
  err,
  engineError,
} from '@velvet-comet/core';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-6';

const SubQueriesSchema = z.object({
  subQueries: z.array(z.object({ text: z.string().min(1), targetClass: SourceClassSchema })).min(1),
});

const MessagesResponse = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
});

export interface AnthropicExpansionDeps {
  readonly apiKey: string;
  readonly logger: Logger;
  readonly model?: string;
  readonly fetchFn?: typeof fetch;
}

export class AnthropicExpansion implements ExpansionPort {
  private readonly fetchFn: typeof fetch;
  private readonly model: string;

  constructor(private readonly deps: AnthropicExpansionDeps) {
    this.fetchFn = deps.fetchFn ?? fetch;
    this.model = deps.model ?? DEFAULT_MODEL;
  }

  async expand(input: {
    query: string;
    intent: Intent;
    missingClasses: readonly SourceClass[];
    count: number;
  }): Promise<Result<readonly SubQuery[], EngineError>> {
    try {
      const res = await this.fetchFn(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.deps.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 1024,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: this.userPrompt(input) }],
        }),
      });
      if (!res.ok) {
        return err(engineError('EXPANSION_FAILED', `anthropic ${res.status}`));
      }
      const json: unknown = await res.json();
      const parsed = MessagesResponse.safeParse(json);
      if (!parsed.success) return err(engineError('EXPANSION_FAILED', 'unexpected anthropic shape'));
      const text = parsed.data.content.find((c) => c.type === 'text')?.text ?? '';
      const subs = SubQueriesSchema.safeParse(extractJson(text));
      if (!subs.success) return err(engineError('EXPANSION_FAILED', 'could not parse sub-queries'));
      return ok(subs.data.subQueries.slice(0, input.count));
    } catch (cause) {
      this.deps.logger.warn('anthropic expansion failed', { cause: String(cause) });
      return err(engineError('EXPANSION_FAILED', 'anthropic request failed', { cause }));
    }
  }

  private userPrompt(input: {
    query: string;
    intent: Intent;
    missingClasses: readonly SourceClass[];
    count: number;
  }): string {
    return [
      `Query: ${input.query}`,
      `Intent: ${input.intent}`,
      `Generate ${input.count} angled sub-queries that maximize SOURCE DIVERSITY.`,
      input.missingClasses.length > 0
        ? `Prioritize reaching these still-missing source classes: ${input.missingClasses.join(', ')}.`
        : 'Vary phrasing, facets, and source-targeting operators.',
      'Respond ONLY with JSON: {"subQueries":[{"text":"...","targetClass":"..."}]}.',
      'targetClass must be one of: web, news, trade, forum, regional, research, other.',
    ].join('\n');
  }
}

const SYSTEM_PROMPT =
  'You expand a research query into diverse sub-queries that surface sources a ' +
  'single SEO-optimized search would miss: trade publications, regional press, ' +
  'niche forums, primary research. Output strict JSON only, no prose.';

/** Extract the first JSON object from model text (tolerates code fences). */
function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}
