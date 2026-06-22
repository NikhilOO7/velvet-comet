import type { ResearchOutcome } from '@velvet-comet/contracts';
import { Panel, Stat } from './ui';
import { SaturationCurve } from './SaturationCurve';
import { SourceClassGrid } from './SourceClassGrid';
import { DiversityBar } from './DiversityBar';

const STOP_LABEL: Record<string, string> = {
  saturated: 'saturated (dry)',
  max_rounds: 'round cap',
  credit_budget: 'budget cap',
  credits_exhausted: 'out of credits',
  error: 'error',
};

/** The trust artifact: coverage report + the §14 hero visuals for a finished run. */
export function CoveragePanel({ outcome }: { outcome: ResearchOutcome }): React.JSX.Element {
  const c = outcome.coverage;
  return (
    <Panel title="Coverage report" hint={STOP_LABEL[c.stoppedReason] ?? c.stoppedReason}>
      <div className="grid grid-cols-4 gap-4">
        <Stat label="rounds" value={c.rounds} />
        <Stat label="domains" value={c.domainsSeen} />
        <Stat label="results" value={outcome.results.length} />
        <Stat label="credits" value={c.creditsSpent} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-[11px] uppercase tracking-wider text-faint">Saturation</h3>
          <SaturationCurve curve={c.saturationCurve} saturated={c.saturated} />
        </div>
        <div className="space-y-5">
          <div>
            <h3 className="mb-2 text-[11px] uppercase tracking-wider text-faint">Source classes</h3>
            <SourceClassGrid hit={c.sourceClassesHit} />
          </div>
          <div>
            <h3 className="mb-2 text-[11px] uppercase tracking-wider text-faint">Diversity</h3>
            <DiversityBar results={outcome.results} />
          </div>
        </div>
      </div>

      {c.gaps.length > 0 ? (
        <div className="mt-6 rounded-xl border border-warn/30 bg-warn/5 p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-warn">
            {c.gaps.length} honest gap{c.gaps.length > 1 ? 's' : ''}
          </h3>
          <ul className="space-y-1 text-xs text-muted">
            {c.gaps.slice(0, 6).map((g, i) => (
              <li key={i}>
                <span className="font-mono text-faint">[{g.sourceClass}]</span> {g.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Panel>
  );
}
