/**
 * Diversity-aware merge (PLAN.md §3, step ③). Pure functions: exact + near-dup
 * dedup, then a per-domain quota so SEO heads can't crowd out the long tail —
 * the direct answer to "fifty results, forty more of the same" (customer #1).
 */
import type { SearchResultItem } from '@velvet-comet/contracts';
import { domainOf, hammingDistance } from './text.js';

/** Below this Hamming distance two contentHashes are treated as duplicates. */
export const NEAR_DUP_THRESHOLD = 3;

export interface MergeResult {
  readonly kept: readonly SearchResultItem[];
  readonly exactDupes: number;
  readonly nearDupes: number;
  readonly domainCapped: number;
}

/**
 * Merge accumulated results with newly-found ones.
 *
 * Order of precedence within a (url|near-dup) collision: keep the earliest-seen
 * item so provenance (`foundInRound`) stays stable and reproducible.
 */
export function mergeResults(
  existing: readonly SearchResultItem[],
  incoming: readonly SearchResultItem[],
  perDomainCap: number,
): MergeResult {
  const byUrl = new Map<string, SearchResultItem>();
  const hashes: string[] = [];
  let exactDupes = 0;
  let nearDupes = 0;

  for (const item of [...existing, ...incoming]) {
    if (byUrl.has(item.url)) {
      exactDupes++;
      continue;
    }
    const isNearDup = hashes.some(
      (h) => hammingDistance(h, item.contentHash) <= NEAR_DUP_THRESHOLD,
    );
    if (isNearDup) {
      nearDupes++;
      continue;
    }
    byUrl.set(item.url, item);
    hashes.push(item.contentHash);
  }

  // Apply the per-domain quota deterministically (insertion order preserved).
  const perDomain = new Map<string, number>();
  const kept: SearchResultItem[] = [];
  let domainCapped = 0;
  for (const item of byUrl.values()) {
    const domain = domainOf(item.url);
    const count = perDomain.get(domain) ?? 0;
    if (count >= perDomainCap) {
      domainCapped++;
      continue;
    }
    perDomain.set(domain, count + 1);
    kept.push(item);
  }

  return { kept, exactDupes, nearDupes, domainCapped };
}
