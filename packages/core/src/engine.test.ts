import { describe, it, expect } from 'vitest';
import type { ResearchRequest, SearchResultItem } from '@velvet-comet/contracts';
import { runCompleteness } from './engine.js';
import type { EngineDeps } from './ports.js';
import {
  FailingSearch,
  FakeExpansion,
  FakeSearch,
  fixedClock,
  makeItem,
  silentLogger,
} from './test-helpers.js';
import { isErr, isOk } from './result.js';

const NOW = Date.parse('2026-06-19T00:00:00Z');

function req(overrides: Partial<ResearchRequest> = {}): ResearchRequest {
  return {
    query: 'market landscape for widgets',
    intent: 'general',
    coverage: 'standard',
    deepen: false,
    ...overrides,
  };
}

function deps(search: EngineDeps['search'], expansion = new FakeExpansion()): EngineDeps {
  return { search, expansion, clock: fixedClock(NOW), logger: silentLogger };
}

const rounds = (m: Record<number, SearchResultItem[]>): Map<number, SearchResultItem[]> =>
  new Map(Object.entries(m).map(([k, v]) => [Number(k), v]));

describe('runCompleteness', () => {
  it('accumulates across rounds and stops when a round is dry (saturation)', async () => {
    const search = new FakeSearch(
      rounds({
        1: [makeItem({ url: 'https://a.com/1' }), makeItem({ url: 'https://b.com/1' })],
        2: [makeItem({ url: 'https://c.com/1' })],
        3: [makeItem({ url: 'https://a.com/1' })], // nothing new ⇒ dry
      }),
    );
    const result = await runCompleteness(req(), deps(search));
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.coverage.stoppedReason).toBe('saturated');
    expect(result.value.coverage.saturated).toBe(true);
    expect(result.value.coverage.rounds).toBe(3);
    expect(result.value.coverage.domainsSeen).toBe(3);
    // Saturation curve tells the story: 2 new, 1 new, 0 new.
    expect(result.value.coverage.saturationCurve.map((p) => p.newDomains)).toEqual([2, 1, 0]);
  });

  it('fast profile runs exactly one round', async () => {
    const search = new FakeSearch(
      rounds({ 1: [makeItem({ url: 'https://a.com/1' })], 2: [makeItem({ url: 'https://z.com/1' })] }),
    );
    const result = await runCompleteness(req({ coverage: 'fast' }), deps(search));
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.coverage.rounds).toBe(1);
    expect(result.value.coverage.stoppedReason).toBe('max_rounds');
  });

  it('stops when the credit budget is exhausted', async () => {
    const search = new FakeSearch(rounds({ 1: [makeItem({ url: 'https://a.com/1' })] }));
    // standard profile expands to 5 sub-queries/round; budget of 2 cuts it off.
    const result = await runCompleteness(req({ creditBudget: 2 }), deps(search));
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.coverage.stoppedReason).toBe('credit_budget');
    expect(result.value.coverage.creditsSpent).toBeLessThanOrEqual(2);
  });

  it('returns an error when round-1 expansion fails with nothing banked', async () => {
    const search = new FakeSearch(rounds({}));
    const result = await runCompleteness(
      req(),
      deps(search, new FakeExpansion(new Set([1]))),
    );
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.code).toBe('EXPANSION_FAILED');
  });

  it('degrades to partial when searches fail, recording gaps (never fatal)', async () => {
    const result = await runCompleteness(req({ coverage: 'fast' }), deps(new FailingSearch()));
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.status).toBe('partial');
    expect(result.value.coverage.gaps.length).toBeGreaterThan(0);
    expect(result.value.results).toHaveLength(0);
  });

  it('is deterministic: same inputs ⇒ identical ranked output', async () => {
    const build = (): EngineDeps =>
      deps(
        new FakeSearch(
          rounds({
            1: [makeItem({ url: 'https://a.com/1' }), makeItem({ url: 'https://b.com/1' })],
          }),
        ),
      );
    const a = await runCompleteness(req({ coverage: 'fast' }), build());
    const b = await runCompleteness(req({ coverage: 'fast' }), build());
    expect(isOk(a) && isOk(b)).toBe(true);
    if (!isOk(a) || !isOk(b)) return;
    expect(a.value.results.map((r) => r.url)).toEqual(b.value.results.map((r) => r.url));
  });
});
