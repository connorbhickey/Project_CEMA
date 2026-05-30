/** Submission methods a servicer CEMA department accepts (mirrors the DB
 * `submission_method` enum stored in the jsonb `accepted_submission_methods`). */
export type SubmissionMethod = 'email' | 'portal' | 'fax_only' | 'usps';

/** The resolved cadence for one deal: absolute due-dates per touch + the
 * resolved primary channel. Produced by {@link planOutreachCadence}. */
export interface OutreachCadence {
  readonly dueAt: Date[];
  readonly channel: SubmissionMethod | null;
}

export type ServicerResponseKind = 'delivered' | 'rejected' | 'needs_info' | 'other';

/** Classified inbound servicer response. Populated by the (dormant) classifier;
 * `null`/`other` means "no actionable response yet" → cadence continues. */
export interface ServicerResponse {
  readonly kind: ServicerResponseKind;
}

/** The decision returned by {@link nextOutreachAction}. */
export type OutreachAction =
  | { readonly kind: 'send'; readonly touchNumber: number }
  | { readonly kind: 'wait'; readonly until: Date }
  | { readonly kind: 'stop'; readonly reason: 'responded' | 'exhausted' }
  | { readonly kind: 'unsupported_channel'; readonly method: SubmissionMethod | null };

/** Everything the orchestrator needs about one deal to decide + send. All
 * effectful reads happen in {@link OutreachDeps.loadContext}; this is the
 * serializable result. */
export interface OutreachContext {
  readonly dealId: string;
  readonly organizationId: string;
  readonly servicerName: string | null;
  readonly departmentEmail: string | null;
  readonly acceptedSubmissionMethods: SubmissionMethod[];
  /** Stable anchor: earliest recorded touch, else now() on first run. */
  readonly triggeredAt: Date;
  readonly touchesSent: number;
  readonly response: ServicerResponse | null;
}

/** A fully-rendered outbound packet handed to the channel adapter. */
export interface OutreachPacket {
  readonly channel: SubmissionMethod;
  readonly to: string;
  readonly subject: string;
  readonly body: string;
  readonly touchNumber: number;
  readonly dealId: string;
}

export interface ChannelSendResult {
  readonly accepted: boolean;
  readonly channelMessageId: string | null;
}

/** Persisted after a successful send (drives touchesSent on re-evaluation). */
export interface OutreachTouchRecord {
  readonly dealId: string;
  readonly touchNumber: number;
  readonly channel: SubmissionMethod;
  readonly to: string;
  readonly channelMessageId: string | null;
}

export interface OutreachAuditEvent {
  readonly action: 'outreach.planned' | 'outreach.touch_sent';
  readonly dealId: string;
  readonly touchNumber: number | null;
  readonly channel: SubmissionMethod | null;
}

/** Pluggable delivery seam (FixtureChannelAdapter today, Resend later). */
export interface ServicerChannelAdapter {
  send(packet: OutreachPacket): Promise<ChannelSendResult>;
}

/** All effects the orchestrator depends on — injected, never imported. */
export interface OutreachDeps {
  readonly channel: ServicerChannelAdapter;
  loadContext(dealId: string): Promise<OutreachContext>;
  recordTouch(record: OutreachTouchRecord): Promise<void>;
  emitAudit(event: OutreachAuditEvent): Promise<void>;
  now(): Date;
}

export interface OutreachResult {
  readonly dealId: string;
  readonly action: OutreachAction;
  readonly touchSent: number | null;
}
