/**
 * Human labels for exception kinds + suggested routes, shown on the org `/exceptions`
 * inbox and the per-deal exceptions tab. Drift-guarded in the test vs the agent's
 * exported EXCEPTION_KINDS / EXCEPTION_ROUTES so a new kind/route can't lose a label.
 */

export const EXCEPTION_KIND_LABELS = {
  chain_break: 'Chain Break',
  agent_dispatch_failed: 'Agent Dispatch Failed',
  deal_flagged_exception: 'Flagged Exception',
  rejected_recording: 'Rejected Recording',
  purchase_missing_seller: 'Missing Seller',
} as const;

export const EXCEPTION_ROUTE_LABELS = {
  attorney_review: 'Attorney Review',
  reprocess: 'Reprocess',
  processor_review: 'Processor Review',
} as const;

/** Display label for an exception kind, or the raw token if unknown. */
export function exceptionKindLabel(kind: string): string {
  return (EXCEPTION_KIND_LABELS as Record<string, string>)[kind] ?? kind;
}

/** Display label for an exception route, or the raw token if unknown. */
export function exceptionRouteLabel(route: string): string {
  return (EXCEPTION_ROUTE_LABELS as Record<string, string>)[route] ?? route;
}
