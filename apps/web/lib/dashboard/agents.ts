/**
 * The Layer-3 / Phase-2 agent fleet, in pipeline order. Single source of truth
 * for the dashboard stat cards. Each agent's deal-scoped audit actions share a
 * dotted prefix (e.g. 'idp.'), which summarizeAgentActivity folds counts into.
 *
 * Exception Triage is intentionally absent here: it is a pull/derive agent that
 * emits no audit actions of its own (get-org-exceptions.ts only reads others'
 * audits), so its card count comes from open exceptions, not this prefix fold.
 */
export interface AgentDescriptor {
  readonly key: string;
  readonly label: string;
  readonly prefix: string;
}

export const AGENTS: readonly AgentDescriptor[] = [
  { key: 'intake', label: 'Intake', prefix: 'intake.' },
  { key: 'outreach', label: 'Servicer Outreach', prefix: 'outreach.' },
  { key: 'idp', label: 'Collateral IDP', prefix: 'idp.' },
  { key: 'chain', label: 'Chain of Title', prefix: 'chain.' },
  { key: 'docgen', label: 'Doc Generation', prefix: 'docgen.' },
  { key: 'recording', label: 'Recording Prep', prefix: 'recording.' },
  { key: 'internal_comm', label: 'Internal Comms', prefix: 'internal_comm.' },
  { key: 'borrower_comm', label: 'Borrower Comms', prefix: 'borrower_comm.' },
];

/** Exception Triage — counted from open exceptions, not audit actions. */
export const EXCEPTION_TRIAGE_AGENT = { key: 'exception', label: 'Exception Triage' } as const;

/** The Lifecycle bucket — deal-scoped non-agent events (deal.*) + any unmapped action. */
export const LIFECYCLE_BUCKET = { key: 'lifecycle', label: 'Lifecycle & Status' } as const;
