/**
 * The research workflow — the Temporal port of the Coordinator (PLAN.md §4/§5).
 *
 * This is the *same* saturation loop as the hand-rolled coordinator, but here
 * durability is free: Temporal event-sources every step, so a worker crash
 * resumes the workflow exactly where it left off with NO manual checkpointing.
 * The round loop is just code. Only pure functions run in the sandbox; the one
 * I/O step (`runRound`) is dispatched to an activity.
 *
 * Runs in Temporal's deterministic sandbox — imports only pure core helpers and
 * type-only activity definitions.
 */
import { ApplicationFailure, defineQuery, proxyActivities, setHandler } from '@temporalio/workflow';
import {
  decideStop,
  finalizeOutcome,
  initialState,
  resolveConfig,
  type EngineState,
} from '@velvet-comet/core';
import type { ResearchOutcome, ResearchRequest } from '@velvet-comet/contracts';
import type { ResearchActivities } from './shared.js';

const { runRound, deepen } = proxyActivities<ResearchActivities>({
  startToCloseTimeout: '5 minutes',
  // Temporal retries the whole round on transient failure; our chokepoint still
  // handles fine-grained per-call retries inside the activity.
  retry: { maximumAttempts: 4, initialInterval: '2s', backoffCoefficient: 2 },
});

/** Live progress query — the Temporal equivalent of the API's SSE stream. */
export const getState = defineQuery<EngineState>('getState');

export async function researchWorkflow(request: ResearchRequest): Promise<ResearchOutcome> {
  const cfg = resolveConfig(request);
  let state: EngineState = initialState();
  setHandler(getState, () => state);

  while (state.stoppedReason === null) {
    const reason = decideStop(state, request, cfg);
    if (reason !== null) {
      state = { ...state, stoppedReason: reason };
      break;
    }
    // Durable: this result is persisted in workflow history. On replay after a
    // crash, completed rounds return instantly from history — never re-run.
    state = await runRound({ state, request });
  }

  if (state.fatalError !== null && state.accumulated.length === 0) {
    throw ApplicationFailure.nonRetryable(state.fatalError.message, state.fatalError.code);
  }
  // Date.now() is deterministic inside a Temporal workflow.
  const outcome = finalizeOutcome(state, request, Date.now());
  // Deepen runs as an activity (it does I/O — not allowed in the sandbox).
  return request.deepen ? deepen({ outcome, request }) : outcome;
}
