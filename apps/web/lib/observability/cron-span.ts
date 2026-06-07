import { SpanStatusCode, trace } from '@opentelemetry/api';

const tracer = trace.getTracer('@cema/web-cron');

/**
 * Wrap a scheduled cron's work in an OTel span (`cron.<name>`) so every run is a
 * first-class, queryable event in Vercel Observability — even a no-op run
 * ("purged 0") confirms the cron fired and reports its outcome. The work returns
 * a plain object of NUMERIC summary fields (counts only — PII-safe), each set as a
 * `cron.<field>` span attribute. A throw marks the span ERROR and rethrows so the
 * caller's own catch can shape the HTTP response. The OTLP exporter is live in
 * production (instrumentation.ts via @vercel/otel) and a no-op locally (ADR 0011),
 * so this is zero-cost in tests + dev.
 */
export async function withCronSpan<T extends Record<string, number>>(
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(`cron.${name}`, async (span) => {
    try {
      const result = await fn();
      for (const [key, value] of Object.entries(result)) {
        span.setAttribute(`cron.${key}`, value);
      }
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : 'unknown error',
      });
      throw err;
    } finally {
      span.end();
    }
  });
}
