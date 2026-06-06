// Exception Triage vocabulary (spec §9.11). Covers the exception kinds derivable
// from live signals the other Layer-3 agents already emit; SLA/time,
// unreadable-collateral, and borrower-lapse are still deferred. `rejected_recording`
// (a Phase-2 kind) is derived from the Recording Prep Agent's `recording.rejected`
// audit. No @cema/db, no clock, no LLM -- the core is a pure classifier over
// DealSignals the app aggregator gathers.

export const EXCEPTION_KINDS = [
  'chain_break',
  'agent_dispatch_failed',
  'deal_flagged_exception',
  'rejected_recording',
  'purchase_missing_seller',
] as const;
export type ExceptionKind = (typeof EXCEPTION_KINDS)[number];

export const EXCEPTION_SEVERITIES = ['low', 'medium', 'high', 'blocking'] as const;
export type ExceptionSeverity = (typeof EXCEPTION_SEVERITIES)[number];

// Where a triaged exception should go. A SUGGESTED pointer to an existing remedy
// (the chain review queue, a pipeline re-run, processor follow-up) -- v1 does not
// actuate, it surfaces.
export const EXCEPTION_ROUTES = ['attorney_review', 'reprocess', 'processor_review'] as const;
export type ExceptionRoute = (typeof EXCEPTION_ROUTES)[number];

// One classified exception. `reason` is a static PII-free template -- safe to
// persist/display (no ids, counts, party names, or amounts).
export interface Exception {
  readonly kind: ExceptionKind;
  readonly severity: ExceptionSeverity;
  readonly route: ExceptionRoute;
  readonly reason: string;
}

// The live signals the app aggregator gathers per deal and feeds to the pure
// classifier. Plain data (no DB types) so triageExceptions stays node-testable.
export interface DealSignals {
  readonly dealStatus: string; // deals.status
  readonly chainBreakCount: number; // open chain_break_review_queue rows for the deal
  readonly dispatchFailed: boolean; // a deal.agent_dispatch_failed audit exists for the deal
  readonly recordingRejected: boolean; // a recording.rejected audit exists for the deal
  // A Purchase CEMA that has reached an active processing stage but has no
  // `seller` party (the aggregator computes the stage gate). Design doc D2:
  // docs/plans/2026-06-06-purchase-cema-data-model.md / ADR 0019.
  readonly purchaseMissingSeller: boolean;
}
