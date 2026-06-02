import { describeAuditEvent } from './describe-audit-event';

/** A row from the org-wide agent-activity loader (audit_events ⋈ deals ⋈ properties).
 *  The mapper defines this contract; getOrgAgentActivity fulfills it. */
export interface OrgAgentActivityRow {
  readonly id: string;
  readonly action: string;
  readonly occurredAt: Date;
  readonly metadata: Record<string, unknown>;
  readonly dealId: string;
  readonly cemaType: string;
  readonly status: string;
  readonly streetAddress: string | null;
  readonly city: string | null;
}

/** The view model the dashboard feed renders (one row). */
export interface OrgActivityItem {
  readonly id: string;
  readonly dealId: string;
  readonly label: string;
  readonly detail: string | null;
  readonly context: string;
  readonly occurredAt: Date;
}

/**
 * Pure: map a loader row to the dashboard view model. Delegates the action
 * label/detail to describeAuditEvent (PII-safe whitelist) and builds a PII-safe
 * deal-context string from enum/token/address fields only -- never a borrower
 * name, so no name+address PII combo (hard rule #3).
 */
export function toOrgActivityItem(row: OrgAgentActivityRow): OrgActivityItem {
  const { label, detail } = describeAuditEvent(row.action, row.metadata);
  const cemaLabel = row.cemaType === 'refi_cema' ? 'Refi CEMA' : 'Purchase CEMA';
  const address = [row.streetAddress, row.city].filter((s): s is string => !!s).join(', ');
  const context = [cemaLabel, row.status, address].filter((s) => s.length > 0).join(' · ');
  return { id: row.id, dealId: row.dealId, label, detail, context, occurredAt: row.occurredAt };
}
