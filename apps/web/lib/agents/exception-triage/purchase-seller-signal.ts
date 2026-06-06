// Statuses by which a Purchase CEMA must have its seller party identified: the
// seller's mortgage is what is assumed, so the seller is needed from the
// collateral chase through recording. Earlier stages (intake / eligibility /
// authorization) are where the seller is still being added; terminal stages
// (completed / cancelled) are done; `exception` is already surfaced on its own.
// Design doc D2: docs/plans/2026-06-06-purchase-cema-data-model.md / ADR 0019.
const SELLER_REQUIRED_STATUSES: ReadonlySet<string> = new Set([
  'collateral_chase',
  'title_work',
  'doc_prep',
  'attorney_review',
  'closing',
  'recording',
]);

/**
 * Whether a deal is a Purchase CEMA that has reached a stage where its `seller`
 * party must be present but is missing — the soft well-formedness check D2 (a
 * processor must add the seller before document generation). Refi deals (which
 * have no seller) and early/terminal Purchase stages never flag.
 *
 * Pure: the aggregator passes `cemaType`/`status` plus a precomputed `hasSeller`
 * from an RLS-scoped parties query, so this stays node-testable (no DB).
 */
export function isPurchaseMissingSeller(
  cemaType: string,
  status: string,
  hasSeller: boolean,
): boolean {
  return cemaType === 'purchase_cema' && SELLER_REQUIRED_STATUSES.has(status) && !hasSeller;
}
