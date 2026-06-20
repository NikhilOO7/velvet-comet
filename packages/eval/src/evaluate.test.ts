import { describe, it, expect } from 'vitest';
import { evaluate, evaluateTopic } from './evaluate.js';
import { TOPICS } from './topics.js';

describe('completeness eval (regression gate)', () => {
  it('the engine recalls nearly all ground-truth sources on every topic', async () => {
    for (const topic of TOPICS) {
      const r = await evaluateTopic(topic, 'high');
      // The completeness loop should find the gated long-tail, not just the head.
      expect(r.engineRecall).toBeGreaterThanOrEqual(0.85);
      expect(r.classCoverage).toBeGreaterThanOrEqual(0.85);
    }
  });

  it('the engine substantially beats a flat /search baseline', async () => {
    const report = await evaluate();
    // Baseline (bare query) can only reach the head; the engine reaches the tail.
    expect(report.aggregate.baselineRecall).toBeLessThan(0.6);
    expect(report.aggregate.lift).toBeGreaterThan(0.3);
    expect(report.aggregate.engineRecall).toBeGreaterThan(report.aggregate.baselineRecall);
  });

  it('surfaces a meaningful long-tail share, not forty more of the same', async () => {
    const [first] = TOPICS;
    if (!first) throw new Error('no topics defined');
    const r = await evaluateTopic(first, 'high');
    expect(r.headTail).toBeGreaterThan(0.4);
  });
});
