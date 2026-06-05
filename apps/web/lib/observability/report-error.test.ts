import { afterEach, describe, expect, it, vi } from 'vitest';

import { ERROR_IDS } from '../constants/error-ids';

// Mock the single external boundary — the global OpenTelemetry API. The seam
// attaches a PII-safe event to whatever span is active; we control that span
// here and assert on the exact payload our code emits (real behavior of our
// code, not the mock's).
const hoisted = vi.hoisted(() => {
  const addEvent = vi.fn();
  const getActiveSpan = vi.fn(() => undefined as { addEvent: typeof addEvent } | undefined);
  return { addEvent, getActiveSpan };
});

vi.mock('@opentelemetry/api', () => ({
  trace: { getActiveSpan: hoisted.getActiveSpan },
}));

// eslint-disable-next-line import/first
import { reportSwallowedError } from './report-error';

describe('reportSwallowedError', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('records a PII-safe swallowed_error event on the active span', () => {
    hoisted.getActiveSpan.mockReturnValue({ addEvent: hoisted.addEvent });

    reportSwallowedError(ERROR_IDS.AGENT_DISPATCH_FAILED, 'redacted message', {
      dealId: 'deal-1',
      trigger: 'collateral_pipeline',
    });

    expect(hoisted.addEvent).toHaveBeenCalledWith('swallowed_error', {
      'error.id': 'AGENT_DISPATCH_FAILED',
      'error.message': 'redacted message',
      dealId: 'deal-1',
      trigger: 'collateral_pipeline',
    });
  });

  it('no-ops when there is no active span (best-effort, never throws)', () => {
    hoisted.getActiveSpan.mockReturnValue(undefined);

    expect(() =>
      reportSwallowedError(ERROR_IDS.READ_AUDIT_WRITE_FAILED, 'redacted message'),
    ).not.toThrow();
    expect(hoisted.addEvent).not.toHaveBeenCalled();
  });

  it('emits only the error id + redacted message when no context is provided', () => {
    hoisted.getActiveSpan.mockReturnValue({ addEvent: hoisted.addEvent });

    reportSwallowedError(ERROR_IDS.INTERNAL_COMM_NOTIFY_FAILED, 'redacted');

    expect(hoisted.addEvent).toHaveBeenCalledWith('swallowed_error', {
      'error.id': 'INTERNAL_COMM_NOTIFY_FAILED',
      'error.message': 'redacted',
    });
  });
});
