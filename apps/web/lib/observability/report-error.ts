import { SpanStatusCode, trace } from '@opentelemetry/api';

import type { ErrorId } from '../constants/error-ids';

import { captureSwallowedError } from './sentry';

const tracer = trace.getTracer('@cema/web-observability');

/**
 * Central routing seam for best-effort / swallowed errors.
 *
 * Each swallow site keeps its OWN inline `redactPii(...).replace(/[\r\n]/g, ' ')`
 * console.error — that inline form is load-bearing: CodeQL only recognizes the
 * quantifier-free `/[\r\n]/g` as a `js/log-injection` sanitizer when it sits
 * directly at the `console.error` sink, so it must NOT be moved into a helper
 * (see on-deal-status-changed.ts). This seam is the SEPARATE, centralized place
 * those swallows are routed for observability — called alongside, never
 * replacing, the console.error.
 *
 * It emits a dedicated, short-lived `swallowed_error` span marked
 * `SpanStatusCode.ERROR`, so a swallowed failure becomes a first-class,
 * filterable, alertable error in Vercel Observability — rather than a buried
 * event on the parent request span, which otherwise reports success (these
 * failures are best-effort by design, so the request DID succeed). The span is
 * auto-parented to whatever span is active (or stands alone when none is). The
 * SDK is registered once in instrumentation.ts via `@vercel/otel`, whose OTLP
 * exporter is live in production and a no-op locally (ADR 0011).
 *
 * PII (hard rule #3): callers MUST pass an already-`redactPii`'d message, and
 * `context` values must be PII-safe (ids / enum tokens — never names, amounts,
 * SSNs). We use `setAttribute` / `setStatus` (never `recordException`) so no raw
 * stack trace or raw error object can leak — only the redacted message + the
 * allowlisted context + the static error id.
 *
 * It also routes to Sentry (the §4 error-capture sink) via captureSwallowedError
 * (./sentry) — a second, independent best-effort sink, dormant until `SENTRY_DSN`
 * is provisioned. (Wiring `@sentry/node` required a `pnpm.overrides` pin of
 * `@opentelemetry/api` to a single version, otherwise it reshuffled the peer graph
 * and duplicated `drizzle-orm`; see the root package.json override.)
 */
export function reportSwallowedError(
  errorId: ErrorId,
  redactedMessage: string,
  context: Record<string, string> = {},
): void {
  const span = tracer.startSpan('swallowed_error');
  try {
    span.setAttribute('error.id', errorId);
    span.setAttribute('error.message', redactedMessage);
    for (const [key, value] of Object.entries(context)) {
      span.setAttribute(key, value);
    }
    span.setStatus({ code: SpanStatusCode.ERROR, message: errorId });
  } catch {
    // Best-effort telemetry must never break the swallow site that called it.
  } finally {
    span.end();
  }

  // Independent best-effort sink: route to Sentry too (dormant until SENTRY_DSN
  // is set). Never throws; runs regardless of the span outcome above.
  captureSwallowedError(errorId, redactedMessage, context);
}
