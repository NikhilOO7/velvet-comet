/**
 * The completeness engine (PLAN.md §3) — synchronous, all-in-one driver.
 *
 * A thin loop over the resumable primitives in progress.ts: check stop → run a
 * round → repeat → finalize. The durable Coordinator (worker package) runs the
 * exact same primitives but persists EngineState between rounds. Given the same
 * inputs and injected ports this produces the same outcome, which is what makes
 * it unit-testable without a network.
 */
import type { ResearchRequest, ResearchOutcome } from '@velvet-comet/contracts';
import type { EngineDeps } from './ports.js';
import type { EngineError } from './errors.js';
import { type Result, ok, err } from './result.js';
import {
  decideStop,
  executeRound,
  finalizeOutcome,
  initialState,
  resolveConfig,
  type EngineState,
} from './progress.js';
import { DEEPEN_TOP_N, deepenOutcome } from './deepen.js';

export async function runCompleteness(
  request: ResearchRequest,
  deps: EngineDeps,
): Promise<Result<ResearchOutcome, EngineError>> {
  const cfg = resolveConfig(request);
  let state: EngineState = initialState();

  while (state.stoppedReason === null) {
    const reason = decideStop(state, request, cfg);
    if (reason !== null) {
      state = { ...state, stoppedReason: reason };
      break;
    }
    state = await executeRound(state, request, cfg, deps);
  }

  if (state.fatalError !== null && state.accumulated.length === 0) {
    return err(state.fatalError);
  }
  const outcome = finalizeOutcome(state, request, deps.clock.now());
  return ok(await deepenOutcome(outcome, deps, { enabled: request.deepen, topN: DEEPEN_TOP_N }));
}
