/**
 * Deterministic offline SearchPort for demos/tests. Simulates the real-world
 * shape customer #1 describes: a handful of SEO "head" domains that recur every
 * round (and get deduped/capped away), plus long-tail domains keyed to each
 * sub-query's angle that taper off — producing a believable saturation curve.
 */
import type { SearchResultItem, SourceClass } from '@velvet-comet/contracts';
import { type SearchPort, type Result, ok, classifySource, simhash } from '@velvet-comet/core';
import type { EngineError } from '@velvet-comet/core';

const HEAD_DOMAINS = ['bigblog.com', 'wikipedia.org', 'medium.com'];

const CLASS_TLD: Record<SourceClass, string> = {
  web: 'example.com',
  news: 'gazette-news.com',
  trade: 'industry-trade-journal.com',
  forum: 'community-forum.com',
  regional: 'example.de',
  research: 'arxiv.org',
  other: 'misc.example',
};

export class MockFirecrawlSearch implements SearchPort {
  search(input: {
    query: string;
    limit: number;
    round: number;
  }): Promise<Result<readonly SearchResultItem[], EngineError>> {
    const items: SearchResultItem[] = [];

    // Head domains: same URLs every round → exercise dedup + per-domain cap.
    for (const domain of HEAD_DOMAINS) {
      const url = `https://${domain}/${slug(input.query)}`;
      items.push(makeItem(url, input.query, input.round, 'web'));
    }

    // Long-tail: a class-targeted domain plus a query-hash-derived subdomain.
    // The hash repeats as queries converge, so new domains taper to zero.
    const cls = inferClass(input.query);
    const tailHost = `${hashToken(input.query)}.${CLASS_TLD[cls]}`;
    items.push(makeItem(`https://${tailHost}/article`, input.query, input.round, cls));

    return Promise.resolve(ok(items.slice(0, input.limit)));
  }
}

function makeItem(
  url: string,
  query: string,
  round: number,
  hinted: SourceClass,
): SearchResultItem {
  const title = `${query} — ${hostOf(url)}`;
  const snippet = `Result about ${query} from ${hostOf(url)} (round ${round}).`;
  return {
    url,
    domain: hostOf(url),
    title,
    snippet,
    sourceClass: classifySource(url, hinted),
    contentHash: simhash(`${title} ${snippet}`),
    foundInRound: round,
  };
}

function inferClass(query: string): SourceClass {
  const q = query.toLowerCase();
  if (q.includes('forum')) return 'forum';
  if (q.includes('trade')) return 'trade';
  if (q.includes('news')) return 'news';
  if (q.includes('regional') || q.includes('local')) return 'regional';
  if (q.includes('research') || q.includes('paper')) return 'research';
  return 'web';
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/** Small stable token from a string; collides as queries converge (saturation). */
function hashToken(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 997;
  return `t${h}`;
}

function hostOf(url: string): string {
  return new URL(url).hostname;
}
