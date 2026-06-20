/**
 * Durable job state + persistence port (PLAN.md §4, §11 repository pattern).
 * The Coordinator checkpoints an EngineState here after every round; a crash
 * resumes from the last saved checkpoint instead of re-spending credits.
 *
 * The in-memory implementation backs the demo and tests; the production swap is
 * a Postgres-backed store behind the same interface (the `research_job` /
 * `sub_query` / `result` tables in PLAN.md §7).
 */
import type { JobStatus, ResearchOutcome, ResearchRequest } from '@velvet-comet/contracts';
import type { EngineState } from '@velvet-comet/core';

export type Lane = 'hot' | 'cold';

export interface JobRecord {
  readonly id: string;
  readonly request: ResearchRequest;
  readonly status: JobStatus;
  readonly lane: Lane;
  /** Last checkpointed engine state — the resume point. */
  readonly state: EngineState;
  readonly idempotencyKey?: string;
  readonly outcome?: ResearchOutcome;
  readonly error?: { code: string; message: string };
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface JobStore {
  create(record: JobRecord): Promise<void>;
  get(id: string): Promise<JobRecord | null>;
  /** Upsert a checkpoint/terminal state for an existing job. */
  save(record: JobRecord): Promise<void>;
  findByIdempotencyKey(key: string): Promise<JobRecord | null>;
}

/** In-memory store. Records are frozen on write so callers can't mutate state. */
export class InMemoryJobStore implements JobStore {
  private readonly jobs = new Map<string, JobRecord>();
  private readonly byKey = new Map<string, string>();

  create(record: JobRecord): Promise<void> {
    if (this.jobs.has(record.id)) throw new Error(`job ${record.id} already exists`);
    this.jobs.set(record.id, Object.freeze({ ...record }));
    if (record.idempotencyKey) this.byKey.set(record.idempotencyKey, record.id);
    return Promise.resolve();
  }

  get(id: string): Promise<JobRecord | null> {
    return Promise.resolve(this.jobs.get(id) ?? null);
  }

  save(record: JobRecord): Promise<void> {
    this.jobs.set(record.id, Object.freeze({ ...record }));
    return Promise.resolve();
  }

  findByIdempotencyKey(key: string): Promise<JobRecord | null> {
    const id = this.byKey.get(key);
    return Promise.resolve(id ? (this.jobs.get(id) ?? null) : null);
  }
}
