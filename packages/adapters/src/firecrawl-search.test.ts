import { describe, it, expect } from 'vitest';
import { isErr, isOk } from '@velvet-comet/core';
import { FirecrawlSearch } from './firecrawl-search.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { CostLedger } from './cost-ledger.js';
import { InMemorySearchCache } from './search-cache.js';
import { createLogger } from './logger.js';
import type { RateLimiter, ConcurrencyLimiter, Lease } from './rate-limit.js';

const passLimiter: RateLimiter = { acquire: () => Promise.resolve() };
const passConcurrency: ConcurrencyLimiter = {
  acquire: (): Promise<Lease> => Promise.resolve({ release: () => undefined }),
};
const silentLogger = createLogger('test', () => undefined);

function build(fetchFn: typeof fetch): { search: FirecrawlSearch; ledger: CostLedger; breaker: CircuitBreaker } {
  const ledger = new CostLedger();
  const breaker = new CircuitBreaker();
  const search = new FirecrawlSearch({
    baseUrl: 'https://api.firecrawl.dev',
    apiKey: 'fc-test',
    rateLimiter: passLimiter,
    concurrency: passConcurrency,
    breaker,
    ledger,
    logger: silentLogger,
    fetchFn,
    retry: { retries: 2, baseMs: 0, maxMs: 0 },
  });
  return { search, ledger, breaker };
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('FirecrawlSearch', () => {
  it('maps the grouped web/news response and classifies sources', async () => {
    const fetchFn: typeof fetch = () =>
      Promise.resolve(
        jsonResponse({
          success: true,
          data: {
            web: [{ url: 'https://example.com/a', title: 'A', description: 'desc a' }],
            news: [{ url: 'https://reuters.com/b', title: 'B', description: 'desc b' }],
            images: [],
          },
        }),
      );
    const { search, ledger } = build(fetchFn);
    const r = await search.search({ query: 'q', limit: 10, round: 2 });
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value).toHaveLength(2);
    expect(r.value.map((i) => i.sourceClass).sort()).toEqual(['news', 'web']);
    expect(r.value.every((i) => i.foundInRound === 2)).toBe(true);
    expect(ledger.totalCredits()).toBe(1);
  });

  it('retries on 429 then succeeds', async () => {
    let calls = 0;
    const fetchFn: typeof fetch = () => {
      calls++;
      if (calls === 1) return Promise.resolve(jsonResponse({ error: 'rate limited' }, 429));
      return Promise.resolve(jsonResponse({ data: [{ url: 'https://x.com/1', title: 'X', description: '' }] }));
    };
    const { search } = build(fetchFn);
    const r = await search.search({ query: 'q', limit: 10, round: 1 });
    expect(isOk(r)).toBe(true);
    expect(calls).toBe(2);
  });

  it('maps a 4xx to a non-retryable rejection and records a breaker failure', async () => {
    let calls = 0;
    const fetchFn: typeof fetch = () => {
      calls++;
      return Promise.resolve(jsonResponse({ error: 'bad' }, 400));
    };
    const { search, ledger, breaker } = build(fetchFn);
    const r = await search.search({ query: 'q', limit: 10, round: 1 });
    expect(isErr(r)).toBe(true);
    if (!isErr(r)) return;
    expect(r.error.code).toBe('UPSTREAM_REJECTED');
    expect(r.error.retryable).toBe(false);
    expect(calls).toBe(1); // not retried
    expect(ledger.all()[0]?.status).toBe('error');
    expect(breaker.stateOf('firecrawl:search')).not.toBe('open'); // one failure < threshold
  });

  it('serves a repeat sub-query from cache: no second fetch, zero credits', async () => {
    let calls = 0;
    const fetchFn: typeof fetch = () => {
      calls++;
      return Promise.resolve(jsonResponse({ data: [{ url: 'https://x.com/1', title: 'X', description: 'd' }] }));
    };
    const ledger = new CostLedger();
    const search = new FirecrawlSearch({
      baseUrl: 'https://api.firecrawl.dev',
      apiKey: 'fc-test',
      rateLimiter: passLimiter,
      concurrency: passConcurrency,
      breaker: new CircuitBreaker(),
      ledger,
      logger: silentLogger,
      cache: new InMemorySearchCache(),
      fetchFn,
    });

    const first = await search.search({ query: ' Solar Storage ', limit: 10, round: 1 });
    // Same query, different casing/whitespace + a later round → cache hit.
    const second = await search.search({ query: 'solar storage', limit: 10, round: 3 });

    expect(isOk(first) && isOk(second)).toBe(true);
    expect(calls).toBe(1); // upstream hit exactly once
    expect(ledger.totalCredits()).toBe(1); // only the miss billed
    expect(ledger.cacheHits()).toBe(1);
    if (isOk(second)) expect(second.value[0]?.foundInRound).toBe(3); // re-stamped
  });
});
