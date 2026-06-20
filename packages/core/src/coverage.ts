/**
 * Coverage accounting (PLAN.md §3 step ④ + §14 hero visual). Pure helpers for
 * tracking which source classes we reached, the saturation curve, and the
 * honest gaps — the trust artifact behind "completeness is the product".
 */
import type { SaturationPoint, SearchResultItem, SourceClass } from '@velvet-comet/contracts';

export const ALL_SOURCE_CLASSES: readonly SourceClass[] = [
  'web',
  'news',
  'trade',
  'forum',
  'regional',
  'research',
  'other',
];

/** The "interesting" long-tail classes whose absence is a meaningful gap. */
const TARGET_CLASSES: readonly SourceClass[] = ['news', 'trade', 'forum', 'regional', 'research'];

/** Source classes from TARGET_CLASSES not yet present in the result set. */
export function missingClasses(items: readonly SearchResultItem[]): SourceClass[] {
  const seen = new Set(items.map((i) => i.sourceClass));
  return TARGET_CLASSES.filter((c) => !seen.has(c));
}

export function distinctDomains(items: readonly SearchResultItem[]): Set<string> {
  return new Set(items.map((i) => i.domain).filter((d) => d.length > 0));
}

/**
 * Append a saturation point given the domain set before and after a round.
 * `newDomains === 0` is the dry signal the controller stops on.
 */
export function saturationPoint(
  round: number,
  before: ReadonlySet<string>,
  after: ReadonlySet<string>,
): SaturationPoint {
  let newDomains = 0;
  for (const d of after) if (!before.has(d)) newDomains++;
  return { round, newDomains, cumulativeDomains: after.size };
}

export function sourceClassesHit(items: readonly SearchResultItem[]): SourceClass[] {
  const seen = new Set(items.map((i) => i.sourceClass));
  return ALL_SOURCE_CLASSES.filter((c) => seen.has(c));
}
