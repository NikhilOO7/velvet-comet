import { describe, it, expect, beforeEach } from 'vitest';
import type { EngineDeps } from '@velvet-comet/core';
import { HeuristicExpansion, MockFirecrawlSearch, createLogger } from '@velvet-comet/adapters';
import type { IdGen } from '@velvet-comet/worker';
import { buildContainer } from './container.js';
import { buildServer, type Server } from './server.js';

function testDeps(): EngineDeps {
  return {
    search: new MockFirecrawlSearch(),
    expansion: new HeuristicExpansion(),
    clock: { now: () => 1_000 },
    logger: createLogger('test', () => undefined),
  };
}

function seqIdGen(): IdGen {
  let n = 0;
  return { next: () => `job-${++n}` };
}

let server: Server;
beforeEach(() => {
  const container = buildContainer({ deps: testDeps(), idGen: seqIdGen() });
  server = buildServer(container);
});

describe('API', () => {
  it('GET /health reports ok', async () => {
    const res = await server.app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
  });

  it('rejects an invalid research request with 400', async () => {
    const res = await server.app.inject({ method: 'POST', url: '/v1/research', payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_request' });
  });

  it('processes a fast (hot) request inline and returns the outcome', async () => {
    const res = await server.app.inject({
      method: 'POST',
      url: '/v1/research',
      payload: { query: 'industrial IoT sensors', coverage: 'fast' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      status: string;
      outcome: { coverage: { rounds: number }; results: unknown[] };
    }>();
    expect(['done', 'partial']).toContain(body.status);
    expect(body.outcome.coverage.rounds).toBe(1);
    expect(body.outcome.results.length).toBeGreaterThan(0);
  });

  it('accepts a cold (batch) request, processes in background, then is queryable', async () => {
    const res = await server.app.inject({
      method: 'POST',
      url: '/v1/research',
      payload: { query: 'competitive landscape', coverage: 'standard' },
    });
    expect(res.statusCode).toBe(202);
    const { id, status, stream } = res.json<{ id: string; status: string; stream: string }>();
    expect(status).toBe('queued');
    expect(stream).toBe(`/v1/research/${id}/stream`);

    await server.whenIdle(); // let the background job finish

    const got = await server.app.inject({ method: 'GET', url: `/v1/research/${id}` });
    expect(got.statusCode).toBe(200);
    const view = got.json<{ status: string; outcome: { coverage: { creditsSpent: number } } }>();
    expect(['done', 'partial']).toContain(view.status);
    expect(view.outcome.coverage.creditsSpent).toBeGreaterThan(0);
  });

  it('returns 404 for an unknown job', async () => {
    const res = await server.app.inject({ method: 'GET', url: '/v1/research/nope' });
    expect(res.statusCode).toBe(404);
  });

  it('acks a valid Firecrawl webhook fast and rejects malformed ones', async () => {
    const ok = await server.app.inject({
      method: 'POST',
      url: '/v1/webhooks/firecrawl',
      payload: { type: 'batch_scrape.completed', id: 'fc-1' },
    });
    expect(ok.statusCode).toBe(200);

    const bad = await server.app.inject({ method: 'POST', url: '/v1/webhooks/firecrawl', payload: {} });
    expect(bad.statusCode).toBe(400);
  });
});
