import {
  DEAL_CREATED_MESSAGE,
  NOTIFY_STATUSES,
  type DealCreatedNotification,
  type InternalNotification,
  type NotifyStatus,
} from './types';

// Static, PII-free message per notify-worthy status (no ids/counts/party names).
const MESSAGE_BY_STATUS: Record<NotifyStatus, string> = {
  attorney_review: 'A deal has entered attorney review and is ready for an attorney to act.',
  collateral_chase: 'A deal is awaiting the collateral file from the prior servicer.',
  authorization: 'A deal is awaiting borrower authorization to proceed.',
  exception: 'A deal has been flagged as an exception and needs attention.',
};

// Exhaustiveness guard: if NOTIFY_STATUSES gains a member the map does not
// cover, throw at module load rather than emit an undefined message (mirrors
// ROUTE_BY_BREAK in @cema/agents-chain-of-title and the Exception-Triage maps).
for (const status of NOTIFY_STATUSES) {
  if (!(status in MESSAGE_BY_STATUS)) {
    throw new Error(`internal-comms message map is missing an entry for "${status}"`);
  }
}

/**
 * Pure, deterministic notify decision (spec §9.10). Given a freshly-entered
 * deal_status, returns the internal notification to post, or null for the
 * routine/terminal statuses that do not warrant one. No clock, no LLM, no IO.
 * PII-safe by construction (enum tokens + static reasons only).
 */
export function notificationForStatus(status: string): InternalNotification | null {
  if (!(NOTIFY_STATUSES as readonly string[]).includes(status)) return null;
  const s = status as NotifyStatus;
  return { status: s, channel: 'pipeline', message: MESSAGE_BY_STATUS[s] };
}

/**
 * The internal notification posted when a NEW deal is created (ADR 0010 #8). Pure
 * + always non-null — every new deal warrants a "entered the pipeline" notice, so
 * (unlike notificationForStatus) there is no skip case. PII-safe static message.
 */
export function dealCreatedNotification(): DealCreatedNotification {
  return { channel: 'pipeline', message: DEAL_CREATED_MESSAGE };
}
