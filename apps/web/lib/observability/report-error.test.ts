import { afterEach, describe, expect, it, vi } from 'vitest';

import { ERROR_IDS } from '../constants/error-ids';

// Mock the OpenTelemetry API boundary: a tracer whose startSpan returns a span we
// inspect. We assert on the exact span our code produces (real behavior of our
// code, not the mock's). SpanStatusCode.ERROR is 2 in the OTel API.
const hoisted = vi.hoisted(() => {
  const setAttribute = vi.fn();
  const setStatus = vi.fn();
  const end = vi.fn();
  const span = { setAttribute, setStatus, end };
  const startSpan = vi.fn(() => span);
  return { setAttribute, setStatus, end, startSpan };
});

vi.mock('@opentelemetry/api', () => ({
  trace: { getTracer: () => ({ startSpan: hoisted.startSpan }) },
  SpanStatusCode: { UNSET: 0, OK: 1, ERROR: 2 },
}));

// eslint-disable-next-line import/first
import { reportSwallowedError } from './report-error';

describe('reportSwallowedError', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('emits a dedicated errored `swallowed_error` span with PII-safe attributes', () => {
    reportSwallowedError(ERROR_IDS.AGENT_DISPATCH_FAILED, 'redacted message', {
      dealId: 'deal-1',
      trigger: 'collateral_pipeline',
    });

    expect(hoisted.startSpan).toHaveBeenCalledWith('swallowed_error');
    expect(hoisted.setAttribute).toHaveBeenCalledWith('error.id', 'AGENT_DISPATCH_FAILED');
    expect(hoisted.setAttribute).toHaveBeenCalledWith('error.message', 'redacted message');
    expect(hoisted.setAttribute).toHaveBeenCalledWith('dealId', 'deal-1');
    expect(hoisted.setAttribute).toHaveBeenCalledWith('trigger', 'collateral_pipeline');
    // Marks the span ERROR (code 2) so it is a first-class, alertable error in
    // Vercel Observability — without marking the parent request span as failed.
    expect(hoisted.setStatus).toHaveBeenCalledWith({ code: 2, message: 'AGENT_DISPATCH_FAILED' });
    expect(hoisted.end).toHaveBeenCalledTimes(1);
  });

  it('emits only the error id + redacted message when no context is provided, and ends the span', () => {
    reportSwallowedError(ERROR_IDS.INTERNAL_COMM_NOTIFY_FAILED, 'redacted');

    expect(hoisted.setAttribute).toHaveBeenCalledWith('error.id', 'INTERNAL_COMM_NOTIFY_FAILED');
    expect(hoisted.setAttribute).toHaveBeenCalledWith('error.message', 'redacted');
    // No context keys beyond the two fixed attributes.
    expect(hoisted.setAttribute).toHaveBeenCalledTimes(2);
    expect(hoisted.end).toHaveBeenCalledTimes(1);
  });

  it('never throws and still ends the span when the SDK throws (best-effort)', () => {
    hoisted.setStatus.mockImplementationOnce(() => {
      throw new Error('otel unavailable');
    });

    expect(() =>
      reportSwallowedError(ERROR_IDS.READ_AUDIT_WRITE_FAILED, 'redacted message'),
    ).not.toThrow();
    expect(hoisted.end).toHaveBeenCalledTimes(1);
  });
});
