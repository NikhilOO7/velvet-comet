/**
 * The two concurrency primitives behind the Firecrawl chokepoint (PLAN.md §6a):
 * a token-bucket rate limiter (rpm) and a leased semaphore (in-flight cap).
 *
 * These are the in-process implementations for the single-process demo. The
 * interfaces are deliberately small so the production swap to a Redis Lua
 * limiter + leased semaphore is a drop-in, not a rewrite.
 */

export interface RateLimiter {
  /** Acquire one token, waiting if necessary. */
  acquire(): Promise<void>;
}

export interface Lease {
  release(): void;
}

export interface ConcurrencyLimiter {
  acquire(): Promise<Lease>;
}

/** Refilling token bucket. Clock and sleep are injected for deterministic tests. */
export class TokenBucket implements RateLimiter {
  private tokens: number;
  private last: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
    private readonly now: () => number = () => Date.now(),
    private readonly sleep: (ms: number) => Promise<void> = defaultSleep,
  ) {
    this.tokens = capacity;
    this.last = now();
  }

  /** Refill based on elapsed time, then report available whole tokens. */
  available(): number {
    const t = this.now();
    const elapsedSec = (t - this.last) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.refillPerSec);
    this.last = t;
    return Math.floor(this.tokens);
  }

  tryAcquire(): boolean {
    if (this.available() >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  async acquire(): Promise<void> {
    // Bounded wait loop; each miss sleeps for one token's worth of refill.
    while (!this.tryAcquire()) {
      const waitMs = Math.max(1, Math.ceil(1000 / this.refillPerSec));
      await this.sleep(waitMs);
    }
  }
}

/**
 * Counting semaphore with leases. A lease can only be released once; a crashed
 * holder in the distributed version reclaims via TTL (here, leases are
 * in-process so the process owns them).
 */
export class Semaphore implements ConcurrencyLimiter {
  private inUse = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly max: number) {
    if (max < 1) throw new Error('Semaphore max must be >= 1');
  }

  inFlight(): number {
    return this.inUse;
  }

  async acquire(): Promise<Lease> {
    if (this.inUse >= this.max) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.inUse++;
    let released = false;
    return {
      release: (): void => {
        if (released) return; // idempotent — double-release is a no-op
        released = true;
        this.inUse--;
        const next = this.waiters.shift();
        if (next) next();
      },
    };
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
