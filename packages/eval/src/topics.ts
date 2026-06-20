/**
 * Golden topics with hand-curated ground truth. Each has SEO "head" sources
 * (always findable) plus long-tail sources gated behind the angle tokens the
 * HeuristicExpansion emits for each source class (see adapters/heuristic-
 * expansion.ts CLASS_OPERATORS) — trade/forum/regional/research/news.
 */
import type { EvalTopic } from './corpus.js';

const head = [
  { domain: 'wikipedia.org', sourceClass: 'web' as const, angles: [] },
  { domain: 'bigblog.com', sourceClass: 'web' as const, angles: [] },
  { domain: 'medium.com', sourceClass: 'web' as const, angles: [] },
];

/** Long-tail sources keyed to the tokens their class operator injects. */
const longTail = [
  { domain: 'industry-trade-journal.com', sourceClass: 'trade' as const, angles: ['trade', 'publication', 'industry'] },
  { domain: 'practitioners-forum.com', sourceClass: 'forum' as const, angles: ['forum', 'discussion', 'community'] },
  { domain: 'regional-gazette.de', sourceClass: 'regional' as const, angles: ['regional', 'local'] },
  { domain: 'arxiv.org', sourceClass: 'research' as const, angles: ['research', 'paper', 'analysis'] },
  { domain: 'sector-news-daily.com', sourceClass: 'news' as const, angles: ['news'] },
  { domain: 'niche-tradewire.com', sourceClass: 'trade' as const, angles: ['trade', 'industry'] },
];

export const TOPICS: readonly EvalTopic[] = [
  { id: 'iot-sensors', query: 'competitive landscape for industrial IoT sensors', intent: 'research', groundTruth: [...head, ...longTail] },
  { id: 'ev-supply', query: 'electric vehicle battery supply chain', intent: 'general', groundTruth: [...head, ...longTail] },
  { id: 'fintech-reg', query: 'regulatory shifts in EU fintech', intent: 'news', groundTruth: [...head, ...longTail] },
];
