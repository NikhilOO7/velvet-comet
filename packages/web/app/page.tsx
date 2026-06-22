'use client';

import { useBatch } from '../lib/useBatch';
import type { SubmitInput } from '../lib/api';
import { CommandBar } from '../components/CommandBar';
import { CoveragePanel } from '../components/CoveragePanel';
import { ResultsList } from '../components/ResultsList';
import { BatchSummary } from '../components/BatchSummary';
import { JobList } from '../components/JobList';
import { Panel } from '../components/ui';

const EXAMPLES = [
  'competitive landscape for industrial IoT sensors',
  'electric vehicle battery supply chain 2026',
  'regulatory shifts in EU fintech',
];

export default function Console(): React.JSX.Element {
  const { jobs, selectedId, select, run, clear } = useBatch();
  const busy = jobs.some((j) => j.phase === 'submitting' || j.phase === 'streaming');
  const selected = jobs.find((j) => j.localId === selectedId) ?? null;

  return (
    <main className="mx-auto max-w-5xl px-5 py-10">
      <header className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            <span className="bg-comet bg-clip-text text-transparent">☄ Velvet Comet</span>
          </h1>
          <p className="mt-1 text-sm text-muted">
            Completeness-first research. Coverage you can trust, not just more results.
          </p>
        </div>
        {jobs.length > 0 ? (
          <button onClick={clear} className="text-xs text-faint hover:text-ink">
            clear batch
          </button>
        ) : null}
      </header>

      <CommandBar onRun={(inputs: SubmitInput[]) => run(inputs)} busy={busy} />

      <div className="mt-8 space-y-6">
        {jobs.length === 0 ? (
          <EmptyState onPick={(q) => run([{ query: q, coverage: 'high' }])} />
        ) : (
          <>
            <BatchSummary jobs={jobs} />
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
              <JobList jobs={jobs} selectedId={selectedId} onSelect={select} />
              <div className="space-y-6">
                {selected?.outcome ? (
                  <div className="animate-fade-up space-y-6">
                    {selected.outcome.coverage.stoppedReason === 'credits_exhausted' ? (
                      <div className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
                        <strong>Firecrawl credits ran out.</strong> Stopped early and kept the{' '}
                        {selected.outcome.coverage.domainsSeen} sources gathered before that, no data lost.
                        Top up your key to go further.
                      </div>
                    ) : selected.outcome.status === 'partial' ? (
                      <div className="rounded-xl border border-warn/30 bg-warn/5 px-4 py-3 text-sm text-warn">
                        Partial success — completed with gaps it couldn&apos;t fill. Shown below, honestly.
                      </div>
                    ) : null}
                    <CoveragePanel outcome={selected.outcome} />
                    <ResultsList results={selected.outcome.results} />
                  </div>
                ) : (
                  <Panel
                    title={selected ? 'Running' : 'Select a job'}
                    {...(selected ? { hint: 'streaming live' } : {})}
                  >
                    <p className="py-6 text-center text-sm text-muted">
                      {selected
                        ? `Round ${selected.frame?.round ?? 0} · ${selected.frame?.domainsSeen ?? 0} domains so far…`
                        : 'Pick a job on the left to inspect its coverage.'}
                    </p>
                  </Panel>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      <footer className="mt-12 text-center text-[11px] text-faint">
        Firecrawl · search → expand → diversify → saturate → rerank
      </footer>
    </main>
  );
}

function EmptyState({ onPick }: { onPick: (q: string) => void }): React.JSX.Element {
  return (
    <Panel>
      <div className="py-8 text-center">
        <div className="mx-auto mb-4 h-10 w-10 rounded-full bg-comet opacity-80" />
        <h2 className="text-lg text-ink">Point it at a topic — or a whole batch.</h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted">
          One query per line. Each expands into diverse angles, fans out across sources, dedupes the
          SEO head, and runs until new domains stop appearing.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {EXAMPLES.map((q) => (
            <button
              key={q}
              onClick={() => onPick(q)}
              className="rounded-full border border-line/60 bg-surface px-3 py-1.5 text-xs text-muted transition-colors hover:border-accent/40 hover:text-ink"
            >
              {q}
            </button>
          ))}
        </div>
      </div>
    </Panel>
  );
}
