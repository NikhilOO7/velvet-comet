/** Deterministic offline ScrapePort for demos/tests. */
import { type ScrapePort, type Result, ok } from '@velvet-comet/core';
import type { EngineError } from '@velvet-comet/core';

export class MockScrape implements ScrapePort {
  scrape(url: string): Promise<Result<{ markdown: string }, EngineError>> {
    const host = safeHost(url);
    const markdown = `# ${host}\n\nFull-content excerpt for ${url}. In live mode this is the scraped main content (markdown) from Firecrawl /v2/scrape.`;
    return Promise.resolve(ok({ markdown }));
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
