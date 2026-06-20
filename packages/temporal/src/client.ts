#!/usr/bin/env tsx
/**
 * Starts a research workflow and prints the outcome — the Temporal equivalent of
 * `vc research`. Requires a running Temporal server + worker.
 * Run: `pnpm --filter temporal start -- "your query" high`.
 */
import { randomUUID } from 'node:crypto';
import { Client, Connection } from '@temporalio/client';
import { ResearchRequest } from '@velvet-comet/contracts';
import { researchWorkflow, getState } from './workflows.js';
import { TASK_QUEUE } from './shared.js';

async function main(): Promise<void> {
  const query = process.argv[2] ?? 'competitive landscape for industrial IoT sensors';
  const coverage = process.argv[3] ?? 'high';
  const parsed = ResearchRequest.safeParse({ query, coverage });
  if (!parsed.success) {
    process.stderr.write(`invalid request: ${parsed.error.issues.map((i) => i.message).join('; ')}\n`);
    process.exit(2);
  }

  const connection = await Connection.connect({
    address: process.env.TEMPORAL_ADDRESS ?? 'localhost:7233',
  });
  const client = new Client({ connection });

  const handle = await client.workflow.start(researchWorkflow, {
    args: [parsed.data],
    taskQueue: TASK_QUEUE,
    workflowId: `research-${randomUUID()}`,
  });

  // eslint-disable-next-line no-console
  console.log(`started ${handle.workflowId} — querying live progress…`);
  const interval = setInterval(() => {
    handle
      .query(getState)
      .then((s) => {
        // eslint-disable-next-line no-console
        console.log(`  round ${s.round} · ${s.accumulated.length} results · ${s.creditsSpent} credits`);
      })
      .catch(() => undefined);
  }, 1000);

  const outcome = await handle.result();
  clearInterval(interval);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(outcome.coverage, null, 2));
}

main().catch((e: unknown) => {
  process.stderr.write(`client failed: ${String(e)}\n`);
  process.exit(1);
});
