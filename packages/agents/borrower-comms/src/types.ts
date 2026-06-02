// Borrower Comms vocabulary (spec §9.9). Email-only v1 (TCPA-exempt). Pure: no
// @cema/db, no clock, no LLM -- the core takes a plain status string so it stays
// node-testable.

export const BORROWER_NOTIFY_STATUSES = ['authorization', 'closing', 'completed'] as const;
export type BorrowerNotifyStatus = (typeof BORROWER_NOTIFY_STATUSES)[number];

// v1 is email-only. A single-member union (not a bare string): adding 'sms' later
// is a deliberate type change that forces the consent path (hard rule #4 -- call
// tcpaGuard before any SMS send; email is TCPA-exempt).
export const BORROWER_CHANNELS = ['email'] as const;
export type BorrowerChannel = (typeof BORROWER_CHANNELS)[number];

// Pure-core output. Static PII-free email content (no name, amount, id, account).
export interface BorrowerNotification {
  readonly status: BorrowerNotifyStatus;
  readonly channel: BorrowerChannel;
  readonly subject: string;
  readonly body: string;
}

// What the channel adapter sends. `to` is the borrower's email -- required by the
// adapter, but it is PII and MUST NOT enter logs/audits/spans (hard rule #3);
// only `partyId` is logged.
export interface BorrowerCommPacket {
  readonly dealId: string;
  readonly partyId: string;
  readonly status: BorrowerNotifyStatus;
  readonly channel: BorrowerChannel;
  readonly to: string;
  readonly subject: string;
  readonly body: string;
}

export interface ChannelSendResult {
  readonly accepted: boolean;
  readonly channelMessageId?: string;
}

export interface BorrowerChannelAdapter {
  send(packet: BorrowerCommPacket): Promise<ChannelSendResult>;
}
