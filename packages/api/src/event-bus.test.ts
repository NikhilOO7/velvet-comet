import { describe, it, expect } from 'vitest';
import { initialState } from '@velvet-comet/core';
import type { JobRecord } from '@velvet-comet/worker';
import { InProcessEventBus } from './event-bus.js';

function record(id: string): JobRecord {
  return {
    id,
    request: { query: 'q', intent: 'general', coverage: 'standard', deepen: false },
    status: 'fanning_out',
    lane: 'cold',
    state: initialState(),
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('InProcessEventBus', () => {
  it('delivers events only to subscribers of that job', () => {
    const bus = new InProcessEventBus();
    const a: string[] = [];
    const b: string[] = [];
    bus.subscribe('job-a', (r) => a.push(r.status));
    bus.subscribe('job-b', (r) => b.push(r.status));

    bus.emit(record('job-a'));
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(0);
  });

  it('stops delivering after unsubscribe', () => {
    const bus = new InProcessEventBus();
    const seen: string[] = [];
    const unsub = bus.subscribe('job-a', (r) => seen.push(r.id));
    bus.emit(record('job-a'));
    unsub();
    bus.emit(record('job-a'));
    expect(seen).toHaveLength(1);
  });
});
