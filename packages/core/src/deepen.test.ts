import { describe, it, expect } from 'vitest';
import type { ResearchRequest } from '@velvet-comet/contracts';
import { runCompleteness } from './engine.js';
import type { EngineDeps } from './ports.js';
import {
  FakeExpansion,
  FakeScrape,
  FailingScrape,
  FakeSearch,
  fixedClock,
  makeItem,
  silentLogger,
} from './test-helpers.js';
import { isOk } from './result.js';

const NOW = 0;
const rounds = new Map([[1, [makeItem({ url: 'https://a.com/1' }), makeItem({ url: 'https://b.com/1' })]]]);

function req(deepen: boolean): ResearchRequest {
  return { query: 'q', intent: 'general', coverage: 'fast', deepen };
}

function deps(scrape?: EngineDeps['scrape']): EngineDeps {
  return {
    expansion: new FakeExpansion(),
    search: new FakeSearch(rounds),
    clock: fixedClock(NOW),
    logger: silentLogger,
    ...(scrape ? { scrape } : {}),
  };
}

describe('deepen step', () => {
  it('scrapes top results and attaches content when deepen=true', async () => {
    const scrape = new FakeScrape();
    const r = await runCompleteness(req(true), deps(scrape));
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(scrape.calls).toBeGreaterThan(0);
    expect(r.value.results[0]?.deepened).toBe(true);
    expect(r.value.results[0]?.content).toContain('Full content');
  });

  it('does not scrape when deepen=false', async () => {
    const scrape = new FakeScrape();
    const r = await runCompleteness(req(false), deps(scrape));
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(scrape.calls).toBe(0);
    expect(r.value.results[0]?.deepened).toBeUndefined();
  });

  it('is non-fatal: a failed scrape leaves the result at snippet level', async () => {
    const r = await runCompleteness(req(true), deps(new FailingScrape()));
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.results.length).toBeGreaterThan(0);
    expect(r.value.results[0]?.content).toBeUndefined();
  });

  it('no-ops when no scrape port is wired', async () => {
    const r = await runCompleteness(req(true), deps());
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.results[0]?.deepened).toBeUndefined();
  });
});
