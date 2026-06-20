/**
 * Ports (PLAN.md §11 hexagonal). The pure engine depends only on these
 * interfaces; concrete Firecrawl/LLM/clock adapters are injected. This is what
 * makes the saturation algorithm testable with in-memory fakes — no network.
 */
import type { Intent, SearchResultItem, SourceClass } from '@velvet-comet/contracts';
import type { Result } from './result.js';
import type { EngineError } from './errors.js';

/** One expanded sub-query plus the angle it targets (provenance + diversity). */
export interface SubQuery {
  readonly text: string;
  /** The source class this angle is reaching for (e.g. forum, trade press). */
  readonly targetClass: SourceClass;
}

/** LLM leaf stage: turn one query into K angled sub-queries (customer #1). */
export interface ExpansionPort {
  expand(input: {
    query: string;
    intent: Intent;
    /** Source classes still missing — lets later rounds target the gaps. */
    missingClasses: readonly SourceClass[];
    count: number;
  }): Promise<Result<readonly SubQuery[], EngineError>>;
}

/** Firecrawl chokepoint: rate-limited, retried, cached search (PLAN.md §6a). */
export interface SearchPort {
  search(input: {
    query: string;
    limit: number;
    round: number;
  }): Promise<Result<readonly SearchResultItem[], EngineError>>;
}

/** Firecrawl `/scrape`: full-content fetch for the deepen step (composes a 2nd capability). */
export interface ScrapePort {
  scrape(url: string): Promise<Result<{ markdown: string }, EngineError>>;
}

/** Injected so the domain stays pure/deterministic (PLAN.md §12). */
export interface Clock {
  now(): number;
}

/** Structured logger; never logs PII or page content (PLAN.md §12). */
export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export interface EngineDeps {
  readonly expansion: ExpansionPort;
  readonly search: SearchPort;
  /** Optional — enables the deepen step (request.deepen). */
  readonly scrape?: ScrapePort;
  readonly clock: Clock;
  readonly logger: Logger;
}
