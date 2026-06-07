/**
 * Human labels for a document's lifecycle status (`document_status`) and its
 * attorney-review-queue state (`document_review_state`), used on the documents
 * surface. Each is drift-guarded vs its pg enum in the test.
 */

export const DOCUMENT_STATUS_LABELS = {
  draft: 'Draft',
  attorney_review: 'In Attorney Review',
  approved: 'Approved',
  executed: 'Executed',
  recorded: 'Recorded',
  rejected: 'Rejected',
} as const;

export const REVIEW_STATE_LABELS = {
  pending: 'Pending',
  claimed: 'Claimed',
  approved: 'Approved',
  rejected: 'Rejected',
} as const;

/** Display label for a document status, or the raw token if unknown. */
export function documentStatusLabel(status: string): string {
  return (DOCUMENT_STATUS_LABELS as Record<string, string>)[status] ?? status;
}

/** Display label for an attorney-review-queue state, or the raw token if unknown. */
export function reviewStateLabel(state: string): string {
  return (REVIEW_STATE_LABELS as Record<string, string>)[state] ?? state;
}
