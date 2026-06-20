/** Test doubles for the Coordinator: counting search, deterministic deps, ids. */
import type { Intent, SearchResultItem, SourceClass } from '@velvet-comet/contracts';
import {
  type Clock,
  type EngineDeps,
  type ExpansionPort,
  type Logger,
  type Result,
  type SearchPort,
  type SubQuery,
  type EngineError,
  ok,
  simhash,
} from '@velvet-comet/core';
import type { JobStore, JobRecord } from './job-store.js';
import type { IdGen } from './coordinator.js';
import type { InMemoryJobStore } from './job-store.js';

export const silentLogger: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
export const fixedClock = (now = 1_000): Clock => ({ now: () => now });

export class SeqIdGen implements IdGen {
  private n = 0;
  next(): string {
    return `job-${++this.n}`;
  }
}

/** Expansion that always yields `count` sub-queries (never fails). */
export class StubExpansion implements ExpansionPort {
  expand(input: {
    query: string;
    intent: Intent;
    missingClasses: readonly SourceClass[];
    count: number;
  }): Promise<Result<readonly SubQuery[], EngineError>> {
    const subs: SubQuery[] = Array.from({ length: input.count }, (_, i) => ({
      text: `${input.query} #${i}`,
      targetClass: 'web' as const,
    }));
    return Promise.resolve(ok(subs));
  }
}

/**
 * Search that records how many times it was called per round, and returns one
 * fresh domain per round so the run advances (and eventually saturates).
 */
export class CountingSearch implements SearchPort {
  readonly callsByRound = new Map<number, number>();

  search(input: {
    query: string;
    limit: number;
    round: number;
  }): Promise<Result<readonly SearchResultItem[], EngineError>> {
    this.callsByRound.set(input.round, (this.callsByRound.get(input.round) ?? 0) + 1);
    const url = `https://round${input.round}.example.com/a`;
    const item: SearchResultItem = {
      url,
      domain: `round${input.round}.example.com`,
      title: `r${input.round}`,
      snippet: `content for round ${input.round}`,
      sourceClass: 'web',
      contentHash: simhash(`r${input.round} content for round ${input.round}`),
      foundInRound: input.round,
    };
    return Promise.resolve(ok([item]));
  }

  totalCalls(): number {
    return [...this.callsByRound.values()].reduce((a, b) => a + b, 0);
  }
}

export function deps(search: SearchPort, clock: Clock): EngineDeps {
  return { expansion: new StubExpansion(), search, clock, logger: silentLogger };
}

/**
 * Wraps a store and throws on the Nth save() to simulate a crash *after* a
 * checkpoint has been persisted. Subsequent saves succeed (recovery).
 */
export class CrashingStore implements JobStore {
  private saves = 0;
  constructor(
    private readonly inner: InMemoryJobStore,
    private readonly throwOnSave: number,
  ) {}

  create(record: JobRecord): Promise<void> {
    return this.inner.create(record);
  }
  get(id: string): Promise<JobRecord | null> {
    return this.inner.get(id);
  }
  async save(record: JobRecord): Promise<void> {
    this.saves++;
    if (this.saves === this.throwOnSave) throw new Error('simulated crash during save');
    await this.inner.save(record);
  }
  findByIdempotencyKey(key: string): Promise<JobRecord | null> {
    return this.inner.findByIdempotencyKey(key);
  }
}
