import { describe, it, expect } from 'vitest';
import { engineError, ok, err, isOk, type EngineError, type Result } from '@velvet-comet/core';
import { withRetry } from './retry.js';

const noSleep = (): Promise<void> => Promise.resolve();
const opts = { retries: 3, baseMs: 1, maxMs: 10, sleep: noSleep, random: (): number => 0 };

describe('withRetry', () => {
  it('retries retryable failures then succeeds', async () => {
    let calls = 0;
    const op = (): Promise<Result<string, EngineError>> => {
      calls++;
      return Promise.resolve(calls < 3 ? err(engineError('RATE_LIMITED', 'x')) : ok('done'));
    };
    const r = await withRetry(op, opts);
    expect(isOk(r)).toBe(true);
    expect(calls).toBe(3);
  });

  it('does not retry non-retryable failures', async () => {
    let calls = 0;
    const op = (): Promise<Result<string, EngineError>> => {
      calls++;
      return Promise.resolve(err(engineError('UPSTREAM_REJECTED', 'bad request')));
    };
    const r = await withRetry(op, opts);
    expect(isOk(r)).toBe(false);
    expect(calls).toBe(1);
  });

  it('gives up after exhausting retries and returns the last error', async () => {
    let calls = 0;
    const attempts: number[] = [];
    const op = (): Promise<Result<string, EngineError>> => {
      calls++;
      return Promise.resolve(err(engineError('UPSTREAM_UNAVAILABLE', 'down')));
    };
    const r = await withRetry(op, { ...opts, onRetry: (a) => attempts.push(a) });
    expect(isOk(r)).toBe(false);
    expect(calls).toBe(4); // 1 initial + 3 retries
    expect(attempts).toEqual([1, 2, 3]);
  });
});
