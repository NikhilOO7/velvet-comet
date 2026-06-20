import { describe, it, expect } from 'vitest';
import type { SearchResultItem } from '@velvet-comet/contracts';
import { InMemorySearchCache, cacheKey } from './search-cache.js';

const item: SearchResultItem = {
  url: 'https://a.com/1',
  domain: 'a.com',
  title: 'T',
  snippet: 'S',
  sourceClass: 'web',
  contentHash: 'abc',
  foundInRound: 1,
};

describe('cacheKey', () => {
  it('normalizes case and whitespace', () => {
    expect(cacheKey('  Solar  Storage ', 10)).toBe(cacheKey('solar storage', 10));
  });
  it('separates by limit', () => {
    expect(cacheKey('q', 10)).not.toBe(cacheKey('q', 20));
  });
});

describe('InMemorySearchCache', () => {
  it('stores and returns items', async () => {
    const cache = new InMemorySearchCache();
    await cache.set('k', [item]);
    expect(await cache.get('k')).toHaveLength(1);
  });

  it('expires entries past the TTL', async () => {
    let t = 0;
    const cache = new InMemorySearchCache(1000, () => t);
    await cache.set('k', [item]);
    t = 999;
    expect(await cache.get('k')).toHaveLength(1);
    t = 1000;
    expect(await cache.get('k')).toBeUndefined();
  });
});
