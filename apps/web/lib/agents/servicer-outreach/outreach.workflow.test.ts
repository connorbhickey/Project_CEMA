import type { OutreachResult } from '@cema/agents-servicer-outreach';
import { beforeEach, describe, expect, it, vi } from 'vitest';


vi.mock('workflow', () => ({ sleep: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./outreach.steps', () => ({ runOutreachStep: vi.fn() }));

import { sleep } from 'workflow';

import { runOutreachStep } from './outreach.steps';
import { outreachWorkflow } from './outreach.workflow';

const mockStep = vi.mocked(runOutreachStep);
const mockSleep = vi.mocked(sleep);

function sendResult(touchNumber: number): OutreachResult {
  return { dealId: 'deal-1', action: { kind: 'send', touchNumber }, touchSent: touchNumber };
}
function waitResult(until: Date): OutreachResult {
  return { dealId: 'deal-1', action: { kind: 'wait', until }, touchSent: null };
}
function stopResult(): OutreachResult {
  return { dealId: 'deal-1', action: { kind: 'stop', reason: 'exhausted' }, touchSent: null };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('outreachWorkflow (durable orchestration, mocked steps)', () => {
  it('sends, durably sleeps until the next dueAt, re-evaluates, then stops', async () => {
    const due = new Date('2026-06-15T12:00:00.000Z');
    mockStep
      .mockResolvedValueOnce(sendResult(1))
      .mockResolvedValueOnce(waitResult(due))
      .mockResolvedValueOnce(stopResult());

    const result = await outreachWorkflow('deal-1', 'org-1', 'user-1');

    expect(mockStep).toHaveBeenCalledTimes(3);
    expect(mockSleep).toHaveBeenCalledTimes(1);
    expect(mockSleep).toHaveBeenCalledWith(due);
    expect(result.action.kind).toBe('stop');
  });

  it('returns immediately, without sleeping, when the servicer has no supported channel', async () => {
    mockStep.mockResolvedValueOnce({
      dealId: 'deal-1',
      action: { kind: 'unsupported_channel', method: null },
      touchSent: null,
    });

    const result = await outreachWorkflow('deal-1', 'org-1', 'user-1');

    expect(mockStep).toHaveBeenCalledTimes(1);
    expect(mockSleep).not.toHaveBeenCalled();
    expect(result.action.kind).toBe('unsupported_channel');
  });

  it('bounds iterations -- a never-terminating evaluator rejects rather than spinning forever', async () => {
    mockStep.mockResolvedValue(sendResult(1)); // pathological: always "send", never stops

    await expect(outreachWorkflow('deal-1', 'org-1', 'user-1')).rejects.toThrow(/iteration/i);
    expect(mockStep).toHaveBeenCalledTimes(MAX_ITERATIONS_EXPECTED);
    expect(mockSleep).not.toHaveBeenCalled();
  });
});

// Local mirror of the inlined workflow constant (the workflow file cannot export
// it without breaking sandbox cleanliness, so the test pins the expected value).
const MAX_ITERATIONS_EXPECTED = 12;
