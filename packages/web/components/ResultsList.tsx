import type { RankedResult } from '@velvet-comet/contracts';
import { Panel, SourceBadge } from './ui';

/** Ranked results with transparent score + source provenance. */
export function ResultsList({ results }: { results: readonly RankedResult[] }): React.JSX.Element {
  return (
    <Panel title={`Ranked results · ${results.length}`}>
      <ol className="space-y-1">
        {results.map((r) => (
          <li
            key={r.url}
            className="group flex items-start gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-surface"
          >
            <span className="mt-0.5 w-6 shrink-0 text-right font-mono text-xs text-faint">
              {r.rank}
            </span>
            <span className="mt-0.5 w-10 shrink-0 font-mono text-xs tabular-nums text-accent">
              {r.score.toFixed(2)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <SourceBadge kind={r.sourceClass} />
                <span className="truncate text-faint text-xs">{r.domain}</span>
                {r.foundInRound > 1 ? (
                  <span className="text-[10px] text-faint">· round {r.foundInRound}</span>
                ) : null}
              </div>
              <a
                href={r.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 truncate text-sm text-ink hover:text-accent"
              >
                {r.title}
                {r.deepened ? (
                  <span className="shrink-0 rounded bg-success/15 px-1 text-[9px] uppercase text-success">
                    deepened
                  </span>
                ) : null}
              </a>
              {r.content ? (
                <p className="mt-1 line-clamp-2 text-xs text-faint">{r.content}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
