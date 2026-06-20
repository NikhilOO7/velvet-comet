import { describe, it, expect } from 'vitest';
import { CircuitBreaker } from './circuit-breaker.js';

describe('CircuitBreaker', () => {
  it('opens after the failure threshold and blocks calls', () => {
    let t = 0;
    const cb = new CircuitBreaker(3, 1000, () => t);
    for (let i = 0; i < 3; i++) cb.record('k', false);
    expect(cb.stateOf('k')).toBe('open');
    expect(cb.canPass('k')).toBe(false);
  });

  it('half-opens after cooldown, then closes on success', () => {
    let t = 0;
    const cb = new CircuitBreaker(2, 1000, () => t);
    cb.record('k', false);
    cb.record('k', false);
    expect(cb.canPass('k')).toBe(false);
    t += 1000;
    expect(cb.canPass('k')).toBe(true); // half-open trial
    expect(cb.stateOf('k')).toBe('half_open');
    cb.record('k', true);
    expect(cb.stateOf('k')).toBe('closed');
  });

  it('re-opens if the half-open trial fails', () => {
    let t = 0;
    const cb = new CircuitBreaker(2, 1000, () => t);
    cb.record('k', false);
    cb.record('k', false);
    t += 1000;
    cb.canPass('k'); // → half_open
    cb.record('k', false);
    expect(cb.stateOf('k')).toBe('open');
  });
});
