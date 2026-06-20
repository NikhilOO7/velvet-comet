import type { ReactNode } from 'react';

/** Small presentational primitives shared across the console. */

export function Panel({
  title,
  children,
  hint,
}: {
  title?: string;
  children: ReactNode;
  hint?: string;
}): React.JSX.Element {
  return (
    <section className="rounded-2xl border border-line/60 bg-panel/70 p-5 backdrop-blur-sm">
      {title ? (
        <header className="mb-4 flex items-baseline justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">{title}</h2>
          {hint ? <span className="text-[11px] text-faint">{hint}</span> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

const SOURCE_TONE: Record<string, string> = {
  web: 'text-muted border-line',
  news: 'text-sky-300 border-sky-500/40',
  trade: 'text-amber-300 border-amber-500/40',
  forum: 'text-fuchsia-300 border-fuchsia-500/40',
  regional: 'text-emerald-300 border-emerald-500/40',
  research: 'text-violet-300 border-violet-500/40',
  other: 'text-faint border-line',
};

export function SourceBadge({ kind }: { kind: string }): React.JSX.Element {
  const tone = SOURCE_TONE[kind] ?? 'text-faint border-line';
  return (
    <span className={`rounded-md border px-1.5 py-0.5 font-mono text-[10px] uppercase ${tone}`}>
      {kind}
    </span>
  );
}

export function StatusPill({ status }: { status: string }): React.JSX.Element {
  const fallback = { label: 'ready', cls: 'text-faint border-line', live: false };
  const map: Record<string, { label: string; cls: string; live?: boolean }> = {
    idle: { label: 'ready', cls: 'text-faint border-line' },
    submitting: { label: 'submitting', cls: 'text-accent border-accent/40', live: true },
    streaming: { label: 'running', cls: 'text-accent border-accent/40', live: true },
    queued: { label: 'queued', cls: 'text-accent border-accent/40', live: true },
    fanning_out: { label: 'running', cls: 'text-accent border-accent/40', live: true },
    done: { label: 'done', cls: 'text-success border-success/40' },
    partial: { label: 'partial', cls: 'text-warn border-warn/40' },
    failed: { label: 'failed', cls: 'text-danger border-danger/40' },
    error: { label: 'error', cls: 'text-danger border-danger/40' },
  };
  const s = map[status] ?? fallback;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${s.cls}`}
    >
      {s.live ? <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse2" /> : null}
      {s.label}
    </span>
  );
}

export function Stat({ label, value }: { label: string; value: ReactNode }): React.JSX.Element {
  return (
    <div>
      <div className="font-mono text-2xl tabular-nums text-ink">{value}</div>
      <div className="mt-0.5 text-[11px] uppercase tracking-wider text-faint">{label}</div>
    </div>
  );
}
