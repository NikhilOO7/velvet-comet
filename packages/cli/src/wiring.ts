/**
 * Composition root (PLAN.md §11 hexagonal): the one place that picks concrete
 * adapters and injects them into the pure engine. Live Firecrawl + Claude when
 * keys are present; deterministic offline fakes otherwise, so the demo always
 * runs.
 */
import type { EngineDeps } from '@velvet-comet/core';
import {
  AnthropicExpansion,
  CircuitBreaker,
  CostLedger,
  FirecrawlScrape,
  FirecrawlSearch,
  HeuristicExpansion,
  InMemorySearchCache,
  MockFirecrawlSearch,
  MockScrape,
  Semaphore,
  TokenBucket,
  createLogger,
  loadEnv,
} from '@velvet-comet/adapters';

export interface Wiring {
  readonly deps: EngineDeps;
  readonly ledger: CostLedger;
  readonly mode: { search: 'firecrawl' | 'mock'; expansion: 'anthropic' | 'heuristic' };
}

export function wire(correlationId: string): Wiring {
  const env = loadEnv();
  const logger = createLogger(correlationId);
  const ledger = new CostLedger();
  const clock = { now: (): number => Date.now() };

  const useFirecrawl = Boolean(env.FIRECRAWL_API_KEY);
  const useAnthropic = Boolean(env.ANTHROPIC_API_KEY);

  const search = useFirecrawl
    ? new FirecrawlSearch({
        baseUrl: env.FIRECRAWL_BASE_URL,
        apiKey: env.FIRECRAWL_API_KEY as string,
        rateLimiter: new TokenBucket(env.FIRECRAWL_MAX_CONCURRENCY, env.FIRECRAWL_RPM / 60),
        concurrency: new Semaphore(env.FIRECRAWL_MAX_CONCURRENCY),
        breaker: new CircuitBreaker(),
        ledger,
        logger,
        cache: new InMemorySearchCache(),
      })
    : new MockFirecrawlSearch();

  const expansion = useAnthropic
    ? new AnthropicExpansion({ apiKey: env.ANTHROPIC_API_KEY as string, logger })
    : new HeuristicExpansion();

  const scrape = useFirecrawl
    ? new FirecrawlScrape({
        baseUrl: env.FIRECRAWL_BASE_URL,
        apiKey: env.FIRECRAWL_API_KEY as string,
        rateLimiter: new TokenBucket(env.FIRECRAWL_MAX_CONCURRENCY, env.FIRECRAWL_RPM / 60),
        concurrency: new Semaphore(env.FIRECRAWL_MAX_CONCURRENCY),
        breaker: new CircuitBreaker(),
        ledger,
        logger,
      })
    : new MockScrape();

  return {
    deps: { expansion, search, scrape, clock, logger },
    ledger,
    mode: {
      search: useFirecrawl ? 'firecrawl' : 'mock',
      expansion: useAnthropic ? 'anthropic' : 'heuristic',
    },
  };
}
