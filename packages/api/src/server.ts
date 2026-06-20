/**
 * HTTP surface over the durable Coordinator (PLAN.md §2 Research API).
 *
 *   POST /v1/research            submit a run. `fast` coverage → hot lane,
 *                                processed inline; otherwise → cold lane,
 *                                processed in the background (returns 202).
 *   GET  /v1/research/:id        current job state + outcome.
 *   GET  /v1/research/:id/stream SSE: round-by-round progress until terminal.
 *   POST /v1/webhooks/firecrawl  receiver for future Firecrawl batch callbacks;
 *                                acks fast (<10s) — polling is the backstop.
 *   GET  /health
 */
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { ResearchRequest, type JobStatus } from '@velvet-comet/contracts';
import type { Container } from './container.js';
import { toJobView, toProgressFrame } from './views.js';

const TERMINAL: ReadonlySet<JobStatus> = new Set(['done', 'partial', 'failed']);

export interface Server {
  readonly app: FastifyInstance;
  /** Resolves once all background jobs settle — for graceful shutdown/tests. */
  whenIdle(): Promise<void>;
}

export function buildServer(container: Container): Server {
  const app = Fastify({ logger: false });
  // Browser console runs on a different origin in dev; allow local cross-origin
  // GET/POST + SSE. Tighten to an allowlist in production.
  void app.register(cors, { origin: true });
  const { coordinator, store, events } = container;
  const inFlight = new Set<Promise<unknown>>();

  const processInBackground = (id: string): void => {
    const p = coordinator.process(id).catch((e: unknown) => {
      app.log.error({ id, err: String(e) }, 'background processing failed');
    });
    inFlight.add(p);
    void p.finally(() => inFlight.delete(p));
  };

  app.get('/health', () => ({ status: 'ok', mode: container.mode }));

  app.post('/v1/research', async (request, reply) => {
    const parsed = ResearchRequest.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_request',
        issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
    }
    const req = parsed.data;
    const hot = req.coverage === 'fast';
    const { id, deduped } = await coordinator.submit(req, hot ? 'hot' : 'cold');

    if (hot) {
      // Hot lane: process inline so callers get the answer in one round-trip.
      const record = await coordinator.process(id);
      return reply.code(200).send({ deduped, ...toJobView(record) });
    }

    // Cold lane: accept and process asynchronously (the batch path).
    if (!deduped) processInBackground(id);
    return reply.code(202).send({
      id,
      deduped,
      status: 'queued',
      stream: `/v1/research/${id}/stream`,
    });
  });

  app.get('/v1/research/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const record = await store.get(id);
    if (!record) return reply.code(404).send({ error: 'not_found' });
    return reply.send(toJobView(record));
  });

  app.get('/v1/research/:id/stream', async (request, reply) => {
    const { id } = request.params as { id: string };
    const record = await store.get(id);
    if (!record) return reply.code(404).send({ error: 'not_found' });

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    const send = (rec: Parameters<typeof toProgressFrame>[0]): void => {
      raw.write(`data: ${JSON.stringify(toProgressFrame(rec))}\n\n`);
    };

    send(record);
    if (TERMINAL.has(record.status)) {
      raw.end();
      return;
    }
    const unsubscribe = events.subscribe(id, (rec) => {
      send(rec);
      if (TERMINAL.has(rec.status)) {
        unsubscribe();
        raw.end();
      }
    });
    request.raw.on('close', unsubscribe);
  });

  app.post('/v1/webhooks/firecrawl', async (request, reply) => {
    // Ack fast (Firecrawl requires 2xx within 10s); real reconciliation is the
    // polling backstop (PLAN.md §6a) since webhooks are at-least-once/unordered.
    const body = request.body as { type?: unknown; id?: unknown } | undefined;
    if (!body || typeof body.type !== 'string') {
      return reply.code(400).send({ error: 'invalid_webhook' });
    }
    app.log.info({ type: body.type }, 'firecrawl webhook received');
    return reply.code(200).send({ ok: true });
  });

  return {
    app,
    whenIdle: async (): Promise<void> => {
      await Promise.allSettled([...inFlight]);
    },
  };
}
