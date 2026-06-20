/**
 * In-process pub/sub for job checkpoint events (PLAN.md §11 outbox flow). The
 * SSE stream subscribes per job; the Coordinator publishes after every persisted
 * state change. Production swaps this for a durable outbox + relay (e.g. Postgres
 * LISTEN/NOTIFY or Redis streams) behind the same JobEvents interface.
 */
import type { JobEvents } from '@velvet-comet/worker';
import type { JobRecord } from '@velvet-comet/worker';

type Listener = (record: JobRecord) => void;

export class InProcessEventBus implements JobEvents {
  private readonly listeners = new Map<string, Set<Listener>>();

  emit(record: JobRecord): void {
    const set = this.listeners.get(record.id);
    if (!set) return;
    for (const listener of set) listener(record);
  }

  /** Subscribe to a job's events; returns an unsubscribe function. */
  subscribe(jobId: string, listener: Listener): () => void {
    const set = this.listeners.get(jobId) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(jobId, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(jobId);
    };
  }
}
