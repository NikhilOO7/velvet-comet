/**
 * Search response cache (PLAN.md §15 #4). Identical sub-queries recur across a
 * nightly batch (and across jobs); caching them avoids re-spending Firecrawl
 * credits. In-memory TTL impl for the demo; a Redis-backed cache swaps in behind
 * the same interface for multi-process deployments.
 */
import type { SearchResultItem } from '@velvet-comet/contracts';

export interface SearchCache {
  get(key: string): Promise<readonly SearchResultItem[] | undefined>;
  set(key: string, items: readonly SearchResultItem[]): Promise<void>;
}

/** Normalize a query into a stable cache key (case/whitespace-insensitive). */
export function cacheKey(query: string, limit: number): string {
  return `${query.trim().toLowerCase().replace(/\s+/g, ' ')}::${limit}`;
}

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

export class InMemorySearchCache implements SearchCache {
  private readonly entries = new Map<string, { items: readonly SearchResultItem[]; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number = TWO_DAYS_MS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get(key: string): Promise<readonly SearchResultItem[] | undefined> {
    const entry = this.entries.get(key);
    if (!entry) return Promise.resolve(undefined);
    if (this.now() >= entry.expiresAt) {
      this.entries.delete(key);
      return Promise.resolve(undefined);
    }
    return Promise.resolve(entry.items);
  }

  set(key: string, items: readonly SearchResultItem[]): Promise<void> {
    this.entries.set(key, { items, expiresAt: this.now() + this.ttlMs });
    return Promise.resolve();
  }
}
