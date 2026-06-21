#!/usr/bin/env tsx
/**
 * LIVE corroboration (PLAN.md §15 #0, path #3). Runs a REAL query through
 * Firecrawl and reports metrics that need no ground truth — distinct-domain
 * coverage, source-class coverage, and the saturation curve — against a flat
 * `/search` baseline.
 *
 * Why not recall here? Recall needs the *complete* known set of correct sources,
 * which doesn't exist for the open web. So the synthetic eval (`pnpm eval`)
 * measures recall on a controlled corpus; THIS measures real-web coverage
 * proxies that corroborate it. Together: "the mechanism works (recall +67% on a
 * known set)" + "and on a live query it surfaces N× the distinct domains a flat
 * search does."
 *
 * Gated: requires FIRECRAWL_API_KEY (skips cleanly otherwise).
 * Run: pnpm --filter @velvet-comet/eval eval:live -- "your query here"
 */
import { type EngineDeps, runCompleteness, isOk } from '@velvet-comet/core';
import {
  AnthropicExpansion,
  CircuitBreaker,
  CostLedger,
  FirecrawlSearch,
  HeuristicExpansion,
  InMemorySearchCache,
  Semaphore,
  TokenBucket,
  createLogger,
  loadEnv,
} from '@velvet-comet/adapters';
import { domainsOf, headTailRatio } from './metrics.js';

const LONG_TAIL = new Set(['trade', 'forum', 'regional', 'research', 'news']);
const BARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

function sparkline(values: readonly number[]): string {
  if (values.length === 0) return '—';
  const max = Math.max(1, ...values);
  return values.map((v) => BARS[Math.min(7, Math.round((v / max) * 7))]).join('');
}

async function main(): Promise<number> {
  const env = loadEnv();
  if (!env.FIRECRAWL_API_KEY) {
    process.stdout.write(
      '\n  eval:live is gated — set FIRECRAWL_API_KEY to run a real Firecrawl query.\n' +
        '  (The synthetic recall eval runs offline: pnpm --filter eval eval)\n\n',
    );
    return 0;
  }

  const query = process.argv.slice(2).filter((t) => t !== '--').join(' ') ||
    'competitive landscape for industrial IoT sensors';

  const logger = createLogger('eval-live', () => undefined);
  const ledger = new CostLedger();
  const search = new FirecrawlSearch({
    baseUrl: env.FIRECRAWL_BASE_URL,
    apiKey: env.FIRECRAWL_API_KEY,
    rateLimiter: new TokenBucket(env.FIRECRAWL_MAX_CONCURRENCY, env.FIRECRAWL_RPM / 60),
    concurrency: new Semaphore(env.FIRECRAWL_MAX_CONCURRENCY),
    breaker: new CircuitBreaker(),
    ledger,
    logger,
    cache: new InMemorySearchCache(),
  });
  const expansion = env.ANTHROPIC_API_KEY
    ? new AnthropicExpansion({ apiKey: env.ANTHROPIC_API_KEY, logger })
    : new HeuristicExpansion();
  const deps: EngineDeps = { search, expansion, clock: { now: () => Date.now() }, logger };

  process.stdout.write(`\n  Live coverage — "${query}"\n  ${'─'.repeat(60)}\n`);

  // Baseline: the STRONGEST flat search Firecrawl allows — a single bare query at
  // limit 100 (the API max). Deliberately the hardest baseline to beat, so the
  // "novel domains" number can't be dismissed as a weak strawman.
  const flat = await search.search({ query, limit: 100, round: 1 });
  const baseDomains = isOk(flat) ? domainsOf(flat.value) : new Set<string>();
  const baseClasses = isOk(flat) ? new Set(flat.value.map((r) => r.sourceClass)) : new Set<string>();

  // Engine: full completeness run.
  const result = await runCompleteness(
    { query, intent: 'general', coverage: 'high', deepen: false },
    deps,
  );
  if (!isOk(result)) {
    process.stdout.write(`  engine run failed: ${result.error.code} — ${result.error.message}\n\n`);
    return 1;
  }
  const { results, coverage } = result.value;
  const engineDomains = domainsOf(results);
  // The honest completeness metric on live web: domains the engine surfaced that
  // a flat /search of the bare query did NOT (raw count is unfair — the engine
  // caps per-domain and uses a smaller per-query limit on purpose).
  const novel = [...engineDomains].filter((d) => !baseDomains.has(d));
  const novelTail = results.filter(
    (r) => !baseDomains.has(r.domain) && LONG_TAIL.has(r.sourceClass),
  );
  const novelTailDomains = new Set(novelTail.map((r) => r.domain)).size;

  const row = (label: string, value: string): void => {
    process.stdout.write(`  ${label.padEnd(36)}${value}\n`);
  };

  process.stdout.write('  FLAT /search baseline (one bare query, limit 100 = API max)\n');
  row('  distinct domains', String(baseDomains.size));
  row('  source classes', `${baseClasses.size}`);
  process.stdout.write(`  ${'·'.repeat(58)}\n`);
  process.stdout.write('  ENGINE (expand → fan-out → diversify → saturate)\n');
  row('  distinct domains', `${engineDomains.size}  (per-domain capped on purpose)`);
  row('  source classes hit', `${coverage.sourceClassesHit.length}  [${coverage.sourceClassesHit.join(', ')}]`);
  row('  long-tail share', `${Math.round(headTailRatio(results) * 100)}%`);
  row('  rounds', `${coverage.rounds}  (stopped: ${coverage.stoppedReason})`);
  row('  saturation curve', `${sparkline(coverage.saturationCurve.map((p) => p.newDomains))}  (new domains/round → 0 = dry)`);
  process.stdout.write(`  ${'─'.repeat(58)}\n`);
  process.stdout.write('  COMPLETENESS — what the flat search MISSED\n');
  row('  novel domains (engine ∖ flat)', `${novel.length}  of ${engineDomains.size}`);
  row('  …of which long-tail', `${novelTailDomains}  (trade/forum/regional/research/news)`);
  row('  Firecrawl credits (ledger)', `${ledger.totalCredits()}  across ${ledger.count()} calls, ${ledger.cacheHits()} cache hits`);

  process.stdout.write(
    `\n  → No ground truth on the open web, so this reports COVERAGE proxies, not recall.\n` +
      `    The headline number is NOVEL domains — sources the engine surfaced that a flat\n` +
      `    /search of the bare query did not. Raw domain count is unfair: the engine caps\n` +
      `    per-domain and uses limit 10/sub-query to trade head-redundancy for diversity.\n\n`,
  );
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    process.stderr.write(`eval:live failed: ${String(e)}\n`);
    process.exit(1);
  });
