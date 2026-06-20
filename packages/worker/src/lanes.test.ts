import { describe, it, expect } from 'vitest';
import { LaneQueue, drain } from './lanes.js';

describe('LaneQueue', () => {
  it('always drains the hot lane before the cold lane', async () => {
    const q = new LaneQueue();
    q.enqueue('c1', 'cold');
    q.enqueue('h1', 'hot');
    q.enqueue('c2', 'cold');
    q.enqueue('h2', 'hot');

    const processed: string[] = [];
    await drain(q, (id) => {
      processed.push(id);
      return Promise.resolve();
    });

    // Hot jobs first (FIFO within lane), then cold — batch can't starve users.
    expect(processed).toEqual(['h1', 'h2', 'c1', 'c2']);
    expect(q.size()).toBe(0);
  });

  it('reports size across both lanes', () => {
    const q = new LaneQueue();
    q.enqueue('a', 'hot');
    q.enqueue('b', 'cold');
    expect(q.size()).toBe(2);
    q.dequeue();
    expect(q.size()).toBe(1);
  });
});
