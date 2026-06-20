import type { BatchJob } from '../lib/useBatch';
import { Stat } from './ui';

/** Aggregate header across all jobs in the batch. */
export function BatchSummary({ jobs }: { jobs: readonly BatchJob[] }): React.JSX.Element {
  const running = jobs.filter((j) => j.phase === 'submitting' || j.phase === 'streaming').length;
  const done = jobs.filter((j) => j.phase === 'done').length;
  const domains = jobs.reduce((s, j) => s + (j.outcome?.coverage.domainsSeen ?? j.frame?.domainsSeen ?? 0), 0);
  const credits = jobs.reduce((s, j) => s + (j.outcome?.coverage.creditsSpent ?? j.frame?.creditsSpent ?? 0), 0);

  return (
    <div className="grid grid-cols-4 gap-4 rounded-2xl border border-line/60 bg-panel/70 p-5 backdrop-blur-sm">
      <Stat label="jobs" value={jobs.length} />
      <Stat label="running" value={running > 0 ? <span className="text-accent">{running}</span> : 0} />
      <Stat label="done" value={done} />
      <Stat label="total credits" value={credits} />
      <div className="col-span-4 -mt-1 text-[11px] text-faint">{domains} domains discovered across the batch</div>
    </div>
  );
}
