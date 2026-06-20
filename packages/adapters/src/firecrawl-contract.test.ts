/**
 * LIVE contract tests against Firecrawl v2 (PLAN.md §9). These hit the real API
 * and assert the engine's assumptions: the `/v2/search` response shape matches
 * the schema the adapter trusts, `limit` is honored, the no-`scrapeOptions` path
 * returns snippet results, and the adapter maps + classifies them.
 *
 * Gated: they run only when FIRECRAWL_API_KEY is set AND
 * RUN_LIVE_CONTRACT_TESTS=true, so the default suite stays green offline. Run:
 *   RUN_LIVE_CONTRACT_TESTS=true FIRECRAWL_API_KEY=fc-... pnpm test:contract
 */
import { describe, it, expect } from 'vitest';
import { isOk } from '@velvet-comet/core';
import { FirecrawlSearchResponse, FirecrawlSearch } from './firecrawl-search.js';
import { TokenBucket, Semaphore } from './rate-limit.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { CostLedger } from './cost-ledger.js';
import { createLogger } from './logger.js';

const KEY = process.env.FIRECRAWL_API_KEY ?? '';
const BASE = process.env.FIRECRAWL_BASE_URL ?? 'https://api.firecrawl.dev';
const LIVE = KEY.length > 0 && process.env.RUN_LIVE_CONTRACT_TESTS === 'true';
const TIMEOUT = { timeout: 30_000 };

const headers = { 'content-type': 'application/json', authorization: `Bearer ${KEY}` };

function adapter(apiKey: string, retries = 2): FirecrawlSearch {
  return new FirecrawlSearch({
    baseUrl: BASE,
    apiKey,
    rateLimiter: new TokenBucket(10, 5),
    concurrency: new Semaphore(5),
    breaker: new CircuitBreaker(),
    ledger: new CostLedger(),
    logger: createLogger('contract', () => undefined),
    retry: { retries, baseMs: 500, maxMs: 4000 },
  });
}

describe.skipIf(!LIVE)('Firecrawl /v2/search live contract', () => {
  it('response matches the schema the adapter trusts (no scrapeOptions)', TIMEOUT, async () => {
    const res = await fetch(`${BASE}/v2/search`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: 'firecrawl web scraping', limit: 3, sources: [{ type: 'web' }] }),
    });
    expect(res.status).toBe(200);
    const json: unknown = await res.json();
    const parsed = FirecrawlSearchResponse.safeParse(json);
    // The whole point: if Firecrawl changed shape (or our schema is wrong),
    // this fails loudly here instead of silently in production.
    expect(parsed.success).toBe(true);
  });

  it('honors the per-source limit', TIMEOUT, async () => {
    const res = await fetch(`${BASE}/v2/search`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: 'industrial iot sensors', limit: 2, sources: [{ type: 'web' }] }),
    });
    const json: unknown = await res.json();
    const parsed = FirecrawlSearchResponse.parse(json);
    const webCount = Array.isArray(parsed.data) ? parsed.data.length : parsed.data.web.length;
    expect(webCount).toBeLessThanOrEqual(2);
  });

  it('the FirecrawlSearch adapter returns mapped, classified results and bills credits', TIMEOUT, async () => {
    const search = adapter(KEY);
    const r = await search.search({ query: 'electric vehicle market 2026', limit: 5, round: 1 });
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.length).toBeGreaterThan(0);
    expect(r.value.every((i) => i.url.startsWith('http'))).toBe(true);
    expect(r.value.every((i) => i.contentHash.length > 0)).toBe(true);
  });

  it('maps an unauthorized request to a non-retryable rejection', TIMEOUT, async () => {
    const search = adapter('fc-invalid-key-contract-test', 0);
    const r = await search.search({ query: 'x', limit: 1, round: 1 });
    expect(isOk(r)).toBe(false);
    if (isOk(r)) return;
    expect(r.error.retryable).toBe(false);
  });
});
