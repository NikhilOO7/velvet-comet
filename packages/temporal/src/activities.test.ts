import { describe, it, expect } from 'vitest';
import type { ResearchRequest } from '@velvet-comet/contracts';
import { initialState } from '@velvet-comet/core';
import { MockFirecrawlSearch, HeuristicExpansion, createLogger } from '@velvet-comet/adapters';
import type { EngineDeps } from '@velvet-comet/core';
import { createActivities } from './activities.js';

function deps(): EngineDeps {
  return {
    search: new MockFirecrawlSearch(),
    expansion: new HeuristicExpansion(),
    clock: { now: () => 1_000 },
    logger: createLogger('test', () => undefined),
  };
}

const request: ResearchRequest = { query: 'q', intent: 'general', coverage: 'standard', deepen: false };

describe('temporal activities', () => {
  it('runRound advances the engine state by exactly one round', async () => {
    const activities = createActivities(deps());
    const after = await activities.runRound({ state: initialState(), request });

    expect(after.round).toBe(1);
    expect(after.accumulated.length).toBeGreaterThan(0);
    expect(after.saturationCurve).toHaveLength(1);
  });

  it('is a pure advance — feeding the result back continues from round 2', async () => {
    const activities = createActivities(deps());
    const r1 = await activities.runRound({ state: initialState(), request });
    const r2 = await activities.runRound({ state: r1, request });

    expect(r2.round).toBe(2);
    // The workflow loop drives exactly this hand-off, durably, via Temporal.
    expect(r2.creditsSpent).toBeGreaterThan(r1.creditsSpent);
  });
});
