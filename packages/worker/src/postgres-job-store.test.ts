import { describe, it, expect } from 'vitest';
import { newDb } from 'pg-mem';
import type { ResearchRequest } from '@velvet-comet/contracts';
import { initialState } from '@velvet-comet/core';
import { PostgresJobStore, ensureSchema, type Queryable } from './postgres-job-store.js';
import type { JobRecord } from './job-store.js';
import { Coordinator } from './coordinator.js';
import { CountingSearch, SeqIdGen, deps, fixedClock } from './test-helpers.js';

interface PgMemAdapter {
  Pool: new () => Queryable;
}

/** A fresh pg-mem database; `pool()` returns independent pools over the same db. */
function freshPg(): { pool: () => Queryable } {
  const db = newDb();
  const adapter: PgMemAdapter = db.adapters.createPg();
  return { pool: () => new adapter.Pool() };
}

async function freshStore(): Promise<{ store: PostgresJobStore; pool: () => Queryable }> {
  const { pool } = freshPg();
  const db = pool();
  await ensureSchema(db);
  return { store: new PostgresJobStore(db), pool };
}

function makeRecord(id: string, extra: Partial<JobRecord> = {}): JobRecord {
  return {
    id,
    request: { query: 'q', intent: 'general', coverage: 'standard', deepen: false },
    status: 'queued',
    lane: 'cold',
    state: initialState(),
    createdAt: 1000,
    updatedAt: 1000,
    ...extra,
  };
}

describe('PostgresJobStore (pg-mem)', () => {
  it('round-trips a record through JSON columns', async () => {
    const { store } = await freshStore();
    const rec = makeRecord('job-1');
    await store.create(rec);
    expect(await store.get('job-1')).toEqual(rec);
  });

  it('upserts checkpoints via save()', async () => {
    const { store } = await freshStore();
    const rec = makeRecord('job-2');
    await store.create(rec);
    await store.save({
      ...rec,
      status: 'fanning_out',
      state: { ...rec.state, round: 3, creditsSpent: 15 },
      updatedAt: 2000,
    });
    const got = await store.get('job-2');
    expect(got?.status).toBe('fanning_out');
    expect(got?.state.round).toBe(3);
    expect(got?.state.creditsSpent).toBe(15);
  });

  it('finds by idempotency key and returns null for unknowns', async () => {
    const { store } = await freshStore();
    await store.create(makeRecord('job-3', { idempotencyKey: 'key-1' }));
    expect((await store.findByIdempotencyKey('key-1'))?.id).toBe('job-3');
    expect(await store.findByIdempotencyKey('missing')).toBeNull();
    expect(await store.get('missing')).toBeNull();
  });

  it('survives a process restart — a fresh store over the same db sees persisted jobs', async () => {
    const { pool } = freshPg();
    const boot = pool();
    await ensureSchema(boot);

    const store1 = new PostgresJobStore(boot);
    const rec = makeRecord('job-4');
    await store1.create(rec);
    await store1.save({ ...rec, status: 'done', updatedAt: 3000 });

    // "Restart": brand-new pool + store object, same underlying database.
    const store2 = new PostgresJobStore(pool());
    const recovered = await store2.get('job-4');
    expect(recovered?.status).toBe('done');
  });

  it('drives a Coordinator run durably; a fresh store reads back the finished job', async () => {
    const { pool } = freshPg();
    const boot = pool();
    await ensureSchema(boot);
    const clock = fixedClock();
    const store = new PostgresJobStore(boot);
    const coord = new Coordinator(deps(new CountingSearch(), clock), store, clock, new SeqIdGen());

    const request: ResearchRequest = { query: 'q', intent: 'general', coverage: 'standard', deepen: false };
    const { id } = await coord.submit(request, 'cold');
    const finished = await coord.process(id);
    expect(finished.status).toBe('done');

    const afterRestart = await new PostgresJobStore(pool()).get(id);
    expect(afterRestart?.status).toBe('done');
    expect(afterRestart?.outcome?.coverage.rounds).toBe(4);
  });
});
