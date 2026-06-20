import type { BatchJob } from '../lib/useBatch';
import { StatusPill } from './ui';

const BARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

function sparkline(values: readonly number[]): string {
  if (values.length === 0) return '·';
  const max = Math.max(1, ...values);
  return values.map((v) => BARS[Math.min(7, Math.round((v / max) * 7))]).join('');
}

function statusOf(job: BatchJob): string {
  if (job.phase === 'done') return job.outcome?.status ?? 'done';
  return job.phase;
}

/** Selectable list of batch jobs, each streaming independently. */
export function JobList({
  jobs,
  selectedId,
  onSelect,
}: {
  jobs: readonly BatchJob[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}): React.JSX.Element {
  return (
    <ul className="space-y-2" role="listbox" aria-label="Research jobs">
      {jobs.map((job) => {
        const cov = job.outcome?.coverage;
        const curve = cov?.saturationCurve.map((p) => p.newDomains) ?? [];
        const domains = cov?.domainsSeen ?? job.frame?.domainsSeen ?? 0;
        const credits = cov?.creditsSpent ?? job.frame?.creditsSpent ?? 0;
        const selected = job.localId === selectedId;
        return (
          <li key={job.localId}>
            <button
              role="option"
              aria-selected={selected}
              onClick={() => onSelect(job.localId)}
              className={`w-full rounded-xl border px-4 py-3 text-left transition-colors ${
                selected ? 'border-accent/50 bg-accent/5' : 'border-line/50 bg-panel/40 hover:border-line'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-sm text-ink">{job.input.query}</span>
                <StatusPill status={statusOf(job)} />
              </div>
              <div className="mt-1 flex items-center gap-4 text-[11px] text-faint">
                <span className="font-mono text-accent">{sparkline(curve)}</span>
                <span>{domains} domains</span>
                <span>{cov ? `${cov.sourceClassesHit.length} classes` : `round ${job.frame?.round ?? 0}`}</span>
                <span>{credits} credits</span>
                {job.error ? <span className="text-danger">{job.error}</span> : null}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
