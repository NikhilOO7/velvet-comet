import { describe, it, expect } from 'vitest';
import type { ResearchRequest } from '@velvet-comet/contracts';
import { Coordinator } from './coordinator.js';
import { InMemoryJobStore } from './job-store.js';
import {
  CountingSearch,
  CrashingStore,
  SeqIdGen,
  deps,
  fixedClock,
} from './test-helpers.js';

const clock = fixedClock();

function request(overrides: Partial<ResearchRequest> = {}): ResearchRequest {
  return { query: 'q', intent: 'general', coverage: 'standard', deepen: false, ...overrides };
}

describe('Coordinator', () => {
  it('drives a job to completion and persists the outcome', async () => {
    const store = new InMemoryJobStore();
    const search = new CountingSearch();
    const coord = new Coordinator(deps(search, clock), store, clock, new SeqIdGen());

    const { id } = await coord.submit(request(), 'cold');
    const record = await coord.process(id);

    expect(record.status).toBe('done');
    expect(record.outcome?.coverage.rounds).toBe(4); // standard maxRounds
    expect(search.totalCalls()).toBe(20); // 5 sub-queries × 4 rounds
  });

  it('resumes from the last checkpoint after a crash — round 1 is not re-run', async () => {
    const inner = new InMemoryJobStore();
    const store = new CrashingStore(inner, 2); // crash on the 2nd save (after round 1)
    const search = new CountingSearch();
    const coord = new Coordinator(deps(search, clock), store, clock, new SeqIdGen());

    const { id } = await coord.submit(request(), 'cold');
    await expect(coord.process(id)).rejects.toThrow(/simulated crash/);

    // Round 1 checkpointed; round 2 was in-flight when the crash hit.
    expect(search.callsByRound.get(1)).toBe(5);
    expect(search.callsByRound.get(2)).toBe(5);

    // Recover: re-process from the persisted checkpoint.
    const record = await coord.process(id);
    expect(record.status).toBe('done');

    // Round 1 ran exactly once (not re-spent); round 2 re-ran (it was never
    // checkpointed). This is the round-level durability guarantee.
    expect(search.callsByRound.get(1)).toBe(5);
    expect(search.callsByRound.get(2)).toBe(10);
    // Logical credits still count each round once → final == 4 rounds × 5.
    expect(record.outcome?.coverage.creditsSpent).toBe(20);
  });

  it('dedupes submissions and is a no-op on a terminal job (exactly-once)', async () => {
    const store = new InMemoryJobStore();
    const search = new CountingSearch();
    const coord = new Coordinator(deps(search, clock), store, clock, new SeqIdGen());

    const first = await coord.submit(request({ idempotencyKey: 'key-123' }), 'cold');
    const second = await coord.submit(request({ idempotencyKey: 'key-123' }), 'cold');
    expect(second.deduped).toBe(true);
    expect(second.id).toBe(first.id);

    await coord.process(first.id);
    const callsAfterFirst = search.totalCalls();
    const again = await coord.process(first.id); // terminal → no-op
    expect(again.status).toBe('done');
    expect(search.totalCalls()).toBe(callsAfterFirst); // no extra Firecrawl spend
  });
});
