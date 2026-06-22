import { describe, it, expect } from 'vitest';
import type { ResearchRequest } from '@velvet-comet/contracts';
import { runCompleteness } from './engine.js';
import type { EngineDeps } from './ports.js';
import {
  CreditExhaustingSearch,
  FakeExpansion,
  fixedClock,
  silentLogger,
} from './test-helpers.js';
import { isOk } from './result.js';

const req: ResearchRequest = { query: 'q', intent: 'general', coverage: 'high', deepen: false };

describe('running out of Firecrawl credits', () => {
  it('stops early, keeps what it fetched, and finalizes as partial', async () => {
    // 'high' would do up to 8 rounds × 8 sub-queries = 64 searches; credits die after 3.
    const search = new CreditExhaustingSearch(3);
    const deps: EngineDeps = { expansion: new FakeExpansion(), search, clock: fixedClock(0), logger: silentLogger };

    const result = await runCompleteness(req, deps);

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    // Did NOT hammer the API with all 64 calls — stopped right after the 402.
    expect(search.calls).toBe(4);
    // Kept the 3 sources gathered before credits ran out.
    expect(result.value.results.length).toBe(3);
    // Honest, non-fake-green outcome with a clear reason.
    expect(result.value.status).toBe('partial');
    expect(result.value.coverage.stoppedReason).toBe('credits_exhausted');
    expect(result.value.coverage.gaps.some((g) => /credits exhausted/i.test(g.reason))).toBe(true);
  });
});
