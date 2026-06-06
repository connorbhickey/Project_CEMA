import { redactPii } from '@cema/compliance';

import type { ErrorId } from '../constants/error-ids';

// The Sentry SDK is loaded via a DYNAMIC import in initSentry (below), never a
// static one. @sentry/node is Node-only, so keeping it out of every module's
// static import graph guarantees it can never be pulled into the Edge runtime
// bundle (proxy.ts). `typeof import(...)` is a type-only annotation — erased at
// runtime, it adds no static dependency.
type SentryModule = typeof import('@sentry/node');

let sentry: SentryModule | null = null;
let initialized = false;

interface ScrubbableEvent {
  message?: string;
  breadcrumbs?: unknown;
  request?: unknown;
  user?: unknown;
}

/**
 * Defense-in-depth scrub of a Sentry event before it leaves the process (wired as
 * the `beforeSend` hook). We already only `captureMessage` an already-`redactPii`'d
 * string, but this guarantees — even if a future call path captures something
 * richer — that (a) the message is `redactPii`'d again, and (b) the PII-bearing
 * auto-context (breadcrumbs / request / user) is dropped entirely (hard rule #3).
 * Pure + node-testable; preserves the event's own type.
 */
export function scrubSentryEvent<T extends ScrubbableEvent>(event: T): T {
  if (typeof event.message === 'string') {
    event.message = redactPii(event.message);
  }
  delete event.breadcrumbs;
  delete event.request;
  delete event.user;
  return event;
}

/**
 * DSN-gated Sentry initialization — the error-capture half of the §4 observability
 * stack (Sentry + Vercel Observability + OpenTelemetry). Called once from
 * instrumentation.ts `register()`. No `SENTRY_DSN` -> no-op (dormant), exactly like
 * `@vercel/otel`'s OTLP exporter and every other env-gated integration in this repo;
 * tracing stays with `@vercel/otel` (ADR 0011), Sentry here is errors only.
 *
 * PII (hard rule #3), defense in depth: `sendDefaultPii: false` (no IP / headers /
 * cookies / request bodies), `maxBreadcrumbs: 0` (no incidental breadcrumb capture),
 * and a `beforeSend` scrub (scrubSentryEvent) that re-`redactPii`s the message and
 * drops any breadcrumbs / request / user on the event. The only data sent is the
 * already-redacted message + the PII-safe tags/extra passed to captureSwallowedError.
 *
 * Returns whether Sentry is now active. Idempotent + best-effort: a failed init
 * (bad DSN, offline) leaves the seam dormant rather than throwing at boot.
 */
export async function initSentry(): Promise<boolean> {
  if (initialized) return true;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return false;
  // The SDK is Node-only; never init under the Edge runtime.
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== 'nodejs') return false;
  try {
    sentry = await import('@sentry/node');
    sentry.init({
      dsn,
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
      // Tracing is handled by @vercel/otel; Sentry here is error capture only.
      tracesSampleRate: 0,
      // hard rule #3 — never let Sentry auto-collect request/user PII.
      sendDefaultPii: false,
      // Capture no breadcrumbs (console/http/etc.) — they could carry incidental
      // PII; we only need the explicit error message + errorId tag.
      maxBreadcrumbs: 0,
      // Final defense-in-depth scrub of every outgoing event (hard rule #3).
      beforeSend: (event) => scrubSentryEvent(event),
    });
    initialized = true;
    return true;
  } catch {
    // Best-effort: a failed boot-time init must not crash the server.
    sentry = null;
    return false;
  }
}

/**
 * Route a swallowed (best-effort) error to Sentry as an error-level message.
 * No-op unless Sentry was initialized (SENTRY_DSN set). Best-effort: never throws —
 * a Sentry outage must not break the swallow site that called it (the OTel errored
 * span in reportSwallowedError already recorded the failure independently).
 *
 * `captureMessage` (not `captureException`) by design: it sends ONLY the caller's
 * already-`redactPii`'d message + the static `errorId` tag + the PII-safe `context`,
 * never a raw Error (whose stack/message could carry unredacted PII) — hard rule #3.
 */
export function captureSwallowedError(
  errorId: ErrorId,
  redactedMessage: string,
  context: Record<string, string> = {},
): void {
  if (!initialized || !sentry) return;
  try {
    sentry.captureMessage(redactedMessage, {
      level: 'error',
      tags: { errorId },
      extra: context,
    });
  } catch {
    // Best-effort: the OTel errored span already captured this failure.
  }
}
