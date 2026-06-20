/**
 * One error taxonomy shared by retry logic, the circuit breaker, and the
 * coverage-gap reporter (PLAN.md §12) — so "why did this fail" has exactly
 * one vocabulary across the system.
 */
export type EngineErrorCode =
  | 'RATE_LIMITED' // 429 from Firecrawl — retryable with backoff
  | 'UPSTREAM_TIMEOUT' // slow tail / deadline exceeded — retryable
  | 'UPSTREAM_UNAVAILABLE' // 5xx — retryable
  | 'UPSTREAM_REJECTED' // 4xx (bad request, blocked domain) — NOT retryable
  | 'EMPTY_RESULT' // valid call, zero results — drives escalation/gap
  | 'BUDGET_EXHAUSTED' // credit ceiling hit — NOT retryable
  | 'EXPANSION_FAILED' // LLM leaf stage failed
  | 'INVALID_INPUT' // failed schema/parse at a boundary
  | 'INTERNAL'; // unexpected — investigate

export interface EngineError {
  readonly code: EngineErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly context?: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;
}

const RETRYABLE: ReadonlySet<EngineErrorCode> = new Set<EngineErrorCode>([
  'RATE_LIMITED',
  'UPSTREAM_TIMEOUT',
  'UPSTREAM_UNAVAILABLE',
]);

export function engineError(
  code: EngineErrorCode,
  message: string,
  opts: { context?: Record<string, unknown>; cause?: unknown } = {},
): EngineError {
  return {
    code,
    message,
    retryable: RETRYABLE.has(code),
    ...(opts.context ? { context: opts.context } : {}),
    ...(opts.cause !== undefined ? { cause: opts.cause } : {}),
  };
}
