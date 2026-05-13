import { describe, expect, it } from 'vitest';

import { requireAttorneyApproval } from './attorney-review';

describe('attorney review guard', () => {
  it('approved documents pass the guard', () => {
    expect(() =>
      requireAttorneyApproval({
        kind: 'cema_3172',
        status: 'approved',
        attorneyReviewRequired: true,
      }),
    ).not.toThrow();
  });

  it('draft cema_3172 throws AttorneyReviewRequiredError', () => {
    expect(() =>
      requireAttorneyApproval({
        kind: 'cema_3172',
        status: 'draft',
        attorneyReviewRequired: true,
      }),
    ).toThrow(/attorney review required/i);
  });

  it('non-gate-required documents bypass the guard', () => {
    expect(() =>
      requireAttorneyApproval({
        kind: 'payoff_letter',
        status: 'draft',
        attorneyReviewRequired: false,
      }),
    ).not.toThrow();
  });
});
