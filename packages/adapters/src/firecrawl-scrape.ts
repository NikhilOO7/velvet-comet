/**
 * Firecrawl `/v2/scrape` as a core ScrapePort — the second composed capability
 * (PLAN.md §3, §15 #11). Reuses the same chokepoint discipline as search: rate
 * limiter + concurrency semaphore + retry + circuit breaker + cost ledger.
 * Requests markdown only (`onlyMainContent`) for the deepen excerpt.
 */
import { z } from 'zod';
import {
  type EngineError,
  type Logger,
  type Result,
  type ScrapePort,
  engineError,
  err,
  ok,
} from '@velvet-comet/core';
import type { RateLimiter, ConcurrencyLimiter } from './rate-limit.js';
import type { CircuitBreaker } from './circuit-breaker.js';
import type { CostLedger } from './cost-ledger.js';
import { withRetry } from './retry.js';

const ScrapeResponse = z.object({
  success: z.boolean().optional(),
  data: z.object({ markdown: z.string().default('') }),
});

const BREAKER_KEY = 'firecrawl:scrape';
const SCRAPE_CREDITS = 1;

export interface FirecrawlScrapeDeps {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly rateLimiter: RateLimiter;
  readonly concurrency: ConcurrencyLimiter;
  readonly breaker: CircuitBreaker;
  readonly ledger: CostLedger;
  readonly logger: Logger;
  readonly fetchFn?: typeof fetch;
  readonly now?: () => number;
  readonly retry?: { retries: number; baseMs: number; maxMs: number };
}

export class FirecrawlScrape implements ScrapePort {
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly retryCfg: { retries: number; baseMs: number; maxMs: number };

  constructor(private readonly deps: FirecrawlScrapeDeps) {
    this.fetchFn = deps.fetchFn ?? fetch;
    this.now = deps.now ?? ((): number => Date.now());
    this.retryCfg = deps.retry ?? { retries: 2, baseMs: 250, maxMs: 4000 };
  }

  async scrape(url: string): Promise<Result<{ markdown: string }, EngineError>> {
    if (!this.deps.breaker.canPass(BREAKER_KEY)) {
      return err(engineError('UPSTREAM_UNAVAILABLE', 'circuit open for firecrawl scrape'));
    }

    let retries = 0;
    const startedAt = this.now();
    const result = await withRetry<{ markdown: string }>(() => this.doFetch(url), {
      ...this.retryCfg,
      onRetry: (attempt, e) => {
        retries = attempt;
        this.deps.logger.warn('retrying firecrawl scrape', { attempt, code: e.code });
      },
    });

    const success = result.ok;
    this.deps.breaker.record(BREAKER_KEY, success);
    this.deps.ledger.record({
      endpoint: '/v2/scrape',
      status: success ? 'ok' : 'error',
      credits: success ? SCRAPE_CREDITS : 0,
      latencyMs: this.now() - startedAt,
      retries,
    });
    return result;
  }

  private async doFetch(url: string): Promise<Result<{ markdown: string }, EngineError>> {
    await this.deps.rateLimiter.acquire();
    const lease = await this.deps.concurrency.acquire();
    try {
      const res = await this.fetchFn(`${this.deps.baseUrl}/v2/scrape`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.deps.apiKey}` },
        body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true }),
      });
      if (!res.ok) return err(mapHttpError(res.status));
      const json: unknown = await res.json();
      const parsed = ScrapeResponse.safeParse(json);
      if (!parsed.success) return err(engineError('INTERNAL', 'unexpected firecrawl scrape shape'));
      return ok({ markdown: parsed.data.data.markdown });
    } catch (cause) {
      return err(engineError('UPSTREAM_UNAVAILABLE', 'firecrawl scrape failed', { cause }));
    } finally {
      lease.release();
    }
  }
}

function mapHttpError(status: number): EngineError {
  if (status === 402) return engineError('CREDITS_EXHAUSTED', 'firecrawl credits exhausted (402)');
  if (status === 429) return engineError('RATE_LIMITED', 'firecrawl rate limited (429)');
  if (status === 408) return engineError('UPSTREAM_TIMEOUT', 'firecrawl scrape timeout (408)');
  if (status >= 500) return engineError('UPSTREAM_UNAVAILABLE', `firecrawl ${status}`);
  return engineError('UPSTREAM_REJECTED', `firecrawl rejected scrape (${status})`);
}
