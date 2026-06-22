/**
 * Resumable engine state + the single-round step (PLAN.md §4 coordinator).
 *
 * The whole completeness loop is expressed as: a serializable `EngineState`, a
 * pure `decideStop`, and one `executeRound` that advances the state by exactly
 * one round. Both the synchronous `runCompleteness` (engine.ts) and the durable
 * Coordinator (worker package) drive these same primitives — the Coordinator
 * just persists `EngineState` after each round so a crash resumes mid-run
 * instead of re-spending credits. No loop logic is duplicated.
 */
import type {
  CoverageProfile,
  CoverageGap,
  ResearchRequest,
  ResearchOutcome,
  SaturationPoint,
  SearchResultItem,
} from '@velvet-comet/contracts';
import type { EngineDeps } from './ports.js';
import type { EngineError } from './errors.js';
import { isErr } from './result.js';
import { mergeResults } from './merge.js';
import { rerank } from './rerank.js';
import {
  distinctDomains,
  missingClasses,
  saturationPoint,
  sourceClassesHit,
  ALL_SOURCE_CLASSES,
} from './coverage.js';

export type StoppedReason =
  | 'saturated'
  | 'max_rounds'
  | 'credit_budget'
  | 'credits_exhausted'
  | 'error';

/** Serializable snapshot of an in-flight research run — the checkpoint unit. */
export interface EngineState {
  /** Number of completed rounds (0 = not started). */
  readonly round: number;
  readonly accumulated: readonly SearchResultItem[];
  readonly saturationCurve: readonly SaturationPoint[];
  readonly gaps: readonly CoverageGap[];
  readonly creditsSpent: number;
  /** Non-null once the run has decided to stop. */
  readonly stoppedReason: StoppedReason | null;
  /** Set only on a fatal round-1 expansion failure with nothing banked. */
  readonly fatalError: EngineError | null;
}

export interface ProfileConfig {
  readonly maxRounds: number;
  readonly expansionCount: number;
  readonly perDomainCap: number;
  readonly searchLimit: number;
}

// Raising `limit` returns more of the same head (customer #1), so per-query
// limits stay modest; breadth comes from expansion + rounds instead.
const PROFILES: Record<CoverageProfile, ProfileConfig> = {
  fast: { maxRounds: 1, expansionCount: 3, perDomainCap: 2, searchLimit: 10 },
  standard: { maxRounds: 4, expansionCount: 5, perDomainCap: 3, searchLimit: 10 },
  high: { maxRounds: 8, expansionCount: 8, perDomainCap: 5, searchLimit: 10 },
};

/** Estimate used only for in-engine budget enforcement; the authoritative */
/** credit ledger lives in the Firecrawl adapter (firecrawl_call table). */
export const ESTIMATED_CREDITS_PER_SEARCH = 1;

export function initialState(): EngineState {
  return {
    round: 0,
    accumulated: [],
    saturationCurve: [],
    gaps: [],
    creditsSpent: 0,
    stoppedReason: null,
    fatalError: null,
  };
}

export function resolveConfig(request: ResearchRequest): ProfileConfig {
  const base = PROFILES[request.coverage] ?? PROFILES.standard;
  return {
    ...base,
    maxRounds: request.maxRounds ?? base.maxRounds,
    perDomainCap: request.perDomainCap ?? base.perDomainCap,
  };
}

/**
 * Pure between-rounds stop check. Returns a reason to stop, or null to continue.
 * Saturation only triggers after round 1 so a single dry round can't end the run
 * before any breadth is attempted.
 */
export function decideStop(
  state: EngineState,
  request: ResearchRequest,
  cfg: ProfileConfig,
): StoppedReason | null {
  if (state.stoppedReason !== null) return state.stoppedReason;
  if (state.round >= cfg.maxRounds) return 'max_rounds';
  if (request.creditBudget !== undefined && state.creditsSpent >= request.creditBudget) {
    return 'credit_budget';
  }
  const last = state.saturationCurve[state.saturationCurve.length - 1];
  if (state.round > 1 && last && last.newDomains === 0) return 'saturated';
  return null;
}

/**
 * Advance the run by one round (the only I/O step): expand → fan-out search →
 * diversity-merge → record saturation. Returns the next EngineState; never
 * throws for expected failures — they become gaps or a stoppedReason.
 */
export async function executeRound(
  state: EngineState,
  request: ResearchRequest,
  cfg: ProfileConfig,
  deps: EngineDeps,
): Promise<EngineState> {
  const round = state.round + 1;
  const domainsBefore = distinctDomains(state.accumulated);

  const expansion = await deps.expansion.expand({
    query: request.query,
    intent: request.intent,
    missingClasses: missingClasses(state.accumulated),
    count: cfg.expansionCount,
  });

  if (isErr(expansion)) {
    // Round-1 failure with nothing banked is fatal; later rounds degrade to
    // partial — we keep what we have (PLAN.md §6).
    if (round === 1 && state.accumulated.length === 0) {
      return { ...state, fatalError: expansion.error, stoppedReason: 'error' };
    }
    deps.logger.warn('expansion failed mid-run; finalizing partial', {
      round,
      code: expansion.error.code,
    });
    return {
      ...state,
      gaps: [...state.gaps, { sourceClass: 'other', reason: `expansion failed at round ${round}` }],
      stoppedReason: 'error',
    };
  }

  const gaps: CoverageGap[] = [...state.gaps];
  const roundItems: SearchResultItem[] = [];
  let creditsSpent = state.creditsSpent;
  let budgetHit = false;
  let creditsExhausted = false;

  for (const subQuery of expansion.value) {
    if (
      request.creditBudget !== undefined &&
      creditsSpent + ESTIMATED_CREDITS_PER_SEARCH > request.creditBudget
    ) {
      budgetHit = true;
      break;
    }
    const searchResult = await deps.search.search({
      query: subQuery.text,
      limit: cfg.searchLimit,
      round,
    });
    creditsSpent += ESTIMATED_CREDITS_PER_SEARCH;

    if (isErr(searchResult)) {
      // Out of Firecrawl credits: stop early — every remaining call would fail
      // too. Keep everything gathered so far and finalize as partial.
      if (searchResult.error.code === 'CREDITS_EXHAUSTED') {
        gaps.push({ sourceClass: 'other', reason: 'Firecrawl credits exhausted — returning partial results' });
        creditsExhausted = true;
        break;
      }
      gaps.push({ sourceClass: subQuery.targetClass, reason: `${searchResult.error.code}: ${searchResult.error.message}` });
      continue;
    }
    if (searchResult.value.length === 0) {
      gaps.push({ sourceClass: subQuery.targetClass, reason: 'no results for sub-query' });
      continue;
    }
    roundItems.push(...searchResult.value);
  }

  const merged = mergeResults(state.accumulated, roundItems, cfg.perDomainCap);
  const accumulated = merged.kept;
  const point = saturationPoint(round, domainsBefore, distinctDomains(accumulated));

  deps.logger.info('round complete', {
    round,
    newDomains: point.newDomains,
    total: accumulated.length,
    nearDupes: merged.nearDupes,
    domainCapped: merged.domainCapped,
  });

  return {
    round,
    accumulated,
    saturationCurve: [...state.saturationCurve, point],
    gaps,
    creditsSpent,
    stoppedReason: creditsExhausted ? 'credits_exhausted' : budgetHit ? 'credit_budget' : null,
    fatalError: null,
  };
}

/** Turn a finished EngineState into the caller-facing outcome (rerank + report). */
export function finalizeOutcome(
  state: EngineState,
  request: ResearchRequest,
  now: number,
): ResearchOutcome {
  const ranked = rerank(state.accumulated, request.query, request.intent, now);
  const hit = sourceClassesHit(state.accumulated);
  const hitSet = new Set(hit);
  const stoppedReason: StoppedReason = state.stoppedReason ?? 'max_rounds';

  return {
    status: state.gaps.length > 0 ? 'partial' : 'done',
    query: request.query,
    intent: request.intent,
    results: ranked,
    coverage: {
      rounds: state.round,
      domainsSeen: distinctDomains(state.accumulated).size,
      sourceClassesHit: hit,
      sourceClassesMissed: ALL_SOURCE_CLASSES.filter((c) => !hitSet.has(c)),
      saturationCurve: [...state.saturationCurve],
      gaps: [...state.gaps],
      creditsSpent: state.creditsSpent,
      saturated: stoppedReason === 'saturated',
      stoppedReason,
    },
  };
}
