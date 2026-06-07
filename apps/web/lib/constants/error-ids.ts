// Stable, greppable error IDs for swallowed/best-effort failures. These tokens
// prefix the redacted console line AND name the durable audit/observability
// record, so an operator can grep logs or query audit_events for the same ID.
//
// Swallow sites route these IDs through the single `reportSwallowedError` seam
// (lib/observability/report-error.ts), which records a PII-safe event on the
// active OpenTelemetry span. Sentry capture is a DSN-gated add on that one seam.
// The ID also prefixes the inline console line and (for the comms paths) names
// the durable split-audit gap, so the same failure is greppable + queryable.
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
  /** The additive, env-gated intake savings narrative (a configured AI-Gateway
   *  model call) threw and was swallowed so the deterministic intake Deal — which
   *  is already created and complete — still returns to the processor. The
   *  narrative is an OPTIONAL enhancement, never a hard dependency; this token is
   *  the greppable + Sentry-routed signal that a configured model call failed. */
  INTAKE_NARRATIVE_FAILED: 'INTAKE_NARRATIVE_FAILED',
} as const;

export type ErrorId = (typeof ERROR_IDS)[keyof typeof ERROR_IDS];
