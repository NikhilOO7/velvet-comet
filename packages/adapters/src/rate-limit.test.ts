import { describe, it, expect } from 'vitest';
import { Semaphore, TokenBucket } from './rate-limit.js';

describe('TokenBucket', () => {
  it('allows up to capacity immediately, then refills over time', () => {
    let t = 0;
    const bucket = new TokenBucket(2, 10, () => t); // 10 tokens/sec
    expect(bucket.tryAcquire()).toBe(true);
    expect(bucket.tryAcquire()).toBe(true);
    expect(bucket.tryAcquire()).toBe(false); // empty
    t += 100; // 0.1s * 10/s = 1 token
    expect(bucket.tryAcquire()).toBe(true);
    expect(bucket.tryAcquire()).toBe(false);
  });

  it('never exceeds capacity on refill', () => {
    let t = 0;
    const bucket = new TokenBucket(3, 100, () => t);
    t += 10_000; // huge elapsed
    expect(bucket.available()).toBe(3);
  });
});

describe('Semaphore', () => {
  it('throws on invalid max', () => {
    expect(() => new Semaphore(0)).toThrow();
  });

  it('never exceeds max concurrency under a parallel burst', async () => {
    const max = 4;
    const sem = new Semaphore(max);
    let peak = 0;
    const task = async (): Promise<void> => {
      const lease = await sem.acquire();
      const current = sem.inFlight();
      peak = Math.max(peak, current);
      // yield a few microtasks to interleave holders
      await Promise.resolve();
      await Promise.resolve();
      lease.release();
    };
    await Promise.all(Array.from({ length: 50 }, task));
    expect(peak).toBeLessThanOrEqual(max);
    expect(sem.inFlight()).toBe(0);
  });

  it('double-release is a no-op (idempotent lease)', async () => {
    const sem = new Semaphore(1);
    const lease = await sem.acquire();
    lease.release();
    lease.release();
    expect(sem.inFlight()).toBe(0);
    // a fresh acquire still works and does not underflow
    const lease2 = await sem.acquire();
    expect(sem.inFlight()).toBe(1);
    lease2.release();
  });
});
