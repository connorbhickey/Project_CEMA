import { describe, expect, it } from 'vitest';

import { chainQueueSummary } from './chain-queue-summary';

describe('chainQueueSummary', () => {
  it('counts pending, claimed, and total', () => {
    expect(
      chainQueueSummary([{ state: 'pending' }, { state: 'claimed' }, { state: 'pending' }]),
    ).toEqual({ pending: 2, claimed: 1, total: 3 });
  });

  it('returns zeroes for an empty queue', () => {
    expect(chainQueueSummary([])).toEqual({ pending: 0, claimed: 0, total: 0 });
  });

  it('counts a terminal row toward total but not the pending/claimed breakdown', () => {
    expect(chainQueueSummary([{ state: 'resolved' }, { state: 'pending' }])).toEqual({
      pending: 1,
      claimed: 0,
      total: 2,
    });
  });
});
