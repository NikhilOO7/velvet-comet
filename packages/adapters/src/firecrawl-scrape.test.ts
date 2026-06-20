import { describe, it, expect } from 'vitest';
import { isErr, isOk } from '@velvet-comet/core';
import { FirecrawlScrape } from './firecrawl-scrape.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { CostLedger } from './cost-ledger.js';
import { createLogger } from './logger.js';
import type { RateLimiter, ConcurrencyLimiter, Lease } from './rate-limit.js';

const passLimiter: RateLimiter = { acquire: () => Promise.resolve() };
const passConcurrency: ConcurrencyLimiter = {
  acquire: (): Promise<Lease> => Promise.resolve({ release: () => undefined }),
};

function build(fetchFn: typeof fetch): { scrape: FirecrawlScrape; ledger: CostLedger } {
  const ledger = new CostLedger();
  const scrape = new FirecrawlScrape({
    baseUrl: 'https://api.firecrawl.dev',
    apiKey: 'fc-test',
    rateLimiter: passLimiter,
    concurrency: passConcurrency,
    breaker: new CircuitBreaker(),
    ledger,
    logger: createLogger('test', () => undefined),
    fetchFn,
    retry: { retries: 1, baseMs: 0, maxMs: 0 },
  });
  return { scrape, ledger };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('FirecrawlScrape', () => {
  it('returns markdown and bills a credit', async () => {
    const { scrape, ledger } = build(() => Promise.resolve(json({ data: { markdown: '# Hello\n\nbody' } })));
    const r = await scrape.scrape('https://x.com/a');
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.markdown).toContain('Hello');
    expect(ledger.totalCredits()).toBe(1);
  });

  it('maps a 4xx to a non-retryable rejection and bills nothing', async () => {
    let calls = 0;
    const { scrape, ledger } = build(() => {
      calls++;
      return Promise.resolve(json({ error: 'bad' }, 400));
    });
    const r = await scrape.scrape('https://x.com/a');
    expect(isErr(r)).toBe(true);
    if (!isErr(r)) return;
    expect(r.error.retryable).toBe(false);
    expect(calls).toBe(1);
    expect(ledger.totalCredits()).toBe(0);
  });
});
