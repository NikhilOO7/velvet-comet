/**
 * Credit/latency ledger — the authoritative cost record (PLAN.md §6, §14 cost
 * meter). Every Firecrawl call appends one entry; this is also the debugging
 * trail (mirrors the `firecrawl_call` table in the prod data model).
 */
export interface CallRecord {
  readonly endpoint: string;
  readonly status: 'ok' | 'error';
  readonly credits: number;
  readonly latencyMs: number;
  readonly retries: number;
  /** True when served from cache (zero credits, no upstream call). */
  readonly cached?: boolean;
}

export class CostLedger {
  private readonly records: CallRecord[] = [];

  record(entry: CallRecord): void {
    this.records.push(entry);
  }

  totalCredits(): number {
    return this.records.reduce((sum, r) => sum + r.credits, 0);
  }

  count(): number {
    return this.records.length;
  }

  cacheHits(): number {
    return this.records.filter((r) => r.cached === true).length;
  }

  all(): readonly CallRecord[] {
    return this.records;
  }
}
