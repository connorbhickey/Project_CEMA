import {
  BORROWER_NOTIFY_STATUSES,
  type BorrowerNotification,
  type BorrowerNotifyStatus,
} from './types';

// Static, PII-free email content per borrower touchpoint (no name/amount/id).
const TEMPLATE_BY_STATUS: Record<BorrowerNotifyStatus, { subject: string; body: string }> = {
  authorization: {
    subject: 'Action needed on your CEMA',
    body: 'We need your authorization to proceed with your CEMA. Your processing team will follow up shortly with the details and next steps.',
  },
  closing: {
    subject: 'Your CEMA is scheduled to close',
    body: 'Good news — your CEMA is ready for closing. Your processing team will be in touch with the closing details and next steps.',
  },
  completed: {
    subject: 'Your CEMA is complete',
    body: 'Your CEMA has closed and been recorded. Thank you for working with us. Your processing team will send any final documentation.',
  },
};

// Exhaustiveness guard: a new BORROWER_NOTIFY_STATUSES member without a template
// throws at load (mirrors ROUTE_BY_BREAK / the Internal-Comms map).
for (const status of BORROWER_NOTIFY_STATUSES) {
  if (!(status in TEMPLATE_BY_STATUS)) {
    throw new Error(`borrower-comms template map is missing an entry for "${status}"`);
  }
}

/**
 * Pure, deterministic borrower-notify decision (spec §9.9). Returns the email
 * notification for a borrower touchpoint status, or null otherwise. No clock,
 * no LLM, no IO. PII-safe by construction (static templates, enum tokens).
 */
export function borrowerNotificationForStatus(status: string): BorrowerNotification | null {
  if (!(BORROWER_NOTIFY_STATUSES as readonly string[]).includes(status)) return null;
  const s = status as BorrowerNotifyStatus;
  const { subject, body } = TEMPLATE_BY_STATUS[s];
  return { status: s, channel: 'email', subject, body };
}
