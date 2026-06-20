/** In-memory port fakes + builders for testing the pure engine (no network). */
import type { Intent, SearchResultItem, SourceClass } from '@velvet-comet/contracts';
import type { Clock, ExpansionPort, Logger, ScrapePort, SearchPort, SubQuery } from './ports.js';
import { type Result, ok, err } from './result.js';
import { engineError, type EngineError } from './errors.js';
import { classifySource, domainOf, simhash } from './text.js';

let seq = 0;

/** Build a result item with sensible derived fields; override as needed. */
export function makeItem(partial: Partial<SearchResultItem> & { url: string }): SearchResultItem {
  const id = seq++;
  const title = partial.title ?? `Title ${id}`;
  // Default content repeats a per-item token so defaulted items are maximally
  // far apart in SimHash space (no accidental near-dup collapse). Tests that
  // exercise dedup pass identical snippet text explicitly.
  const snippet = partial.snippet ?? `tok${id} `.repeat(20).trim();
  return {
    url: partial.url,
    domain: partial.domain ?? domainOf(partial.url),
    title,
    snippet,
    sourceClass: partial.sourceClass ?? classifySource(partial.url),
    contentHash: partial.contentHash ?? simhash(`${title} ${snippet}`),
    foundInRound: partial.foundInRound ?? 1,
    ...(partial.publishedAt ? { publishedAt: partial.publishedAt } : {}),
  };
}

/** Fixed clock for deterministic freshness scoring. */
export const fixedClock = (now: number): Clock => ({ now: () => now });

export const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/** Expansion fake: emits `count` sub-queries, optionally failing on given rounds. */
export class FakeExpansion implements ExpansionPort {
  private round = 0;
  constructor(private readonly failOnRounds: ReadonlySet<number> = new Set()) {}

  expand(input: {
    query: string;
    intent: Intent;
    missingClasses: readonly SourceClass[];
    count: number;
  }): Promise<Result<readonly SubQuery[], EngineError>> {
    this.round++;
    if (this.failOnRounds.has(this.round)) {
      return Promise.resolve(err(engineError('EXPANSION_FAILED', 'fake expansion failure')));
    }
    const subs: SubQuery[] = Array.from({ length: input.count }, (_, i) => ({
      text: `${input.query} #${this.round}.${i}`,
      targetClass: input.missingClasses[i % Math.max(1, input.missingClasses.length)] ?? 'web',
    }));
    return Promise.resolve(ok(subs));
  }
}

/** Search fake: returns scripted results per round. Round index is 1-based. */
export class FakeSearch implements SearchPort {
  constructor(private readonly resultsByRound: ReadonlyMap<number, readonly SearchResultItem[]>) {}

  search(input: {
    query: string;
    limit: number;
    round: number;
  }): Promise<Result<readonly SearchResultItem[], EngineError>> {
    const items = this.resultsByRound.get(input.round) ?? [];
    return Promise.resolve(ok(items.map((i) => ({ ...i, foundInRound: input.round }))));
  }
}

/** Search fake that always errors — exercises the partial/gap path. */
export class FailingSearch implements SearchPort {
  constructor(private readonly code: EngineError['code'] = 'UPSTREAM_UNAVAILABLE') {}
  search(): Promise<Result<readonly SearchResultItem[], EngineError>> {
    return Promise.resolve(err(engineError(this.code, 'fake search failure')));
  }
}

/** Scrape fake: returns deterministic markdown per URL. Counts calls. */
export class FakeScrape implements ScrapePort {
  calls = 0;
  scrape(url: string): Promise<Result<{ markdown: string }, EngineError>> {
    this.calls++;
    return Promise.resolve(ok({ markdown: `# Full content for ${url}\n\nbody text` }));
  }
}

/** Scrape fake that always errors — exercises the non-fatal deepen path. */
export class FailingScrape implements ScrapePort {
  scrape(): Promise<Result<{ markdown: string }, EngineError>> {
    return Promise.resolve(err(engineError('UPSTREAM_TIMEOUT', 'fake scrape failure')));
  }
}
