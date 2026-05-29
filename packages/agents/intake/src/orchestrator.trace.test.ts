import { SpanStatusCode, context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { FixtureLosAdapter } from './fixture-los-adapter';
import { runIntake } from './orchestrator';
import type { IntakeDeps, RecordingTaxRateTable } from './types';

/** A deterministic, NON-placeholder table so `is_placeholder_rate` is a stable `false`. */
const synthetic: RecordingTaxRateTable = {
  isPlaceholder: false,
  ratesByCounty: { kings: 0.02 },
  defaultRate: 0.01,
  estimatedFees: 1_000,
};

/** Minimal fakes — the trace test only needs the awaited boundaries to resolve. */
function deps(): IntakeDeps {
  return {
    adapter: new FixtureLosAdapter(),
    emitAudit: () => Promise.resolve(),
    createDeal: (input) => Promise.resolve({ dealId: `DEAL-${input.application.externalId}` }),
    rates: synthetic,
  };
}

/**
 * The complete set of attribute keys `runIntake` is permitted to attach to any
 * span. The PII guard below asserts every emitted key is in this set — so a new,
 * un-vetted attribute fails the suite. That is the point: spans are logs (hard
 * rule #3 / CLAUDE.md §10.3), and an un-reviewed key is a potential PII leak.
 */
const ALLOWED_ATTRIBUTE_KEYS = new Set([
  'intake.external_id',
  'intake.cema_type',
  'intake.state',
  'intake.county',
  'intake.property_type',
  'intake.loan_program',
  'intake.lien_position',
  'intake.eligible',
  'intake.reasons',
  'intake.is_placeholder_rate',
  'intake.deal_id',
]);

/**
 * The dollar-figure fields of NormalizedApplication / SavingsEstimate that must
 * NEVER reach a span. Checked as substrings so a prefixed key (e.g.
 * `intake.assigned_upb`) is caught too. None collide with an allowed key — note
 * `intake.is_placeholder_rate` is a boolean *flag*, not the rate value, so it is
 * deliberately absent from this list.
 */
const FORBIDDEN_KEY_SUBSTRINGS = [
  'existingUpb',
  'existing_upb',
  'newLoanAmount',
  'new_loan_amount',
  'assignedUpb',
  'assigned_upb',
  'appliedRate',
  'applied_rate',
  'taxSaved',
  'tax_saved',
  'fees',
  'netSavings',
  'net_savings',
];

describe('runIntake OpenTelemetry tracing', () => {
  const exporter = new InMemorySpanExporter();
  const contextManager = new AsyncLocalStorageContextManager();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });

  beforeAll(() => {
    // A real context manager is what makes the child spans nest under the parent
    // (in production @vercel/otel registers one); without it they would be roots.
    // BasicTracerProvider has no `.register()` (that lives on NodeTracerProvider),
    // so we wire the API globals directly — which is all `register()` does.
    contextManager.enable();
    context.setGlobalContextManager(contextManager);
    trace.setGlobalTracerProvider(provider);
  });

  afterEach(() => {
    exporter.reset();
  });

  afterAll(async () => {
    await provider.shutdown();
    context.disable();
    trace.disable();
  });

  it('emits intake.run with one child span per awaited I/O boundary (eligible path)', async () => {
    await runIntake('FIX-ELIG-SF', deps());

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(4);
    expect(new Set(spans.map((s) => s.name))).toEqual(
      new Set([
        'intake.run',
        'intake.fetch_application',
        'intake.emit_audit',
        'intake.create_deal',
      ]),
    );
  });

  it('nests every child under the same intake.run trace', async () => {
    await runIntake('FIX-ELIG-SF', deps());

    const spans = exporter.getFinishedSpans();
    const parent = spans.find((s) => s.name === 'intake.run');
    expect(parent).toBeDefined();
    // The parent is a root span for an isolated run (nothing active above it).
    expect(parent?.parentSpanContext?.spanId).toBeUndefined();

    for (const child of spans.filter((s) => s.name !== 'intake.run')) {
      expect(child.parentSpanContext?.spanId).toBe(parent?.spanContext().spanId);
      expect(child.spanContext().traceId).toBe(parent?.spanContext().traceId);
    }
  });

  it('omits the create_deal span when the application is ineligible', async () => {
    await runIntake('FIX-INELIG-COOP', deps());

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(3);
    expect(new Set(spans.map((s) => s.name))).toEqual(
      new Set(['intake.run', 'intake.fetch_application', 'intake.emit_audit']),
    );
  });

  it('records the exception and marks ERROR on the failing span and its parent', async () => {
    const failing: IntakeDeps = {
      ...deps(),
      createDeal: () => Promise.reject(new Error('db down')),
    };

    await expect(runIntake('FIX-ELIG-SF', failing)).rejects.toThrow(/db down/);

    const spans = exporter.getFinishedSpans();
    const createDeal = spans.find((s) => s.name === 'intake.create_deal');
    const parent = spans.find((s) => s.name === 'intake.run');
    expect(createDeal?.status.code).toBe(SpanStatusCode.ERROR);
    expect(parent?.status.code).toBe(SpanStatusCode.ERROR);
    // recordException surfaces as a span event named "exception".
    expect(createDeal?.events.some((e) => e.name === 'exception')).toBe(true);
  });

  it('attaches only vetted, non-PII attribute keys to every span (hard rule #3)', async () => {
    await runIntake('FIX-ELIG-SF', deps());

    const spans = exporter.getFinishedSpans();
    expect(spans.length).toBeGreaterThan(0);

    for (const span of spans) {
      for (const key of Object.keys(span.attributes)) {
        expect(
          ALLOWED_ATTRIBUTE_KEYS.has(key),
          `unexpected span attribute "${key}" on ${span.name}`,
        ).toBe(true);
        for (const forbidden of FORBIDDEN_KEY_SUBSTRINGS) {
          expect(
            key.includes(forbidden),
            `PII-sensitive key "${key}" leaked onto span ${span.name}`,
          ).toBe(false);
        }
      }
    }
  });

  it('surfaces deterministic classifications (not figures) on the parent span', async () => {
    await runIntake('FIX-ELIG-SF', deps());

    const parent = exporter.getFinishedSpans().find((s) => s.name === 'intake.run');
    expect(parent?.attributes['intake.external_id']).toBe('FIX-ELIG-SF');
    expect(parent?.attributes['intake.state']).toBe('NY');
    expect(parent?.attributes['intake.cema_type']).toBe('refi_cema');
    expect(parent?.attributes['intake.property_type']).toBe('single_family');
    expect(parent?.attributes['intake.eligible']).toBe(true);
    // The rate flag is a boolean — the placeholder *signal*, never the rate value.
    expect(parent?.attributes['intake.is_placeholder_rate']).toBe(false);
    expect(parent?.attributes['intake.deal_id']).toBe('DEAL-FIX-ELIG-SF');
  });
});
