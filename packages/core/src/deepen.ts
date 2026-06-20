/**
 * The deepen step (PLAN.md §3 step ⑤+, §15 #11) — composes a *second* Firecrawl
 * capability: after ranking, scrape full content for the top-N results so the
 * caller gets substance, not just snippets. Budget-conscious (only top-N) and
 * non-fatal: a failed scrape leaves that result at snippet level, never breaks
 * the run.
 */
import type { ResearchOutcome } from '@velvet-comet/contracts';
import type { EngineDeps } from './ports.js';
import { isErr } from './result.js';

/** Default number of top results to scrape when deepening is enabled. */
export const DEEPEN_TOP_N = 5;
const EXCERPT_CHARS = 800;

export async function deepenOutcome(
  outcome: ResearchOutcome,
  deps: EngineDeps,
  opts: { enabled: boolean; topN: number },
): Promise<ResearchOutcome> {
  const scrape = deps.scrape;
  if (!opts.enabled || !scrape || outcome.results.length === 0) return outcome;

  const top = outcome.results.slice(0, opts.topN);
  const rest = outcome.results.slice(opts.topN);

  const deepened = await Promise.all(
    top.map(async (r) => {
      const res = await scrape.scrape(r.url);
      if (isErr(res)) {
        deps.logger.warn('deepen scrape failed; leaving snippet-level', { url: r.url, code: res.error.code });
        return r;
      }
      return { ...r, content: excerpt(res.value.markdown), deepened: true };
    }),
  );

  return { ...outcome, results: [...deepened, ...rest] };
}

function excerpt(markdown: string): string {
  const trimmed = markdown.trim();
  return trimmed.length > EXCERPT_CHARS ? `${trimmed.slice(0, EXCERPT_CHARS)}…` : trimmed;
}
