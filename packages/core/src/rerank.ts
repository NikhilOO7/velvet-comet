/**
 * Intent-aware reranking (customer #5, PLAN.md §3 step ⑤) via the Strategy
 * pattern. Each strategy is a pure scorer returning a score plus transparent
 * per-signal contributions, so the console can explain *why* a result ranked.
 */
import type { Intent, RankedResult, SearchResultItem } from '@velvet-comet/contracts';
import { domainOf, tokenize } from './text.js';

export interface Reranker {
  /** Score in [0, 1]; higher is better. `signals` must sum-explain the score. */
  score(item: SearchResultItem, now: number): { score: number; signals: Record<string, number> };
}

const DAY_MS = 86_400_000;

/** Freshness-weighted: recent items win. For `news`. */
const newsReranker: Reranker = {
  score(item, now) {
    const ageDays = item.publishedAt
      ? Math.max(0, (now - Date.parse(item.publishedAt)) / DAY_MS)
      : 365;
    // Exponential decay with a ~14-day half-life.
    const freshness = Math.pow(0.5, ageDays / 14);
    const sourceBoost = item.sourceClass === 'news' ? 0.15 : 0;
    return { score: clamp(freshness + sourceBoost), signals: { freshness, sourceBoost } };
  },
};

// A small, transparent authority table. Real impl would back this with a
// maintained domain-authority dataset behind the same seam.
const HIGH_AUTHORITY = new Set(['nature.com', 'arxiv.org', 'springer.com', 'acm.org', 'ieee.org']);

/** Domain-credibility weighted. For `research`. */
const researchReranker: Reranker = {
  score(item) {
    const domain = domainOf(item.url);
    const authority =
      HIGH_AUTHORITY.has(domain) || domain.endsWith('.edu')
        ? 1
        : item.sourceClass === 'research'
          ? 0.7
          : item.sourceClass === 'trade'
            ? 0.5
            : 0.3;
    return { score: clamp(authority), signals: { authority } };
  },
};

const COMPARISON_TERMS = ['vs', 'versus', 'compare', 'comparison', 'best', 'review', 'alternative'];

/** Boosts pages that actually compare products. For `buying`. */
const buyingReranker: Reranker = {
  score(item) {
    const haystack = new Set(tokenize(`${item.title} ${item.snippet}`));
    const hits = COMPARISON_TERMS.filter((t) => haystack.has(t)).length;
    const comparison = clamp(hits / 3);
    const commercial = item.sourceClass === 'web' ? 0.2 : 0;
    return { score: clamp(comparison + commercial), signals: { comparison, commercial } };
  },
};

/** Neutral diversity-preserving baseline. For `general`. */
const generalReranker: Reranker = {
  score(item) {
    // Mild bonus for non-head source classes to keep the long tail visible.
    const longTail = item.sourceClass === 'web' || item.sourceClass === 'news' ? 0 : 0.1;
    return { score: clamp(0.5 + longTail), signals: { base: 0.5, longTail } };
  },
};

const STRATEGIES: Record<Intent, Reranker> = {
  news: newsReranker,
  research: researchReranker,
  buying: buyingReranker,
  general: generalReranker,
};

export function rerankerFor(intent: Intent): Reranker {
  return STRATEGIES[intent] ?? STRATEGIES.general;
}

/** Weight of query-relevance vs. the intent signal in the final score. */
const RELEVANCE_WEIGHT = 0.5;

/**
 * Query-relevance: fraction of query terms the result addresses (title +
 * snippet). A cheap, deterministic proxy for semantic relevance — the seam where
 * an embedding/LLM scorer drops in later (PLAN.md §15 #1). Keeps completeness
 * from costing precision: more sources, still on-topic.
 */
export function lexicalRelevance(queryTokens: ReadonlySet<string>, item: SearchResultItem): number {
  if (queryTokens.size === 0) return 0;
  const docTokens = new Set(tokenize(`${item.title} ${item.snippet}`));
  let overlap = 0;
  for (const t of queryTokens) if (docTokens.has(t)) overlap++;
  return overlap / queryTokens.size;
}

/**
 * Rank by `relevance × intent`. Each result's final score blends how well it
 * matches the query with the intent-specific signal; `signals` exposes both so
 * the console can explain the ranking. Stable (ties broken by URL).
 */
export function rerank(
  items: readonly SearchResultItem[],
  query: string,
  intent: Intent,
  now: number,
): RankedResult[] {
  const reranker = rerankerFor(intent);
  const queryTokens = new Set(tokenize(query));
  return items
    .map((item) => {
      const intentScore = reranker.score(item, now);
      const relevance = lexicalRelevance(queryTokens, item);
      const score = clamp(RELEVANCE_WEIGHT * relevance + (1 - RELEVANCE_WEIGHT) * intentScore.score);
      return { item, score, signals: { ...intentScore.signals, relevance } };
    })
    .sort((a, b) => b.score - a.score || a.item.url.localeCompare(b.item.url))
    .map(({ item, score, signals }, i) => ({ ...item, score, signals, rank: i + 1 }));
}

function clamp(n: number): number {
  return Math.min(1, Math.max(0, n));
}
