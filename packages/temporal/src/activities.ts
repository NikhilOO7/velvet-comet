/**
 * Temporal activities — the side-effecting half of the port. `runRound` wraps
 * the exact same pure `core.executeRound` the in-process coordinator uses, so
 * the engine logic is shared, not reimplemented. Activities run in Node (full
 * I/O), are injected with EngineDeps, and are independently unit-testable.
 */
import { type EngineDeps, DEEPEN_TOP_N, deepenOutcome, executeRound, resolveConfig } from '@velvet-comet/core';
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
import type { EngineState } from '@velvet-comet/core';
import type { ResearchOutcome } from '@velvet-comet/contracts';
import type { ResearchActivities, RunRoundInput } from './shared.js';

/** Build the activity implementations over injected deps (testable seam). */
export function createActivities(deps: EngineDeps): ResearchActivities {
  return {
    async runRound(input: RunRoundInput): Promise<EngineState> {
      const cfg = resolveConfig(input.request);
      return executeRound(input.state, input.request, cfg, deps);
    },
    async deepen(input): Promise<ResearchOutcome> {
      return deepenOutcome(input.outcome, deps, { enabled: input.request.deepen, topN: DEEPEN_TOP_N });
    },
  };
}

/** Production deps from env: live Firecrawl + Claude when keys exist, else fakes. */
export function buildDepsFromEnv(): EngineDeps {
  const env = loadEnv();
  const logger = createLogger('temporal-activity');
  const ledger = new CostLedger();

  const search = env.FIRECRAWL_API_KEY
    ? new FirecrawlSearch({
        baseUrl: env.FIRECRAWL_BASE_URL,
        apiKey: env.FIRECRAWL_API_KEY,
        rateLimiter: new TokenBucket(env.FIRECRAWL_MAX_CONCURRENCY, env.FIRECRAWL_RPM / 60),
        concurrency: new Semaphore(env.FIRECRAWL_MAX_CONCURRENCY),
        breaker: new CircuitBreaker(),
        ledger,
        logger,
        cache: new InMemorySearchCache(),
      })
    : new MockFirecrawlSearch();

  const expansion = env.ANTHROPIC_API_KEY
    ? new AnthropicExpansion({ apiKey: env.ANTHROPIC_API_KEY, logger })
    : new HeuristicExpansion();

  const scrape = env.FIRECRAWL_API_KEY
    ? new FirecrawlScrape({
        baseUrl: env.FIRECRAWL_BASE_URL,
        apiKey: env.FIRECRAWL_API_KEY,
        rateLimiter: new TokenBucket(env.FIRECRAWL_MAX_CONCURRENCY, env.FIRECRAWL_RPM / 60),
        concurrency: new Semaphore(env.FIRECRAWL_MAX_CONCURRENCY),
        breaker: new CircuitBreaker(),
        ledger,
        logger,
      })
    : new MockScrape();

  return { expansion, search, scrape, clock: { now: (): number => Date.now() }, logger };
}
