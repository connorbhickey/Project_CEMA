import { describe, expect, it } from 'vitest';

import { summarizeAgentActivity } from './agent-activity-summary';

describe('summarizeAgentActivity', () => {
  it('folds prefixed actions into the right agent card and sums them', () => {
    const cards = summarizeAgentActivity(
      [
        { action: 'idp.evaluated', count: 3 },
        { action: 'idp.documents_classified', count: 2 },
        { action: 'intake.evaluated', count: 4 },
      ],
      0,
    );
    expect(cards.find((c) => c.key === 'idp')).toMatchObject({ count: 5, unit: 'actions' });
    expect(cards.find((c) => c.key === 'intake')).toMatchObject({ count: 4, unit: 'actions' });
  });

  it('rolls deal.* and unmapped actions into the Lifecycle bucket', () => {
    const cards = summarizeAgentActivity(
      [
        { action: 'deal.created', count: 2 },
        { action: 'deal.status_changed', count: 5 },
        { action: 'deal.agent_dispatch_failed', count: 1 },
        { action: 'something.unmapped', count: 7 },
      ],
      0,
    );
    expect(cards.find((c) => c.key === 'lifecycle')).toMatchObject({ count: 15, unit: 'actions' });
  });

  it('places Exception Triage with the open-exception count and "open" unit', () => {
    const cards = summarizeAgentActivity([], 4);
    expect(cards.find((c) => c.key === 'exception')).toMatchObject({
      label: 'Exception Triage',
      count: 4,
      unit: 'open',
    });
  });

  it('returns a stable 10-card set (8 agents + exception + lifecycle), zeros included', () => {
    const cards = summarizeAgentActivity([], 0);
    expect(cards.map((c) => c.key)).toEqual([
      'intake',
      'outreach',
      'idp',
      'chain',
      'docgen',
      'recording',
      'internal_comm',
      'borrower_comm',
      'exception',
      'lifecycle',
    ]);
    expect(cards.every((c) => c.count === 0)).toBe(true);
  });

  it('does not cross-map similar prefixes (internal_comm vs intake)', () => {
    const cards = summarizeAgentActivity([{ action: 'internal_comm.notified', count: 3 }], 0);
    expect(cards.find((c) => c.key === 'intake')?.count).toBe(0);
    expect(cards.find((c) => c.key === 'internal_comm')?.count).toBe(3);
  });
});
