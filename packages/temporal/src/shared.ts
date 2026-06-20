/**
 * Shared contract between the workflow (sandbox) and the activities (Node).
 * Only TYPE imports from core/contracts so this is safe to import from workflow
 * code, which runs in Temporal's deterministic sandbox.
 */
import type { EngineState } from '@velvet-comet/core';
import type { ResearchOutcome, ResearchRequest } from '@velvet-comet/contracts';

export const TASK_QUEUE = 'velvet-comet-research';

export interface RunRoundInput {
  readonly state: EngineState;
  readonly request: ResearchRequest;
}

export interface DeepenInput {
  readonly outcome: ResearchOutcome;
  readonly request: ResearchRequest;
}

/** Activity surface the workflow proxies. */
export interface ResearchActivities {
  /** One round of search I/O. */
  runRound(input: RunRoundInput): Promise<EngineState>;
  /** Scrape top results (composes /search + /scrape) when requested. */
  deepen(input: DeepenInput): Promise<ResearchOutcome>;
}
