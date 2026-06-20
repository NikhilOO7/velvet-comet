import { describe, it, expect } from 'vitest';
import { mergeResults } from './merge.js';
import { makeItem } from './test-helpers.js';

describe('mergeResults', () => {
  it('drops exact URL duplicates and keeps the earliest', () => {
    const existing = [makeItem({ url: 'https://a.com/1', foundInRound: 1 })];
    const incoming = [makeItem({ url: 'https://a.com/1', foundInRound: 2 })];
    const r = mergeResults(existing, incoming, 10);
    expect(r.kept).toHaveLength(1);
    expect(r.exactDupes).toBe(1);
    expect(r.kept[0]?.foundInRound).toBe(1);
  });

  it('collapses near-duplicate content blocks (customer #3)', () => {
    const text = 'identical product description repeated across page variants';
    const r = mergeResults(
      [makeItem({ url: 'https://store.com/p', snippet: text, title: 'P' })],
      [makeItem({ url: 'https://store.com/p?mobile=1', snippet: text, title: 'P' })],
      10,
    );
    expect(r.nearDupes).toBe(1);
    expect(r.kept).toHaveLength(1);
  });

  it('enforces the per-domain quota so heads cannot dominate', () => {
    const incoming = [
      makeItem({ url: 'https://seo.com/1' }),
      makeItem({ url: 'https://seo.com/2' }),
      makeItem({ url: 'https://seo.com/3' }),
      makeItem({ url: 'https://niche.org/1' }),
    ];
    const r = mergeResults([], incoming, 2);
    expect(r.kept.filter((i) => i.domain === 'seo.com')).toHaveLength(2);
    expect(r.kept.filter((i) => i.domain === 'niche.org')).toHaveLength(1);
    expect(r.domainCapped).toBe(1);
  });
});
