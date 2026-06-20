/**
 * Postgres-backed JobStore (PLAN.md §7) — the production durability layer, a
 * drop-in behind the same port the in-memory store implements. Decoupled from
 * any concrete driver via the minimal `Queryable` interface, so it runs against
 * a real `pg.Pool` in production and `pg-mem` in tests (no Docker).
 *
 * JSON is stored as text + explicit (de)serialization for portability across
 * drivers; we only ever look jobs up by id or idempotency key, never inside the
 * payload, so jsonb querying buys nothing here.
 */
import type { JobStatus, ResearchOutcome, ResearchRequest } from '@velvet-comet/contracts';
import type { EngineState } from '@velvet-comet/core';
import type { JobRecord, JobStore, Lane } from './job-store.js';

/** Minimal node-postgres-compatible surface (Pool/Client both satisfy it). */
export interface Queryable {
  query<R = unknown>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

const DDL = `
CREATE TABLE IF NOT EXISTS research_jobs (
  id             text PRIMARY KEY,
  idempotency_key text UNIQUE,
  status         text NOT NULL,
  lane           text NOT NULL,
  request        text NOT NULL,
  state          text NOT NULL,
  outcome        text,
  error          text,
  created_at     bigint NOT NULL,
  updated_at     bigint NOT NULL
)`;

/** Create the table if absent. Run once at startup (or via a migration tool). */
export async function ensureSchema(db: Queryable): Promise<void> {
  await db.query(DDL);
}

interface Row {
  id: string;
  idempotency_key: string | null;
  status: string;
  lane: string;
  request: string;
  state: string;
  outcome: string | null;
  error: string | null;
  created_at: string | number;
  updated_at: string | number;
}

const COLUMNS =
  'id, idempotency_key, status, lane, request, state, outcome, error, created_at, updated_at';

export class PostgresJobStore implements JobStore {
  constructor(private readonly db: Queryable) {}

  async create(record: JobRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO research_jobs (${COLUMNS}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      params(record),
    );
  }

  async save(record: JobRecord): Promise<void> {
    // Upsert: a checkpoint or terminal write for an existing job. The
    // idempotency key is immutable, so it's not updated on conflict.
    await this.db.query(
      `INSERT INTO research_jobs (${COLUMNS}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         lane = EXCLUDED.lane,
         request = EXCLUDED.request,
         state = EXCLUDED.state,
         outcome = EXCLUDED.outcome,
         error = EXCLUDED.error,
         updated_at = EXCLUDED.updated_at`,
      params(record),
    );
  }

  async get(id: string): Promise<JobRecord | null> {
    const { rows } = await this.db.query<Row>(
      `SELECT ${COLUMNS} FROM research_jobs WHERE id = $1`,
      [id],
    );
    return rows[0] ? rowToRecord(rows[0]) : null;
  }

  async findByIdempotencyKey(key: string): Promise<JobRecord | null> {
    const { rows } = await this.db.query<Row>(
      `SELECT ${COLUMNS} FROM research_jobs WHERE idempotency_key = $1`,
      [key],
    );
    return rows[0] ? rowToRecord(rows[0]) : null;
  }
}

function params(r: JobRecord): unknown[] {
  return [
    r.id,
    r.idempotencyKey ?? null,
    r.status,
    r.lane,
    JSON.stringify(r.request),
    JSON.stringify(r.state),
    r.outcome ? JSON.stringify(r.outcome) : null,
    r.error ? JSON.stringify(r.error) : null,
    r.createdAt,
    r.updatedAt,
  ];
}

function rowToRecord(row: Row): JobRecord {
  return {
    id: row.id,
    request: JSON.parse(row.request) as ResearchRequest,
    status: row.status as JobStatus,
    lane: row.lane as Lane,
    state: JSON.parse(row.state) as EngineState,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    ...(row.idempotency_key !== null ? { idempotencyKey: row.idempotency_key } : {}),
    ...(row.outcome !== null ? { outcome: JSON.parse(row.outcome) as ResearchOutcome } : {}),
    ...(row.error !== null ? { error: JSON.parse(row.error) as { code: string; message: string } } : {}),
  };
}
