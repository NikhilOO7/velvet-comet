/**
 * The Coordinator / saturation controller (PLAN.md §4) — a durable driver over
 * the core round primitives. It owns round N→N+1 decisions and checkpoints the
 * EngineState after every completed round, so:
 *
 *  • a crash/redeploy mid-run resumes from the last checkpoint (no re-spend),
 *  • duplicate submissions with the same idempotency key are deduped, and
 *  • re-processing a terminal job is a no-op (exactly-once effect).
 *
 * It drives the same `executeRound`/`decideStop`/`finalizeOutcome` primitives as
 * the synchronous engine — the only addition here is persistence. Designed to
 * port onto a durable-execution engine (Temporal/Inngest) later.
 */
import type { ResearchRequest } from '@velvet-comet/contracts';
import {
  type Clock,
  type EngineDeps,
  type EngineState,
  DEEPEN_TOP_N,
  decideStop,
  deepenOutcome,
  executeRound,
  finalizeOutcome,
  initialState,
  resolveConfig,
} from '@velvet-comet/core';
import type { JobRecord, JobStore, Lane } from './job-store.js';

export interface IdGen {
  next(): string;
}

const TERMINAL = new Set(['done', 'partial', 'failed']);

export interface SubmitResult {
  readonly id: string;
  /** True when an existing job was returned for a repeated idempotency key. */
  readonly deduped: boolean;
}

/**
 * Checkpoint/terminal event sink (PLAN.md §11 outbox flow). Called after every
 * persisted state change so consumers (e.g. the API's SSE stream) can observe
 * round-by-round progress. In-process for the demo; a durable outbox + relay in
 * production.
 */
export interface JobEvents {
  emit(record: JobRecord): void;
}

export class Coordinator {
  constructor(
    private readonly deps: EngineDeps,
    private readonly store: JobStore,
    private readonly clock: Clock,
    private readonly idGen: IdGen,
    private readonly events?: JobEvents,
  ) {}

  private async persist(record: JobRecord): Promise<void> {
    await this.store.save(record);
    this.events?.emit(record);
  }

  /** Register a job (queued). Idempotent on `request.idempotencyKey`. */
  async submit(request: ResearchRequest, lane: Lane = 'cold'): Promise<SubmitResult> {
    if (request.idempotencyKey) {
      const existing = await this.store.findByIdempotencyKey(request.idempotencyKey);
      if (existing) return { id: existing.id, deduped: true };
    }
    const now = this.clock.now();
    const record: JobRecord = {
      id: this.idGen.next(),
      request,
      status: 'queued',
      lane,
      state: initialState(),
      createdAt: now,
      updatedAt: now,
      ...(request.idempotencyKey ? { idempotencyKey: request.idempotencyKey } : {}),
    };
    await this.store.create(record);
    return { id: record.id, deduped: false };
  }

  /**
   * Drive a job to completion, resuming from its last checkpoint. Safe to call
   * again after a crash or on a terminal job.
   */
  async process(id: string): Promise<JobRecord> {
    let record = await this.store.get(id);
    if (!record) throw new Error(`job ${id} not found`);
    if (TERMINAL.has(record.status)) return record; // already done — no-op

    const { request } = record;
    const cfg = resolveConfig(request);
    let state: EngineState = record.state; // resume point

    while (state.stoppedReason === null) {
      const reason = decideStop(state, request, cfg);
      if (reason !== null) {
        state = { ...state, stoppedReason: reason };
        break;
      }
      state = await executeRound(state, request, cfg, this.deps);
      // Checkpoint after each completed round (PLAN.md §6a). A crash here loses
      // at most the *current* round's work, never an already-saved round.
      record = { ...record, state, status: 'fanning_out', updatedAt: this.clock.now() };
      await this.persist(record);
    }

    record = await this.finalize(record, state);
    await this.persist(record);
    return record;
  }

  private async finalize(record: JobRecord, state: EngineState): Promise<JobRecord> {
    const now = this.clock.now();
    if (state.fatalError !== null && state.accumulated.length === 0) {
      return {
        ...record,
        status: 'failed',
        state,
        error: { code: state.fatalError.code, message: state.fatalError.message },
        updatedAt: now,
      };
    }
    const base = finalizeOutcome(state, record.request, now);
    // Compose the second Firecrawl capability: scrape top results if requested.
    const outcome = await deepenOutcome(base, this.deps, {
      enabled: record.request.deepen,
      topN: DEEPEN_TOP_N,
    });
    return { ...record, status: outcome.status, state, outcome, updatedAt: now };
  }
}
