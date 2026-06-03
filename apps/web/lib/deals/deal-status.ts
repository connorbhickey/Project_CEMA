/**
 * Canonical deal_status display labels (Title Case) + searchParam validation.
 * Single source of truth for status labels across the dashboard funnel and the
 * /deals filter. The drift-guard test asserts these keys stay in lockstep with
 * the deal_status pg enum (so a future status can't silently lose a label).
 */
export const DEAL_STATUS_LABELS = {
  intake: 'Intake',
  eligibility: 'Eligibility',
  authorization: 'Authorization',
  collateral_chase: 'Collateral Chase',
  title_work: 'Title Work',
  doc_prep: 'Doc Prep',
  attorney_review: 'Attorney Review',
  closing: 'Closing',
  recording: 'Recording',
  completed: 'Completed',
  exception: 'Exception',
  cancelled: 'Cancelled',
} as const;

export type DealStatus = keyof typeof DEAL_STATUS_LABELS;

/** Display label for a status, or the raw value if unknown. */
export function dealStatusLabel(status: string): string {
  return (DEAL_STATUS_LABELS as Record<string, string>)[status] ?? status;
}

/**
 * Validate an untrusted `?status=` searchParam against the known statuses.
 * Returns the status if valid, else null (→ show all) — the boundary guard that
 * keeps the deals query total (no `WHERE status = '<garbage>'`).
 */
export function parseDealStatusFilter(raw: string | undefined | null): DealStatus | null {
  return raw != null && raw in DEAL_STATUS_LABELS ? (raw as DealStatus) : null;
}
