/**
 * Structured JSON logger implementing the core Logger port. Carries a
 * correlation id on every line; never logs PII or page content (PLAN.md §12).
 */
import type { Logger } from '@velvet-comet/core';

type Level = 'info' | 'warn' | 'error';

export function createLogger(correlationId: string, sink: (line: string) => void = defaultSink): Logger {
  const emit = (level: Level, msg: string, fields?: Record<string, unknown>): void => {
    sink(JSON.stringify({ level, msg, correlationId, ...fields }));
  };
  return {
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
  };
}

function defaultSink(line: string): void {
  process.stderr.write(`${line}\n`);
}
