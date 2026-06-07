// Internal Comms vocabulary (spec §9.10). v1 notifies on the deal_status
// transitions that map to the spec's trigger categories (ready-for-review /
// awaiting-input / exception); routine pipeline progress + terminal milestones
// are deferred. Pure: no @cema/db, no clock, no LLM -- the core takes a plain
// status string (the Exception-Triage decoupling) so it stays node-testable.

export const NOTIFY_STATUSES = [
  'authorization', // awaiting-input (borrower authorization)
  'collateral_chase', // awaiting-input (prior servicer's collateral file)
  'attorney_review', // ready-for-review
  'exception', // exception
] as const;
export type NotifyStatus = (typeof NOTIFY_STATUSES)[number];

// v1 has a single internal destination. A union (not a bare string) so a real
// adapter can exhaustively map each token to a Slack channel id later, and so
// status->channel routing is a trivial future extension.
export const INTERNAL_CHANNELS = ['pipeline'] as const;
export type InternalChannel = (typeof INTERNAL_CHANNELS)[number];

// Pure-core output. `message` is a static PII-free template (no ids, counts,
// party names, or amounts) -- safe to post/persist.
export interface InternalNotification {
  readonly status: NotifyStatus;
  readonly channel: InternalChannel;
  readonly message: string;
}

// Static PII-free announcement posted when a NEW deal is created (spec §9.10 /
// ADR 0010 #8 — the loan-officer / team "new deal entered the pipeline" notice).
// Distinct from a status transition: creation is not a deal_status.
export const DEAL_CREATED_MESSAGE = 'A new deal has been created and entered the pipeline.';

// Pure-core output for the deal-created trigger. No `status` (creation is not a
// deal_status); the channel + static message are all the dormant Fixture needs.
export interface DealCreatedNotification {
  readonly channel: InternalChannel;
  readonly message: string;
}

// What the channel adapter sends. Carries the opaque dealId (NOT PII) so a real
// Slack adapter can render a deep link; the Fixture just records it. `status` is
// optional: present for status-transition notifications, absent for the
// deal-created announcement (which carries no deal_status).
export interface InternalCommPacket {
  readonly dealId: string;
  readonly status?: NotifyStatus;
  readonly channel: InternalChannel;
  readonly message: string;
}

export interface ChannelSendResult {
  readonly accepted: boolean;
  readonly channelMessageId?: string;
}

export interface InternalChannelAdapter {
  send(packet: InternalCommPacket): Promise<ChannelSendResult>;
}
