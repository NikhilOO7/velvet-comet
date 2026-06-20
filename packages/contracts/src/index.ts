/**
 * Single source of truth for Velvet Comet's data shapes (PLAN.md §11).
 * Zod schemas define the contract; TS types are inferred, never hand-written.
 * Shared across core, adapters, api, cli, mcp, and web.
 */
import { z } from 'zod';

/** Query intent — drives the rerank strategy (customer #5). */
export const Intent = z.enum(['news', 'research', 'buying', 'general']);
export type Intent = z.infer<typeof Intent>;

/**
 * Coverage profile — the hot/cold lever (PLAN.md §4a). `fast` caps rounds for
 * interactive use; `high` runs the saturation loop to exhaustion for batch.
 */
export const CoverageProfile = z.enum(['fast', 'standard', 'high']);
export type CoverageProfile = z.infer<typeof CoverageProfile>;

/**
 * Classification of a result's source. The long tail (`trade`/`forum`/
 * `regional`) is exactly what customer #1 says raising `limit` never surfaces.
 */
export const SourceClass = z.enum([
  'web',
  'news',
  'trade',
  'forum',
  'regional',
  'research',
  'other',
]);
export type SourceClass = z.infer<typeof SourceClass>;

export const JobStatus = z.enum([
  'queued',
  'expanding',
  'fanning_out',
  'merging',
  'reranking',
  'done',
  'partial',
  'failed',
]);
export type JobStatus = z.infer<typeof JobStatus>;

/** A research request — the API/CLI/MCP entry shape. */
export const ResearchRequest = z.object({
  query: z.string().min(1).max(2000),
  intent: Intent.default('general'),
  coverage: CoverageProfile.default('standard'),
  /** Hard ceiling on saturation rounds; the controller may stop earlier. */
  maxRounds: z.number().int().min(1).max(20).optional(),
  /** Diversity quota: max results kept per domain so SEO heads can't dominate. */
  perDomainCap: z.number().int().min(1).max(50).optional(),
  /** Stop spending once this many Firecrawl credits are consumed. */
  creditBudget: z.number().int().positive().optional(),
  /** Caller-supplied key for exactly-once submission (PLAN.md §6a). */
  idempotencyKey: z.string().min(8).max(128).optional(),
  /** Scrape full content for the top-ranked results (composes /search + /scrape). */
  deepen: z.boolean().default(false),
});
export type ResearchRequest = z.infer<typeof ResearchRequest>;

/** A raw result before scoring. */
export const SearchResultItem = z.object({
  url: z.string().url(),
  domain: z.string(),
  title: z.string(),
  snippet: z.string(),
  sourceClass: SourceClass,
  /** ISO-8601 publish date when known (drives freshness for `news`). */
  publishedAt: z.string().datetime().optional(),
  /** Stable near-duplicate fingerprint of the content (PLAN.md §6a). */
  contentHash: z.string(),
  /** Sub-query/round that surfaced this item (provenance for the report). */
  foundInRound: z.number().int().min(1),
});
export type SearchResultItem = z.infer<typeof SearchResultItem>;

/** A scored, ranked result with transparent per-signal contributions. */
export const RankedResult = SearchResultItem.extend({
  score: z.number(),
  rank: z.number().int().min(1),
  signals: z.record(z.string(), z.number()),
  /** Markdown excerpt from scraping this result (present when deepened). */
  content: z.string().optional(),
  /** True when full content was scraped for this result. */
  deepened: z.boolean().optional(),
});
export type RankedResult = z.infer<typeof RankedResult>;

/** One point on the saturation curve — the §14 hero visual. */
export const SaturationPoint = z.object({
  round: z.number().int().min(1),
  newDomains: z.number().int().min(0),
  cumulativeDomains: z.number().int().min(0),
});
export type SaturationPoint = z.infer<typeof SaturationPoint>;

/** A coverage gap we honestly could not fill (partial-success, not fake-green). */
export const CoverageGap = z.object({
  sourceClass: SourceClass,
  reason: z.string(),
});
export type CoverageGap = z.infer<typeof CoverageGap>;

/** The trust artifact: what we covered, what we missed, and what it cost. */
export const CoverageReport = z.object({
  rounds: z.number().int().min(0),
  domainsSeen: z.number().int().min(0),
  sourceClassesHit: z.array(SourceClass),
  sourceClassesMissed: z.array(SourceClass),
  saturationCurve: z.array(SaturationPoint),
  gaps: z.array(CoverageGap),
  creditsSpent: z.number().min(0),
  /** True when the loop reached saturation rather than hitting a cap/budget. */
  saturated: z.boolean(),
  stoppedReason: z.enum(['saturated', 'max_rounds', 'credit_budget', 'error']),
});
export type CoverageReport = z.infer<typeof CoverageReport>;

/** The full outcome returned to callers and rendered by the console. */
export const ResearchOutcome = z.object({
  status: JobStatus,
  query: z.string(),
  intent: Intent,
  results: z.array(RankedResult),
  coverage: CoverageReport,
});
export type ResearchOutcome = z.infer<typeof ResearchOutcome>;
