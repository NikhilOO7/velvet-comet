/**
 * The Firecrawl chokepoint as a core SearchPort (PLAN.md §4, §6a). Every call
 * flows through: circuit breaker → rate limiter → concurrency semaphore →
 * fetch → retry-on-retryable → parse → map. Errors land in the shared taxonomy;
 * cost is recorded to the ledger.
 *
 * Targets Firecrawl v2 `/v2/search` with no `scrapeOptions` — the fast,
 * SERP-only, ~1-credit path (we want breadth via expansion, not page content).
 */
import { z } from 'zod';
import type { SearchResultItem, SourceClass } from '@velvet-comet/contracts';
import {
  type EngineError,
  type Logger,
  type Result,
  type SearchPort,
  classifySource,
  engineError,
  err,
  ok,
  simhash,
} from '@velvet-comet/core';
import type { RateLimiter, ConcurrencyLimiter } from './rate-limit.js';
import type { CircuitBreaker } from './circuit-breaker.js';
import type { CostLedger } from './cost-ledger.js';
import { type SearchCache, cacheKey } from './search-cache.js';
import { withRetry } from './retry.js';

/**
 * The exact shape the adapter depends on. Exported so the live contract test
 * (PLAN.md §9) validates real Firecrawl responses against this same schema — a
 * drift or a hallucinated field fails loudly in CI, not in a nightly batch.
 */
export const FirecrawlRawItem = z.object({
  url: z.string().url(),
  title: z.string().default(''),
  description: z.string().default(''),
});
type RawItem = z.infer<typeof FirecrawlRawItem>;
/** RawItem plus internal provenance tag set during flattening. */
type TaggedItem = RawItem & { __news?: boolean };

export const FirecrawlSearchResponse = z.object({
  success: z.boolean().optional(),
  data: z.union([
    z.array(FirecrawlRawItem),
    z.object({
      web: z.array(FirecrawlRawItem).default([]),
      news: z.array(FirecrawlRawItem).default([]),
      images: z.array(FirecrawlRawItem).default([]),
    }),
  ]),
});

const BREAKER_KEY = 'firecrawl:search';
const SEARCH_CREDITS = 1;

export interface FirecrawlSearchDeps {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly rateLimiter: RateLimiter;
  readonly concurrency: ConcurrencyLimiter;
  readonly breaker: CircuitBreaker;
  readonly ledger: CostLedger;
  readonly logger: Logger;
  /** Optional response cache — skips the upstream call on repeat sub-queries. */
  readonly cache?: SearchCache;
  readonly fetchFn?: typeof fetch;
  readonly now?: () => number;
  readonly retry?: { retries: number; baseMs: number; maxMs: number };
}

export class FirecrawlSearch implements SearchPort {
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly retryCfg: { retries: number; baseMs: number; maxMs: number };

  constructor(private readonly deps: FirecrawlSearchDeps) {
    this.fetchFn = deps.fetchFn ?? fetch;
    this.now = deps.now ?? ((): number => Date.now());
    this.retryCfg = deps.retry ?? { retries: 3, baseMs: 250, maxMs: 4000 };
  }

  async search(input: {
    query: string;
    limit: number;
    round: number;
  }): Promise<Result<readonly SearchResultItem[], EngineError>> {
    // Cache check first — a hit is free and skips rate/concurrency entirely.
    const key = cacheKey(input.query, input.limit);
    if (this.deps.cache) {
      const hit = await this.deps.cache.get(key);
      if (hit) {
        this.deps.ledger.record({ endpoint: '/v2/search', status: 'ok', credits: 0, latencyMs: 0, retries: 0, cached: true });
        return ok(restamp(hit, input.round));
      }
    }

    if (!this.deps.breaker.canPass(BREAKER_KEY)) {
      return err(
        engineError('UPSTREAM_UNAVAILABLE', 'circuit open for firecrawl search', {
          context: { key: BREAKER_KEY },
        }),
      );
    }

    let retries = 0;
    const startedAt = this.now();
    const result = await withRetry<readonly TaggedItem[]>(() => this.doFetch(input), {
      ...this.retryCfg,
      onRetry: (attempt, error) => {
        retries = attempt;
        this.deps.logger.warn('retrying firecrawl search', { attempt, code: error.code });
      },
    });

    const success = result.ok;
    this.deps.breaker.record(BREAKER_KEY, success);
    this.deps.ledger.record({
      endpoint: '/v2/search',
      status: success ? 'ok' : 'error',
      credits: success ? SEARCH_CREDITS : 0,
      latencyMs: this.now() - startedAt,
      retries,
    });

    if (!result.ok) return result;
    const items = this.mapItems(result.value, input.round);
    if (this.deps.cache) await this.deps.cache.set(key, items);
    return ok(items);
  }

  /** One HTTP attempt, gated by the rate limiter + concurrency semaphore. */
  private async doFetch(input: {
    query: string;
    limit: number;
  }): Promise<Result<readonly TaggedItem[], EngineError>> {
    await this.deps.rateLimiter.acquire();
    const lease = await this.deps.concurrency.acquire();
    try {
      const res = await this.fetchFn(`${this.deps.baseUrl}/v2/search`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.deps.apiKey}`,
        },
        body: JSON.stringify({
          query: input.query,
          limit: input.limit,
          sources: [{ type: 'web' }, { type: 'news' }],
        }),
      });
      return await this.handleResponse(res);
    } catch (cause) {
      // Network-level failure / abort — treat as retryable upstream issue.
      return err(engineError('UPSTREAM_UNAVAILABLE', 'firecrawl request failed', { cause }));
    } finally {
      lease.release();
    }
  }

  private async handleResponse(res: Response): Promise<Result<readonly TaggedItem[], EngineError>> {
    if (!res.ok) return err(mapHttpError(res.status));
    let json: unknown;
    try {
      json = await res.json();
    } catch (cause) {
      return err(engineError('INTERNAL', 'firecrawl returned non-JSON', { cause }));
    }
    const parsed = FirecrawlSearchResponse.safeParse(json);
    if (!parsed.success) {
      return err(
        engineError('INTERNAL', 'unexpected firecrawl search shape', {
          context: { issues: parsed.error.issues.length },
        }),
      );
    }
    return ok(flatten(parsed.data.data));
  }

  private mapItems(raw: readonly TaggedItem[], round: number): SearchResultItem[] {
    return raw.map((item) => {
      const hinted: SourceClass | undefined = item.__news ? 'news' : undefined;
      return {
        url: item.url,
        domain: domainOf(item.url),
        title: item.title,
        snippet: item.description,
        sourceClass: classifySource(item.url, hinted),
        contentHash: simhash(`${item.title} ${item.description}`),
        foundInRound: round,
      };
    });
  }
}

/** Flatten either response shape into a flat list, tagging news provenance. */
function flatten(
  data: RawItem[] | { web: RawItem[]; news: RawItem[]; images: RawItem[] },
): TaggedItem[] {
  if (Array.isArray(data)) return [...data];
  return [...data.web, ...data.news.map((n) => ({ ...n, __news: true }))];
}

/** Re-stamp cached items with the current round so provenance stays accurate. */
function restamp(items: readonly SearchResultItem[], round: number): SearchResultItem[] {
  return items.map((i) => ({ ...i, foundInRound: round }));
}

function mapHttpError(status: number): EngineError {
  if (status === 402) return engineError('CREDITS_EXHAUSTED', 'firecrawl credits exhausted (402)');
  if (status === 429) return engineError('RATE_LIMITED', 'firecrawl rate limited (429)');
  if (status === 408) return engineError('UPSTREAM_TIMEOUT', 'firecrawl timeout (408)');
  if (status >= 500) return engineError('UPSTREAM_UNAVAILABLE', `firecrawl ${status}`);
  return engineError('UPSTREAM_REJECTED', `firecrawl rejected request (${status})`);
}

function domainOf(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch {
    return '';
  }
}
