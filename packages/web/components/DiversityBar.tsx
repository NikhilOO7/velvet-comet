import type { RankedResult } from '@velvet-comet/contracts';

const LONG_TAIL = new Set(['trade', 'forum', 'regional', 'research']);

/**
 * Diversity view (PLAN.md §14): the share of results that are long-tail sources
 * vs. SEO head — the visual rebuttal to "fifty results, forty more of the same".
 */
export function DiversityBar({ results }: { results: readonly RankedResult[] }): React.JSX.Element {
  const total = results.length || 1;
  const tail = results.filter((r) => LONG_TAIL.has(r.sourceClass)).length;
  const head = total - tail;
  const tailPct = Math.round((tail / total) * 100);
  const headPct = 100 - tailPct;
  const domains = new Set(results.map((r) => r.domain)).size;

  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full border border-line/50">
        <div className="bg-line/70" style={{ width: `${headPct}%` }} aria-hidden />
        <div className="bg-comet" style={{ width: `${tailPct}%` }} aria-hidden />
      </div>
      <div className="mt-2 flex justify-between text-[11px]">
        <span className="text-faint">
          <span className="text-muted">{head}</span> head
        </span>
        <span className="text-faint">{domains} distinct domains</span>
        <span className="text-faint">
          <span className="text-accent">{tail}</span> long-tail ({tailPct}%)
        </span>
      </div>
    </div>
  );
}
