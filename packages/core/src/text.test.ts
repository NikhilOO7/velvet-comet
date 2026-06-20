import { describe, it, expect } from 'vitest';
import { classifySource, domainOf, hammingDistance, simhash } from './text.js';

describe('domainOf', () => {
  it('strips www and lowercases', () => {
    expect(domainOf('https://WWW.Example.com/path')).toBe('example.com');
  });
  it('returns empty string for garbage', () => {
    expect(domainOf('not a url')).toBe('');
  });
});

describe('classifySource', () => {
  it('detects forums, news, research, and regional TLDs', () => {
    expect(classifySource('https://community.acme.com/t/123')).toBe('forum');
    expect(classifySource('https://www.reuters.com/x')).toBe('news');
    expect(classifySource('https://arxiv.org/abs/1')).toBe('research');
    expect(classifySource('https://shop.example.de/p')).toBe('regional');
    expect(classifySource('https://example.com')).toBe('web');
  });
  it('honors a non-web hint over heuristics', () => {
    expect(classifySource('https://example.com', 'trade')).toBe('trade');
  });
});

describe('simhash / hammingDistance', () => {
  it('gives near-identical text a small Hamming distance', () => {
    const a = simhash('the quick brown fox jumps over the lazy dog');
    const b = simhash('the quick brown fox jumps over the lazy dog!');
    expect(hammingDistance(a, b)).toBeLessThanOrEqual(3);
  });
  it('gives unrelated text a large Hamming distance', () => {
    const a = simhash('quarterly revenue grew across all regions this year');
    const b = simhash('photosynthesis converts sunlight into chemical energy');
    expect(hammingDistance(a, b)).toBeGreaterThan(10);
  });
});
