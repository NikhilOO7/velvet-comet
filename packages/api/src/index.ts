#!/usr/bin/env tsx
/** Entry point — boots the API server. Uses Postgres when DATABASE_URL is set. */
import pg from 'pg';
import { PostgresJobStore, ensureSchema, type JobStore } from '@velvet-comet/worker';
import { buildContainer, type ContainerOptions } from './container.js';
import { buildServer } from './server.js';

const PORT = Number(process.env.PORT ?? 3000);

async function buildStore(): Promise<JobStore | undefined> {
  const url = process.env.DATABASE_URL;
  if (!url) return undefined;
  const pool = new pg.Pool({ connectionString: url });
  await ensureSchema(pool);
  return new PostgresJobStore(pool);
}

async function main(): Promise<void> {
  const store = await buildStore();
  const opts: ContainerOptions = store ? { store } : {};
  const container = buildContainer(opts);
  const { app } = buildServer(container);
  await app.listen({ port: PORT, host: '0.0.0.0' });
  // eslint-disable-next-line no-console
  console.log(
    `velvet-comet api on http://localhost:${PORT}  ` +
      `search=${container.mode.search} store=${container.mode.store}`,
  );
}

main().catch((e: unknown) => {
  process.stderr.write(`failed to start: ${String(e)}\n`);
  process.exit(1);
});
