import { registerOTel } from '@vercel/otel';

/**
 * Next.js instrumentation hook (Next 16: INSTRUMENTATION_HOOK_FILENAME='instrumentation').
 * Runs once per server runtime at boot, before any request is served — this is where the
 * OpenTelemetry SDK is registered. Registration is what turns the otherwise no-op
 * `@opentelemetry/api` spans created inside our packages (e.g. `runIntake` in
 * `@cema/agents-intake`) into real, exported spans: libraries instrument against the API,
 * the app wires the SDK exactly once here (ADR 0011).
 *
 * `@vercel/otel` auto-configures the OTLP exporter to Vercel Observability in production;
 * with no OTLP endpoint configured (local dev, tests) it is effectively a no-op, so this
 * adds no behavior or latency outside a traced deployment.
 *
 * Span attributes must stay PII-safe (CLAUDE.md §10.3 / hard rule #3): spans are logs, so
 * never attach loan figures, payoff amounts, or borrower identity — see runIntake.
 *
 * Also initializes Sentry error capture (the §4 observability stack) — dynamically
 * imported under the Node runtime ONLY, so the Node-only `@sentry/node` SDK never
 * enters the Edge bundle (proxy.ts). `initSentry()` is a no-op without `SENTRY_DSN`,
 * so this stays dormant outside a Sentry-configured deployment.
 */
export async function register(): Promise<void> {
  registerOTel({ serviceName: 'cema-web' });

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initSentry } = await import('./lib/observability/sentry');
    await initSentry();
  }
}
