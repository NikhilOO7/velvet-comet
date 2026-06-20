/**
 * Hot/cold priority lanes (PLAN.md §4a). The hot lane (interactive requests) is
 * always drained before the cold lane (nightly batch), so a 5,000-query batch
 * dump can't starve a user-facing request. FIFO within each lane.
 *
 * This is the scheduling-level arbiter; the deeper token-budget arbiter on the
 * Firecrawl chokepoint is the production refinement noted in §6a.
 */
import type { Lane } from './job-store.js';

export interface QueueItem {
  readonly id: string;
  readonly lane: Lane;
}

export class LaneQueue {
  private readonly hot: string[] = [];
  private readonly cold: string[] = [];

  enqueue(id: string, lane: Lane): void {
    (lane === 'hot' ? this.hot : this.cold).push(id);
  }

  /** Pop the next job: hot before cold. Null when both lanes are empty. */
  dequeue(): QueueItem | null {
    const hot = this.hot.shift();
    if (hot !== undefined) return { id: hot, lane: 'hot' };
    const cold = this.cold.shift();
    if (cold !== undefined) return { id: cold, lane: 'cold' };
    return null;
  }

  size(): number {
    return this.hot.length + this.cold.length;
  }
}

/** Drain the queue in priority order, awaiting each job through `process`. */
export async function drain(queue: LaneQueue, process: (id: string) => Promise<void>): Promise<void> {
  let item = queue.dequeue();
  while (item !== null) {
    await process(item.id);
    item = queue.dequeue();
  }
}
