import type { SourceClass } from '@velvet-comet/contracts';

const ALL: SourceClass[] = ['web', 'news', 'trade', 'forum', 'regional', 'research', 'other'];

/**
 * Source-class coverage grid (PLAN.md §14): which classes we reached vs. missed.
 * The long-tail classes lighting up are the trade pubs / regional press / niche
 * forums customer #1 says a plain search never surfaces.
 */
export function SourceClassGrid({
  hit,
}: {
  hit: readonly SourceClass[];
}): React.JSX.Element {
  const hitSet = new Set(hit);
  return (
    <div className="grid grid-cols-4 gap-2">
      {ALL.map((cls) => {
        const on = hitSet.has(cls);
        return (
          <div
            key={cls}
            className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs ${
              on ? 'border-accent/30 bg-accent/5 text-ink' : 'border-line/50 text-faint'
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${on ? 'bg-accent shadow-glow' : 'bg-line'}`}
              aria-hidden
            />
            <span className="font-mono">{cls}</span>
          </div>
        );
      })}
    </div>
  );
}
