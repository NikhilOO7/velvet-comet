/**
 * Completeness metrics (PLAN.md §15 #0). All pure.
 */
import type { RankedResult, SourceClass } from '@velvet-comet/contracts';
import type { EvalDoc } from './corpus.js';

const LONG_TAIL: ReadonlySet<SourceClass> = new Set(['trade', 'forum', 'regional', 'research', 'news']);

/** Fraction of ground-truth domains discovered (recall@N). */
export function recall(foundDomains: ReadonlySet<string>, truth: readonly EvalDoc[]): number {
  if (truth.length === 0) return 1;
  const hit = truth.filter((d) => foundDomains.has(d.domain)).length;
  return hit / truth.length;
}

/** Fraction of the ground-truth source classes that were reached. */
export function sourceClassCoverage(
  foundDomains: ReadonlySet<string>,
  truth: readonly EvalDoc[],
): number {
  const truthClasses = new Set(truth.map((d) => d.sourceClass));
  if (truthClasses.size === 0) return 1;
  const foundClasses = new Set(truth.filter((d) => foundDomains.has(d.domain)).map((d) => d.sourceClass));
  return foundClasses.size / truthClasses.size;
}

/** Share of returned results that are long-tail (vs. SEO head). */
export function headTailRatio(results: readonly RankedResult[]): number {
  if (results.length === 0) return 0;
  const tail = results.filter((r) => LONG_TAIL.has(r.sourceClass)).length;
  return tail / results.length;
}

export function domainsOf(results: readonly { domain: string }[]): Set<string> {
  return new Set(results.map((r) => r.domain));
}
