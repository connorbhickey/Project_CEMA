export interface AuditEventDescription {
  readonly label: string;
  readonly detail: string | null;
}

// action -> human label. Covers the agent + lifecycle actions emitted with
// entityType='deal'. Split-audit pre-events (.evaluated / .planned) are labeled
// too -- the trail is complete + honest.
const LABEL_BY_ACTION: Record<string, string> = {
  'deal.created': 'Deal created',
  'deal.status_changed': 'Status changed',
  'deal.agent_dispatch_failed': 'Agent dispatch failed',
  'intake.evaluated': 'Intake evaluated',
  'idp.evaluated': 'Collateral IDP evaluated',
  'idp.documents_classified': 'Collateral documents classified',
  'chain.analyzed': 'Chain-of-title analyzed',
  'chain.routed': 'Chain findings routed',
  'chain.break_routed': 'Chain break routed for review',
  'docgen.evaluated': 'Doc generation evaluated',
  'docgen.generated': 'CEMA documents generated',
  'docgen.inconsistent': "Doc generation blocked (numbers don't tie)",
  'recording.evaluated': 'Recording prep evaluated',
  'recording.prepared': 'Recording package prepared',
  'recording.completed': 'Recording completed',
  'recording.rejected': 'Recording rejected',
  'internal_comm.evaluated': 'Internal notification evaluated',
  'internal_comm.notified': 'Internal notification sent',
  'borrower_comm.evaluated': 'Borrower notification evaluated',
  'borrower_comm.notified': 'Borrower emailed',
  'outreach.planned': 'Servicer outreach planned',
  'outreach.touch_sent': 'Servicer outreach sent',
  'document.submitted_for_review': 'Document queued for attorney review',
  'document.approved': 'Document approved',
  'document.rejected': 'Document rejected',
  // Processor edits via the deal-data editors (Tier-1 batch). entityType='deal',
  // so they show on the deal agent-activity timeline; explicit labels + the
  // PII-safe detail below beat the humanized fallback.
  'party.added': 'Party added',
  'party.updated': 'Party updated',
  'party.removed': 'Party removed',
  'loan.added': 'Existing loan added',
  'loan.updated': 'Existing loan updated',
  'loan.removed': 'Existing loan removed',
};

// Per-action PII-safe detail builders. Each reads ONLY whitelisted metadata
// fields (enum / token / count) -- never a raw dump. Returns null if the field
// is absent or the wrong type. Defense in depth: an action with no builder here
// renders a label only, so new audited events can never leak metadata.
const DETAIL_BY_ACTION: Record<string, (m: Record<string, unknown>) => string | null> = {
  'deal.status_changed': (m) =>
    typeof m.from === 'string' && typeof m.to === 'string' ? `${m.from} → ${m.to}` : null,
  'docgen.generated': (m) => (typeof m.count === 'number' ? `${m.count} documents` : null),
  'docgen.evaluated': (m) => (typeof m.count === 'number' ? `${m.count} planned` : null),
  'internal_comm.notified': (m) => (typeof m.channel === 'string' ? `via ${m.channel}` : null),
  'borrower_comm.notified': (m) => (typeof m.channel === 'string' ? `via ${m.channel}` : null),
  'outreach.touch_sent': (m) =>
    typeof m.touchNumber === 'number' ? `touch #${m.touchNumber}` : null,
  'recording.evaluated': (m) => (typeof m.count === 'number' ? `${m.count} planned` : null),
  'recording.prepared': (m) => (typeof m.count === 'number' ? `${m.count} cover sheets` : null),
  'recording.completed': (m) => (typeof m.venue === 'string' ? `via ${m.venue}` : null),
  'recording.rejected': (m) => (typeof m.reason === 'string' ? `reason: ${m.reason}` : null),
  // Party/loan edits: surface the role (humanized) / chain position only — both
  // PII-safe enum/count fields (never the party name or the UPB dollar figure).
  'party.added': (m) => (typeof m.role === 'string' && m.role ? humanize(m.role) : null),
  'party.updated': (m) => (typeof m.role === 'string' && m.role ? humanize(m.role) : null),
  'party.removed': (m) => (typeof m.role === 'string' && m.role ? humanize(m.role) : null),
  'loan.added': (m) =>
    typeof m.chainPosition === 'number' ? `chain position ${m.chainPosition}` : null,
  'loan.updated': (m) =>
    typeof m.chainPosition === 'number' ? `chain position ${m.chainPosition}` : null,
  'loan.removed': (m) =>
    typeof m.chainPosition === 'number' ? `chain position ${m.chainPosition}` : null,
};

// Humanize an unknown action: 'foo.bar_baz' -> 'Foo bar baz'.
function humanize(action: string): string {
  const words = action.replace(/[._]/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Pure: map an audit action + metadata to a display label + a PII-safe detail.
 * Unknown actions get a humanized fallback label and no detail. The detail is
 * built only from per-action whitelisted fields (defense in depth: never render
 * raw metadata, even though agent metadata is PII-safe by policy).
 */
export function describeAuditEvent(
  action: string,
  metadata: Record<string, unknown> | null | undefined,
): AuditEventDescription {
  const label = LABEL_BY_ACTION[action] ?? humanize(action);
  const detail = DETAIL_BY_ACTION[action]?.(metadata ?? {}) ?? null;
  return { label, detail };
}
