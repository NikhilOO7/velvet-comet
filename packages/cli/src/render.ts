/**
 * Terminal renderer for a ResearchOutcome — the CLI surface of the §14 hero
 * view: ranked results, the saturation curve, source-class coverage, honest
 * gaps, and the authoritative credit cost.
 */
import type { ResearchOutcome } from '@velvet-comet/contracts';
import type { CostLedger } from '@velvet-comet/adapters';

const c = {
  dim: (s: string): string => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string): string => `\x1b[1m${s}\x1b[0m`,
  cyan: (s: string): string => `\x1b[36m${s}\x1b[0m`,
  green: (s: string): string => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string): string => `\x1b[33m${s}\x1b[0m`,
};

const BARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

export function render(outcome: ResearchOutcome, ledger: CostLedger, topN = 10): string {
  const cov = outcome.coverage;
  const lines: string[] = [];

  lines.push('');
  lines.push(c.bold(`  ☄  Velvet Comet — ${outcome.query}`));
  lines.push(
    c.dim(`     intent=${outcome.intent}  status=`) +
      (outcome.status === 'done' ? c.green(outcome.status) : c.yellow(outcome.status)),
  );
  lines.push('');

  lines.push(c.bold(`  Top ${Math.min(topN, outcome.results.length)} results`));
  for (const r of outcome.results.slice(0, topN)) {
    const score = r.score.toFixed(2);
    const deep = r.deepened ? c.green(' ⤓') : '';
    lines.push(
      `   ${String(r.rank).padStart(2)}. ${c.cyan(score)} ${c.dim(`[${r.sourceClass}]`)} ${r.title}${deep}`,
    );
    lines.push(`       ${c.dim(r.url)}`);
    if (r.content) {
      const oneLine = r.content.replace(/\s+/g, ' ').slice(0, 140);
      lines.push(`       ${c.dim(`“${oneLine}…”`)}`);
    }
  }
  lines.push('');

  lines.push(c.bold('  Coverage report'));
  lines.push(`   rounds: ${cov.rounds}   domains: ${cov.domainsSeen}   stopped: ${stopLabel(cov.stoppedReason)}`);
  lines.push(`   saturation: ${sparkline(cov.saturationCurve.map((p) => p.newDomains))}  ${c.dim('(new domains/round → 0 = dry)')}`);
  lines.push(`   source classes hit: ${c.green(cov.sourceClassesHit.join(', ') || '—')}`);
  if (cov.sourceClassesMissed.length > 0) {
    lines.push(`   missed: ${c.yellow(cov.sourceClassesMissed.join(', '))}`);
  }
  if (cov.gaps.length > 0) {
    lines.push(`   gaps (${cov.gaps.length}):`);
    for (const g of cov.gaps.slice(0, 5)) lines.push(c.dim(`     • [${g.sourceClass}] ${g.reason}`));
  }
  lines.push(
    `   credits (ledger): ${c.bold(String(ledger.totalCredits()))}  ` +
      c.dim(`across ${ledger.count()} calls; ${ledger.cacheHits()} cache hits; engine estimate ${cov.creditsSpent}`),
  );
  lines.push('');
  return lines.join('\n');
}

function sparkline(values: readonly number[]): string {
  if (values.length === 0) return '—';
  const max = Math.max(1, ...values);
  return values.map((v) => BARS[Math.min(BARS.length - 1, Math.round((v / max) * (BARS.length - 1)))]).join('');
}

function stopLabel(reason: string): string {
  return reason === 'saturated' ? c.green(reason) : c.yellow(reason);
}
