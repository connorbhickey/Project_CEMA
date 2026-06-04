// Stable, greppable error IDs for swallowed/best-effort failures. These tokens
// prefix the redacted console line AND name the durable audit/observability
// record, so an operator can grep logs or query audit_events for the same ID.
//
// No Sentry client is wired in apps/web yet (see lib/audit/with-read-audit.ts:
// "Phase 1 will route the catch to Sentry"). When it lands, route on these IDs
// from one place; until then the ID + the durable audit event are the signal.
export const ERROR_IDS = {
  /** A post-commit Layer-3 agent dispatch (onDealStatusChanged) threw and was
   *  swallowed so the already-committed deal-status write survives. */
  AGENT_DISPATCH_FAILED: 'AGENT_DISPATCH_FAILED',
  /** A post-commit internal-comms notification (notifyInternal) threw and was
   *  swallowed so the already-committed deal-status write survives. The durable
   *  trail is the split audit: an `internal_comm.evaluated` row WITHOUT a
   *  following `internal_comm.notified` is the queryable record of this failure;
   *  this token is the matching greppable console line. */
  INTERNAL_COMM_NOTIFY_FAILED: 'INTERNAL_COMM_NOTIFY_FAILED',
  /** A post-commit borrower-comms notification (notifyBorrower) threw for a
   *  borrower party and was swallowed so the already-committed deal-status write
   *  survives. The durable trail is the split audit: a `borrower_comm.evaluated`
   *  row WITHOUT a following `borrower_comm.notified` is the queryable failure
   *  record; this token is the matching greppable console line. */
  BORROWER_COMM_NOTIFY_FAILED: 'BORROWER_COMM_NOTIFY_FAILED',
  /** The fire-and-forget read-audit insert (withReadAudit) threw and was
   *  swallowed so the data fetch the caller already completed still returns.
   *  This token is the greppable signal; the read audit is best-effort, so —
   *  unlike the split-audit comms paths — there is no durable failure record. */
  READ_AUDIT_WRITE_FAILED: 'READ_AUDIT_WRITE_FAILED',
} as const;

export type ErrorId = (typeof ERROR_IDS)[keyof typeof ERROR_IDS];
