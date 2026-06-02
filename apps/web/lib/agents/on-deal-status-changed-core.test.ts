import { describe, expect, it } from 'vitest';

import type { DealStatus } from '../actions/transition-deal-status';

import { triggerForStatus } from './on-deal-status-changed-core';

// Every deal_status value that is NOT wired to an agent. Kept explicit (rather
// than derived) so adding a new trigger forces a deliberate edit here.
const UNWIRED: DealStatus[] = [
  'intake',
  'eligibility',
  'authorization',
  'attorney_review',
  'closing',
  'recording',
  'completed',
  'exception',
  'cancelled',
];

describe('triggerForStatus', () => {
  it("maps 'collateral_chase' to the outreach agent", () => {
    expect(triggerForStatus('collateral_chase')).toBe('outreach');
  });

  it("maps 'title_work' to the collateral pipeline", () => {
    expect(triggerForStatus('title_work')).toBe('collateral_pipeline');
  });

  it("maps 'doc_prep' to the doc_gen agent", () => {
    expect(triggerForStatus('doc_prep')).toBe('doc_gen');
  });

  it('returns null for every status with no wired agent', () => {
    for (const status of UNWIRED) {
      expect(triggerForStatus(status)).toBeNull();
    }
  });
});
