'use client';

import { useEffect, useRef, useState } from 'react';
import type { Intent, CoverageProfile } from '@velvet-comet/contracts';
import type { SubmitInput } from '../lib/api';

const INTENTS: Intent[] = ['general', 'news', 'research', 'buying'];
const COVERAGES: { value: CoverageProfile; label: string }[] = [
  { value: 'fast', label: 'Fast · 1 round' },
  { value: 'standard', label: 'Standard · ≤4' },
  { value: 'high', label: 'High · until dry' },
];

/**
 * The operator's launch bar. One query per line → a batch. ⌘↵ submits;
 * ⌘K focuses (keyboard-first §14).
 */
export function CommandBar({
  onRun,
  busy,
}: {
  onRun: (inputs: SubmitInput[]) => void;
  busy: boolean;
}): React.JSX.Element {
  const [text, setText] = useState('');
  const [intent, setIntent] = useState<Intent>('general');
  const [coverage, setCoverage] = useState<CoverageProfile>('high');
  const [deepen, setDeepen] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const queries = text
    .split('\n')
    .map((q) => q.trim())
    .filter((q) => q.length > 0);

  const submit = (): void => {
    if (queries.length > 0 && !busy) onRun(queries.map((query) => ({ query, intent, coverage, deepen })));
  };

  return (
    <div className="rounded-2xl border border-line/60 bg-panel/70 p-2 shadow-glow backdrop-blur-sm">
      <div className="flex flex-col gap-2">
        <div className="relative">
          <textarea
            ref={ref}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && submit()}
            rows={Math.min(6, Math.max(2, queries.length + 1))}
            placeholder={'Research one topic per line — e.g.\ncompetitive landscape for industrial IoT sensors\nelectric vehicle battery supply chain'}
            aria-label="Research queries, one per line"
            className="w-full resize-none rounded-xl bg-surface px-4 py-3 text-sm text-ink placeholder:text-faint focus:outline-none"
          />
          <kbd className="pointer-events-none absolute right-3 top-3 rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-faint">
            ⌘K
          </kbd>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <select
            value={intent}
            onChange={(e) => setIntent(e.target.value as Intent)}
            aria-label="Intent"
            className="rounded-xl bg-surface px-3 py-2.5 text-sm text-muted focus:outline-none"
          >
            {INTENTS.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>

          <select
            value={coverage}
            onChange={(e) => setCoverage(e.target.value as CoverageProfile)}
            aria-label="Coverage profile"
            className="rounded-xl bg-surface px-3 py-2.5 text-sm text-muted focus:outline-none"
          >
            {COVERAGES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>

          <label className="flex cursor-pointer items-center gap-2 rounded-xl bg-surface px-3 py-2.5 text-sm text-muted">
            <input
              type="checkbox"
              checked={deepen}
              onChange={(e) => setDeepen(e.target.checked)}
              className="accent-[#22d3ee]"
            />
            deepen
          </label>

          <div className="flex-1" />
          <span className="px-1 text-xs text-faint">
            {queries.length} {queries.length === 1 ? 'query' : 'queries'}
          </span>
          <button
            onClick={submit}
            disabled={busy || queries.length === 0}
            className="rounded-xl bg-comet px-5 py-2.5 text-sm font-semibold text-canvas transition-opacity disabled:opacity-40"
          >
            {busy ? 'Running…' : `Run ${queries.length || ''}`.trim()}
          </button>
        </div>
      </div>
    </div>
  );
}
