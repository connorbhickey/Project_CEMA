import { trace } from '@opentelemetry/api';

import type { ErrorId } from '../constants/error-ids';

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
 * Today it attaches a PII-safe `swallowed_error` event to the active
 * OpenTelemetry span, so a swallowed failure becomes queryable in Vercel
 * Observability traces — dormant until an OTLP endpoint is configured, exactly
 * like every other span (ADR 0011). When no span is active it no-ops.
 *
 * Sentry activation (Connor — needs SENTRY_DSN): install `@sentry/nextjs`, add a
 * DSN-gated `Sentry.init` in instrumentation.ts, then add
 *   Sentry.captureMessage(redactedMessage, { level: 'error', tags: { errorId } })
 * here. The single call site makes that a one-function change.
 *
 * PII (hard rule #3): callers MUST pass an already-`redactPii`'d message, and
 * `context` values must be PII-safe (ids / enum tokens — never names, amounts,
 * SSNs). We use `addEvent` (not `recordException`) so no raw stack trace or raw
 * error message can leak — only the redacted message + allowlisted context.
 */
export function reportSwallowedError(
  errorId: ErrorId,
  redactedMessage: string,
  context: Record<string, string> = {},
): void {
  const span = trace.getActiveSpan();
  if (!span) return;
  span.addEvent('swallowed_error', {
    'error.id': errorId,
    'error.message': redactedMessage,
    ...context,
  });
}
