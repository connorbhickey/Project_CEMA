import { describe, expect, it } from 'vitest';

import { reviewActionMode } from './review-action-mode';

describe('reviewActionMode', () => {
  it('returns "review" when a queue row exists, regardless of the gate flag', () => {
    expect(reviewActionMode({ queueId: 'q1', attorneyReviewRequired: true })).toBe('review');
    expect(reviewActionMode({ queueId: 'q1', attorneyReviewRequired: false })).toBe('review');
  });

  it('returns "submit" for an unqueued gate-required document', () => {
    expect(reviewActionMode({ queueId: null, attorneyReviewRequired: true })).toBe('submit');
  });

  it('returns "none" for an unqueued document that does not require review', () => {
    expect(reviewActionMode({ queueId: null, attorneyReviewRequired: false })).toBe('none');
  });
});
