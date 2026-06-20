import { describe, it, expect } from 'vitest';
import { rerank } from './rerank.js';
import { makeItem } from './test-helpers.js';

const NOW = Date.parse('2026-06-19T00:00:00Z');

describe('rerank', () => {
  it('news intent ranks fresher results higher', () => {
    const items = [
      makeItem({ url: 'https://news.com/old', publishedAt: '2026-01-01T00:00:00Z' }),
      makeItem({ url: 'https://news.com/new', publishedAt: '2026-06-18T00:00:00Z' }),
    ];
    const ranked = rerank(items, 'widget market', 'news', NOW);
    expect(ranked[0]?.url).toBe('https://news.com/new');
  });

  it('buying intent boosts comparison pages', () => {
    const items = [
      makeItem({ url: 'https://a.com/plain', title: 'Product page', snippet: 'buy now' }),
      makeItem({
        url: 'https://b.com/cmp',
        title: 'Best X vs Y comparison review',
        snippet: 'compare the best alternatives',
      }),
    ];
    const ranked = rerank(items, 'widget market', 'buying', NOW);
    expect(ranked[0]?.url).toBe('https://b.com/cmp');
  });

  it('research intent ranks high-authority domains first', () => {
    const items = [
      makeItem({ url: 'https://randomblog.com/x' }),
      makeItem({ url: 'https://nature.com/articles/1' }),
    ];
    const ranked = rerank(items, 'widget market', 'research', NOW);
    expect(ranked[0]?.domain).toBe('nature.com');
  });

  it('blends query relevance: on-topic results outrank off-topic ones', () => {
    const items = [
      makeItem({ url: 'https://a.com/off', title: 'unrelated content', snippet: 'nothing here' }),
      makeItem({
        url: 'https://b.com/on',
        title: 'solar battery storage market',
        snippet: 'solar battery storage trends',
      }),
    ];
    const ranked = rerank(items, 'solar battery storage', 'general', NOW);
    expect(ranked[0]?.url).toBe('https://b.com/on');
    expect(ranked[0]?.signals.relevance).toBeGreaterThan(0);
  });

  it('assigns dense 1-based ranks and exposes signals', () => {
    const ranked = rerank([makeItem({ url: 'https://a.com/1' })], 'widget', 'general', NOW);
    expect(ranked[0]?.rank).toBe(1);
    expect(Object.keys(ranked[0]?.signals ?? {}).length).toBeGreaterThan(0);
  });
});
