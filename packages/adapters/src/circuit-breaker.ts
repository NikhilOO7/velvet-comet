/**
 * Per-key circuit breaker (PLAN.md §6a). Keyed by domain so one flaky retail
 * domain (customer #2) can't burn the whole batch's budget on doomed retries.
 */
type State = 'closed' | 'open' | 'half_open';

interface KeyState {
  state: State;
  failures: number;
  openedAt: number;
}

export class CircuitBreaker {
  private readonly keys = new Map<string, KeyState>();

  constructor(
    private readonly threshold = 5,
    private readonly cooldownMs = 30_000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Whether a call for this key may proceed. */
  canPass(key: string): boolean {
    const s = this.keys.get(key);
    if (!s || s.state === 'closed') return true;
    if (s.state === 'open' && this.now() - s.openedAt >= this.cooldownMs) {
      s.state = 'half_open'; // allow a single trial call
      return true;
    }
    return s.state === 'half_open';
  }

  record(key: string, success: boolean): void {
    const s = this.keys.get(key) ?? { state: 'closed' as State, failures: 0, openedAt: 0 };
    if (success) {
      this.keys.set(key, { state: 'closed', failures: 0, openedAt: 0 });
      return;
    }
    const failures = s.failures + 1;
    if (failures >= this.threshold) {
      this.keys.set(key, { state: 'open', failures, openedAt: this.now() });
    } else {
      this.keys.set(key, { state: s.state === 'half_open' ? 'open' : 'closed', failures, openedAt: this.now() });
    }
  }

  stateOf(key: string): State {
    return this.keys.get(key)?.state ?? 'closed';
  }
}
