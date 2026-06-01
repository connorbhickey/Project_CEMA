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
} as const;

export type ErrorId = (typeof ERROR_IDS)[keyof typeof ERROR_IDS];
