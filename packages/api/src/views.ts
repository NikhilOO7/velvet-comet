/** Wire-shape mappers — DTO boundary so internal JobRecord never leaks (§12). */
import type { JobRecord } from '@velvet-comet/worker';

/** Public view of a job — includes the full outcome once terminal. */
export function toJobView(record: JobRecord): Record<string, unknown> {
  return {
    id: record.id,
    status: record.status,
    lane: record.lane,
    query: record.request.query,
    intent: record.request.intent,
    coverage: record.request.coverage,
    updatedAt: record.updatedAt,
    ...(record.outcome ? { outcome: record.outcome } : {}),
    ...(record.error ? { error: record.error } : {}),
  };
}

/** Compact progress frame for the SSE stream (no heavy result payloads). */
export function toProgressFrame(record: JobRecord): Record<string, unknown> {
  const curve = record.state.saturationCurve;
  return {
    id: record.id,
    status: record.status,
    round: record.state.round,
    domainsSeen: record.state.accumulated.length,
    newDomainsLastRound: curve[curve.length - 1]?.newDomains ?? 0,
    creditsSpent: record.state.creditsSpent,
    ...(record.outcome ? { outcome: record.outcome } : {}),
    ...(record.error ? { error: record.error } : {}),
  };
}
