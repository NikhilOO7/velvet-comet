/**
 * Deterministic, offline ExpansionPort. No LLM — used as a fallback and in
 * tests so the engine runs without an API key. The Anthropic adapter is the
 * production path (PLAN.md §5a keeps the LLM at this leaf only).
 *
 * Encodes the core completeness idea: don't fetch more of the same head, fetch
 * different *angles* — paraphrases plus source-class-targeting operators that
 * reach the trade/forum/regional long tail (customer #1).
 */
import type { Intent, SourceClass } from '@velvet-comet/contracts';
import { type ExpansionPort, type SubQuery, type Result, ok } from '@velvet-comet/core';
import type { EngineError } from '@velvet-comet/core';

const CLASS_OPERATORS: Record<SourceClass, (q: string) => string> = {
  web: (q) => q,
  news: (q) => `${q} latest news`,
  trade: (q) => `${q} trade publication industry report`,
  forum: (q) => `${q} forum discussion community`,
  regional: (q) => `${q} regional local coverage`,
  research: (q) => `${q} research paper analysis`,
  other: (q) => `${q} overview`,
};

const INTENT_ANGLE: Record<Intent, string> = {
  news: 'recent developments',
  research: 'in-depth analysis',
  buying: 'comparison and alternatives',
  general: 'comprehensive overview',
};

export class HeuristicExpansion implements ExpansionPort {
  expand(input: {
    query: string;
    intent: Intent;
    missingClasses: readonly SourceClass[];
    count: number;
  }): Promise<Result<readonly SubQuery[], EngineError>> {
    const subs: SubQuery[] = [];

    // First, target the classes we're still missing — this is what makes later
    // rounds reach sources the head never surfaces.
    for (const cls of input.missingClasses) {
      if (subs.length >= input.count) break;
      subs.push({ text: CLASS_OPERATORS[cls](input.query), targetClass: cls });
    }

    // Then fill remaining slots with intent-angled paraphrases.
    const fillers = [
      `${input.query} ${INTENT_ANGLE[input.intent]}`,
      `${input.query} explained`,
      `${input.query} key players`,
      `${input.query} ${input.intent} guide`,
    ];
    let f = 0;
    while (subs.length < input.count) {
      subs.push({ text: fillers[f % fillers.length] ?? input.query, targetClass: 'web' });
      f++;
    }

    return Promise.resolve(ok(subs.slice(0, input.count)));
  }
}
