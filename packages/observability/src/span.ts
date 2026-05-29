import { SpanStatusCode, type Span, type Tracer } from '@opentelemetry/api';

/**
 * Wrap one async boundary in a child span: record any exception on the span,
 * mark it ERROR, and always end it. Lifted verbatim from the Intake Agent's
 * orchestrator when `@cema/search` became the second instrumented surface
 * (ADR 0011 Decision 2 trigger). The `tracer` is a parameter — not a module
 * singleton — so each consumer keeps its own instrumentation scope; the active
 * `span` is handed to `fn` so model spans can set attributes without needing a
 * context manager wired up.
 */
export function withChildSpan<T>(
  tracer: Tracer,
  name: string,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    try {
      return await fn(span);
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      throw err;
    } finally {
      span.end();
    }
  });
}
