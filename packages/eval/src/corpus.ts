/**
 * A controlled ground-truth corpus for measuring completeness (PLAN.md §15 #0).
 *
 * Each topic has a known universe of source domains. Head sources surface for
 * any query; long-tail sources are *gated* behind specific angle tokens (e.g.
 * "forum", "trade") — so a flat `/search` of the bare query can't reach them,
 * but the completeness engine, which expands into those angles and loops until
 * dry, can. That gap is exactly what we measure.
 */
import type { Intent, SearchResultItem, SourceClass } from '@velvet-comet/contracts';
import { type SearchPort, type Result, ok, simhash, tokenize } from '@velvet-comet/core';
import type { EngineError } from '@velvet-comet/core';

export interface EvalDoc {
  readonly domain: string;
  readonly sourceClass: SourceClass;
  /** Tokens that must appear in a (sub-)query for this doc to surface. */
  /** Empty ⇒ a "head" source that always appears. */
  readonly angles: readonly string[];
}

export interface EvalTopic {
  readonly id: string;
  readonly query: string;
  readonly intent: Intent;
  readonly groundTruth: readonly EvalDoc[];
}

/** A SearchPort backed by one topic's ground-truth universe. Deterministic. */
export class FixtureSearch implements SearchPort {
  constructor(private readonly topic: EvalTopic) {}

  search(input: {
    query: string;
    limit: number;
    round: number;
  }): Promise<Result<readonly SearchResultItem[], EngineError>> {
    const queryTokens = new Set(tokenize(input.query));
    const matched = this.topic.groundTruth.filter(
      (doc) => doc.angles.length === 0 || doc.angles.some((a) => queryTokens.has(a)),
    );
    const items = matched
      .slice(0, input.limit)
      .map((doc) => toItem(doc, input.query, input.round));
    return Promise.resolve(ok(items));
  }
}

function toItem(doc: EvalDoc, query: string, round: number): SearchResultItem {
  const title = `${query} — ${doc.domain}`;
  return {
    url: `https://${doc.domain}/article`,
    domain: doc.domain,
    title,
    snippet: `Coverage of ${query} from ${doc.domain}.`,
    sourceClass: doc.sourceClass,
    // Distinct per domain so the near-dup merge never collapses distinct sources.
    contentHash: simhash(Array(24).fill(slug(doc.domain)).join(' ')),
    foundInRound: round,
  };
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}
