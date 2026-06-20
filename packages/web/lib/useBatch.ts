'use client';

/**
 * Batch manager (PLAN.md §2/§15 #7): submit a *set* of queries and track each as
 * an independent job streaming over its own SSE connection — the surface the
 * nightly-batch customer (#1) actually needs.
 */
import { useCallback, useRef, useState } from 'react';
import type { ResearchOutcome } from '@velvet-comet/contracts';
import { submitResearch, streamUrl, type ProgressFrame, type SubmitInput } from './api';

export type JobPhase = 'submitting' | 'streaming' | 'done' | 'error';

export interface BatchJob {
  localId: number;
  input: SubmitInput;
  phase: JobPhase;
  frame?: ProgressFrame;
  outcome?: ResearchOutcome;
  error?: string;
}

const TERMINAL = new Set(['done', 'partial', 'failed']);

export function useBatch(): {
  jobs: BatchJob[];
  selectedId: number | null;
  select: (id: number) => void;
  run: (inputs: SubmitInput[]) => void;
  clear: () => void;
} {
  const [jobs, setJobs] = useState<BatchJob[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const counter = useRef(0);
  const sources = useRef<EventSource[]>([]);

  const patch = useCallback((localId: number, next: Partial<BatchJob>): void => {
    setJobs((prev) => prev.map((j) => (j.localId === localId ? { ...j, ...next } : j)));
  }, []);

  const startOne = useCallback(
    (input: SubmitInput): number => {
      const localId = counter.current++;
      setJobs((prev) => [...prev, { localId, input, phase: 'submitting' }]);

      void submitResearch(input)
        .then((res) => {
          if (res.error) return patch(localId, { phase: 'error', error: res.issues?.join('; ') ?? res.error });
          if (res.outcome) return patch(localId, { phase: 'done', outcome: res.outcome });
          if (!res.id) return patch(localId, { phase: 'error', error: 'Malformed submit response' });

          const es = new EventSource(streamUrl(res.id));
          sources.current.push(es);
          patch(localId, { phase: 'streaming' });
          es.onmessage = (ev: MessageEvent<string>): void => {
            const frame = JSON.parse(ev.data) as ProgressFrame;
            if (TERMINAL.has(frame.status)) {
              es.close();
              if (frame.outcome) patch(localId, { phase: 'done', frame, outcome: frame.outcome });
              else patch(localId, { phase: 'error', error: frame.error?.message ?? 'Job failed' });
            } else {
              patch(localId, { phase: 'streaming', frame });
            }
          };
          es.onerror = (): void => {
            es.close();
            patch(localId, { phase: 'error', error: 'Stream interrupted' });
          };
          return undefined;
        })
        .catch(() => patch(localId, { phase: 'error', error: 'Could not reach the API. Is it running?' }));

      return localId;
    },
    [patch],
  );

  const run = useCallback(
    (inputs: SubmitInput[]): void => {
      const ids = inputs.map((i) => startOne(i));
      if (ids.length > 0 && selectedId === null) setSelectedId(ids[0] ?? null);
    },
    [startOne, selectedId],
  );

  const clear = useCallback((): void => {
    sources.current.forEach((es) => es.close());
    sources.current = [];
    setJobs([]);
    setSelectedId(null);
  }, []);

  return { jobs, selectedId, select: setSelectedId, run, clear };
}
