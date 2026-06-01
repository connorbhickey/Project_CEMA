export type ReviewActionMode = 'submit' | 'review' | 'none';

/**
 * Pure decision for which control the review-actions island renders, split out
 * of the `'use client'` component so it unit-tests under the node vitest env
 * (apps/web has no jsdom). A queued document is always in `review` mode (the
 * queue row drives claim/approve/reject) regardless of the gate flag; an
 * unqueued gate-required document offers `submit`; everything else is `none`.
 */
export function reviewActionMode(input: {
  queueId: string | null;
  attorneyReviewRequired: boolean;
}): ReviewActionMode {
  if (input.queueId !== null) return 'review';
  if (input.attorneyReviewRequired) return 'submit';
  return 'none';
}
