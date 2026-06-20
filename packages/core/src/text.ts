/**
 * Pure text/URL utilities. Deterministic, no I/O — the testable substrate of
 * the completeness engine.
 */
import type { SourceClass } from '@velvet-comet/contracts';

/** Registrable-ish domain from a URL; strips a leading `www.`. Lowercased. */
export function domainOf(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch {
    return '';
  }
}

const FORUM_HINTS = ['forum', 'community', 'reddit.', 'discourse', 'stackexchange', 'quora.'];
const TRADE_HINTS = ['trade', 'industryweek', 'journal', 'gazette', 'weekly', 'biz'];
const NEWS_HINTS = ['news', 'times', 'post', 'reuters', 'bloomberg', 'guardian', 'bbc.'];
const RESEARCH_HINTS = ['arxiv.', '.edu', 'ssrn', 'researchgate', 'nature.', 'springer'];
// Country-code TLDs (excluding the ubiquitous generic ones) ⇒ likely regional.
const GENERIC_TLDS = new Set(['com', 'org', 'net', 'io', 'co', 'ai', 'dev', 'app', 'gov', 'edu']);

/**
 * Heuristic source classification. Cheap and deterministic; the LLM is NOT in
 * this path (PLAN.md §5a keeps the core deterministic). Good enough to drive
 * diversity quotas and the coverage grid; can be upgraded behind this seam.
 */
export function classifySource(url: string, hintedClass?: SourceClass): SourceClass {
  if (hintedClass && hintedClass !== 'web') return hintedClass;
  const domain = domainOf(url);
  if (!domain) return 'other';

  const has = (hints: readonly string[]): boolean => hints.some((h) => domain.includes(h));
  if (has(FORUM_HINTS)) return 'forum';
  if (has(NEWS_HINTS)) return 'news';
  if (has(RESEARCH_HINTS)) return 'research';
  if (has(TRADE_HINTS)) return 'trade';

  const tld = domain.split('.').pop() ?? '';
  if (tld.length === 2 && !GENERIC_TLDS.has(tld)) return 'regional';
  return 'web';
}

const TOKEN_RE = /[a-z0-9]+/g;

/** Lowercased word tokens, used for fingerprinting and freshness heuristics. */
export function tokenize(text: string): string[] {
  return text.toLowerCase().match(TOKEN_RE) ?? [];
}

/**
 * 64-bit SimHash over content tokens, returned as a hex string. Near-duplicate
 * blocks (customer #3) collapse because similar token sets yield small Hamming
 * distance. Pure FNV-1a per token; no crypto dependency needed.
 */
export function simhash(text: string): string {
  const tokens = tokenize(text);
  const bits = new Array<number>(64).fill(0);
  for (const token of tokens) {
    const h = fnv1a64(token);
    for (let i = 0; i < 64; i++) {
      // Test bit i of the 64-bit hash held as a BigInt.
      const set = (h >> BigInt(i)) & 1n;
      bits[i] = (bits[i] ?? 0) + (set === 1n ? 1 : -1);
    }
  }
  let out = 0n;
  for (let i = 0; i < 64; i++) {
    if ((bits[i] ?? 0) > 0) out |= 1n << BigInt(i);
  }
  return out.toString(16).padStart(16, '0');
}

/** Hamming distance between two hex SimHashes (number of differing bits). */
export function hammingDistance(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let count = 0;
  while (x > 0n) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

const FNV_OFFSET = 14695981039346656037n;
const FNV_PRIME = 1099511628211n;
const MASK64 = (1n << 64n) - 1n;

function fnv1a64(str: string): bigint {
  let hash = FNV_OFFSET;
  for (let i = 0; i < str.length; i++) {
    hash ^= BigInt(str.charCodeAt(i));
    hash = (hash * FNV_PRIME) & MASK64;
  }
  return hash;
}
