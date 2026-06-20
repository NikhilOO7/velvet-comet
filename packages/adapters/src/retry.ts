/**
 * Retry with exponential backoff + full jitter (PLAN.md §6). Operates on
 * Result so it retries only `retryable` errors from the shared taxonomy;
 * non-retryable failures (4xx, budget) short-circuit immediately.
 */
import type { EngineError, Result } from '@velvet-comet/core';
import { isErr } from '@velvet-comet/core';

export interface RetryOptions {
  readonly retries: number;
  readonly baseMs: number;
  readonly maxMs: number;
  /** Injected for tests; defaults to setTimeout. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Injected for tests; defaults to Math.random. */
  readonly random?: () => number;
  /** Called on each retry — used to emit metrics/logs. */
  readonly onRetry?: (attempt: number, error: EngineError) => void;
}

export async function withRetry<T>(
  op: () => Promise<Result<T, EngineError>>,
  opts: RetryOptions,
): Promise<Result<T, EngineError>> {
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = opts.random ?? Math.random;

  let last: Result<T, EngineError> = await op();
  for (let attempt = 1; attempt <= opts.retries; attempt++) {
    if (!isErr(last) || !last.error.retryable) return last;
    opts.onRetry?.(attempt, last.error);
    const backoff = Math.min(opts.maxMs, opts.baseMs * 2 ** (attempt - 1));
    await sleep(Math.floor(backoff * random())); // full jitter in [0, backoff)
    last = await op();
  }
  return last;
}
