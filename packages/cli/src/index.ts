#!/usr/bin/env tsx
/**
 * `vc research "<query>" [--intent ...] [--coverage ...] [--max-rounds N]
 * [--budget N]` — drives the pure engine through the composition root and
 * renders the outcome. A real product surface, not a JSON printer.
 */
import { ResearchRequest } from '@velvet-comet/contracts';
import { runCompleteness, isErr } from '@velvet-comet/core';
import { wire } from './wiring.js';
import { render } from './render.js';

async function main(): Promise<number> {
  // Drop any literal `--` separators forwarded by the package manager.
  const argv = process.argv.slice(2).filter((t) => t !== '--');
  if (argv[0] !== 'research' || argv.length < 2) {
    process.stderr.write(usage());
    return 2;
  }

  const flags = parseFlags(argv.slice(1));
  const parsed = ResearchRequest.safeParse({
    query: flags.query,
    intent: flags.intent,
    coverage: flags.coverage,
    deepen: flags.deepen,
    ...(flags.maxRounds !== undefined ? { maxRounds: flags.maxRounds } : {}),
    ...(flags.budget !== undefined ? { creditBudget: flags.budget } : {}),
  });
  if (!parsed.success) {
    process.stderr.write(`Invalid request: ${parsed.error.issues.map((i) => i.message).join('; ')}\n`);
    return 2;
  }

  const correlationId = `cli-${process.pid}-${Date.now()}`;
  const { deps, ledger, mode } = wire(correlationId);
  process.stderr.write(
    `\x1b[2m  search=${mode.search}  expansion=${mode.expansion}  (set FIRECRAWL_API_KEY / ANTHROPIC_API_KEY for live)\x1b[0m\n`,
  );

  const result = await runCompleteness(parsed.data, deps);
  if (isErr(result)) {
    process.stderr.write(`\nResearch failed [${result.error.code}]: ${result.error.message}\n`);
    return 1;
  }

  process.stdout.write(render(result.value, ledger));
  return 0;
}

interface Flags {
  query: string;
  intent: string | undefined;
  coverage: string | undefined;
  maxRounds: number | undefined;
  budget: number | undefined;
  deepen: boolean;
}

function parseFlags(tokens: string[]): Flags {
  const flags: Flags = {
    query: '',
    intent: undefined,
    coverage: undefined,
    maxRounds: undefined,
    budget: undefined,
    deepen: false,
  };
  const positional: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    switch (token) {
      case '--intent':
        flags.intent = tokens[++i];
        break;
      case '--coverage':
        flags.coverage = tokens[++i];
        break;
      case '--max-rounds':
        flags.maxRounds = Number(tokens[++i]);
        break;
      case '--budget':
        flags.budget = Number(tokens[++i]);
        break;
      case '--deepen':
        flags.deepen = true;
        break;
      default:
        if (token !== undefined) positional.push(token);
    }
  }
  flags.query = positional.join(' ');
  return flags;
}

function usage(): string {
  return [
    'Usage:',
    '  vc research "<query>" [--intent news|research|buying|general]',
    '                        [--coverage fast|standard|high]',
    '                        [--max-rounds N] [--budget CREDITS] [--deepen]',
    '',
  ].join('\n');
}

main()
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    process.stderr.write(`Unexpected error: ${String(e)}\n`);
    process.exit(1);
  });
