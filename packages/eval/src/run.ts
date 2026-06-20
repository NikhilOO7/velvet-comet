#!/usr/bin/env tsx
/** Prints the completeness eval report. Run: `pnpm --filter eval eval`. */
import { evaluate } from './evaluate.js';

const pct = (n: number): string => `${(n * 100).toFixed(0)}%`.padStart(4);

async function main(): Promise<void> {
  const report = await evaluate();

  process.stdout.write('\n  Completeness eval — engine vs. flat /search baseline\n');
  process.stdout.write('  ' + '─'.repeat(64) + '\n');
  process.stdout.write('  topic            truth  baseline  engine   lift   classes\n');
  for (const r of report.perTopic) {
    process.stdout.write(
      `  ${r.id.padEnd(15)} ${String(r.truthSize).padStart(4)}   ${pct(r.baselineRecall)}     ${pct(r.engineRecall)}   +${pct(r.lift)}   ${pct(r.classCoverage)}\n`,
    );
  }
  process.stdout.write('  ' + '─'.repeat(64) + '\n');
  const a = report.aggregate;
  process.stdout.write(
    `  ${'AVERAGE'.padEnd(15)}        ${pct(a.baselineRecall)}     ${pct(a.engineRecall)}   +${pct(a.lift)}   ${pct(a.classCoverage)}\n\n`,
  );
  process.stdout.write(
    `  → the engine surfaces ${pct(a.lift)} more of the known sources than a flat search.\n\n`,
  );
}

main().catch((e: unknown) => {
  process.stderr.write(`eval failed: ${String(e)}\n`);
  process.exit(1);
});
