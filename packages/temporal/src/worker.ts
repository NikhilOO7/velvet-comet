#!/usr/bin/env tsx
/**
 * Temporal worker — hosts the workflow + activities. Requires a running Temporal
 * server (e.g. `temporal server start-dev`). Run: `pnpm --filter temporal worker`.
 */
import { NativeConnection, Worker } from '@temporalio/worker';
import { createRequire } from 'node:module';
import { buildDepsFromEnv, createActivities } from './activities.js';
import { TASK_QUEUE } from './shared.js';

const require = createRequire(import.meta.url);

async function main(): Promise<void> {
  const address = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
  const connection = await NativeConnection.connect({ address });

  const worker = await Worker.create({
    connection,
    taskQueue: TASK_QUEUE,
    workflowsPath: require.resolve('./workflows.js'),
    activities: createActivities(buildDepsFromEnv()),
  });

  // eslint-disable-next-line no-console
  console.log(`velvet-comet temporal worker polling ${TASK_QUEUE} @ ${address}`);
  await worker.run();
}

main().catch((e: unknown) => {
  process.stderr.write(`worker failed: ${String(e)}\n`);
  process.exit(1);
});
