/**
 * Composition root for the API (PLAN.md §11). Wires the pure engine to concrete
 * adapters, the in-memory JobStore, the event bus, and the Coordinator. Live
 * Firecrawl + Claude when keys are present; deterministic fakes otherwise.
 *
 * Dependencies are overridable so tests can inject deterministic doubles.
 */
import { randomUUID } from 'node:crypto';
import type { Clock, EngineDeps } from '@velvet-comet/core';
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
import { Coordinator, InMemoryJobStore, type IdGen, type JobStore } from '@velvet-comet/worker';
import { InProcessEventBus } from './event-bus.js';

export interface Container {
  readonly coordinator: Coordinator;
  readonly store: JobStore;
  readonly events: InProcessEventBus;
  readonly mode: {
    search: 'firecrawl' | 'mock';
    expansion: 'anthropic' | 'heuristic';
    store: 'postgres' | 'memory';
  };
}

export interface ContainerOptions {
  readonly deps?: EngineDeps;
  readonly idGen?: IdGen;
  readonly clock?: Clock;
  /** Durable store (e.g. PostgresJobStore). Defaults to in-memory. */
  readonly store?: JobStore;
}

const uuidIdGen: IdGen = { next: (): string => randomUUID() };

export function buildContainer(opts: ContainerOptions = {}): Container {
  const clock: Clock = opts.clock ?? { now: (): number => Date.now() };
  const { deps, mode } = opts.deps
    ? { deps: opts.deps, mode: { search: 'mock' as const, expansion: 'heuristic' as const } }
    : buildDeps();

  const store = opts.store ?? new InMemoryJobStore();
  const events = new InProcessEventBus();
  const coordinator = new Coordinator(deps, store, clock, opts.idGen ?? uuidIdGen, events);

  return {
    coordinator,
    store,
    events,
    mode: { ...mode, store: opts.store ? 'postgres' : 'memory' },
  };
}

function buildDeps(): { deps: EngineDeps; mode: Omit<Container['mode'], 'store'> } {
  const env = loadEnv();
  const logger = createLogger(`api-${randomUUID()}`);
  const ledger = new CostLedger();

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
    deps: { expansion, search, scrape, clock: { now: (): number => Date.now() }, logger },
    mode: {
      search: useFirecrawl ? 'firecrawl' : 'mock',
      expansion: useAnthropic ? 'anthropic' : 'heuristic',
    },
  };
}
