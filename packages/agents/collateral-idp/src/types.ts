// The full document_kind enum, re-declared locally so this package never
// imports @cema/db at runtime (the WDK '"use workflow"' sandbox VM cannot load
// it). A drift guard (types.test.ts) keeps this in lockstep with the DB enum.
export const DOCUMENT_KINDS = [
  'note',
  'mortgage',
  'aom',
  'allonge',
  'cema_3172',
  'exhibit_a',
  'exhibit_b',
  'exhibit_c',
  'exhibit_d',
  'consolidated_note',
  'gap_note',
  'gap_mortgage',
  'aff_255',
  'aff_275',
  'mt_15',
  'nyc_rpt',
  'tp_584',
  'acris_cover_pages',
  'county_cover_sheet',
  'payoff_letter',
  'authorization',
  'title_commitment',
  'title_policy',
  'endorsement_111',
  'other',
] as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

// The 14 kinds that legally require an attorney-review gate (hard rule #2 +
// the documents_attorney_gate_required DB check constraint). classify() sets
// attorneyReviewRequired=true for exactly these.
export const GATE_REQUIRED_KINDS = [
  'cema_3172',
  'exhibit_a',
  'exhibit_b',
  'exhibit_c',
  'exhibit_d',
  'gap_note',
  'gap_mortgage',
  'consolidated_note',
  'aom',
  'allonge',
  'aff_255',
  'aff_275',
  'mt_15',
  'county_cover_sheet',
] as const satisfies readonly DocumentKind[];

// A segment whose extraction confidence is below this floor is treated as
// unreadable and is NOT classified/persisted (it surfaces for human review).
export const UNREADABLE_CONFIDENCE_THRESHOLD = 0.5;

export interface RecordingRef {
  readonly reelPage: string | null;
  readonly crfn: string | null;
}

export interface InstrumentRecord {
  readonly documentId: string;
  readonly instrumentKind: DocumentKind;
  readonly assignor: string | null;
  readonly assignee: string | null;
  readonly executedAt: string | null;
  readonly recordedAt: string | null;
  readonly amount: number | null;
  readonly recordingRef: RecordingRef;
  readonly county: string | null;
  readonly references: string | null;
}

// What the (dormant) vendor IDP adapter returns per blob segment. Pure data:
// the raw OCR text, a flat field bag, and a 0..1 confidence.
export interface RawExtraction {
  readonly text: string | null;
  readonly fields: Readonly<Record<string, string | null>>;
  readonly confidence: number;
}

export interface CollateralDocumentRef {
  readonly documentId: string;
  readonly blobUrl: string;
}

export interface IdpContext {
  readonly dealId: string;
  readonly documents: readonly CollateralDocumentRef[];
}

export interface ClassifiedDoc {
  readonly documentId: string;
  readonly kind: DocumentKind;
  readonly attorneyReviewRequired: boolean;
  readonly instrument: InstrumentRecord;
}

export interface UnreadableSegment {
  readonly documentId: string;
  readonly blobUrl: string;
}

// Split-audit actions. emitAudit emits idp.evaluated (always, before any write);
// the app-wiring persistDocuments emits idp.documents_classified co-transactionally.
export interface IdpAuditEvent {
  readonly action: 'idp.evaluated' | 'idp.documents_classified';
  readonly dealId: string;
  readonly documentCount: number;
  readonly unreadableCount: number;
  readonly gateRequiredCount: number;
}

// The dormant vendor seam: one blob -> zero-or-more raw extractions.
export interface IdpAdapter {
  extractDocuments(blobUrl: string): Promise<readonly RawExtraction[]>;
}

// Every effect the core needs, injected. No clock (IDP is not time-based) and
// no LLM (classify/extract are pure deterministic functions).
export interface IdpDeps {
  readonly idp: IdpAdapter;
  loadContext(dealId: string): Promise<IdpContext>;
  persistDocuments(dealId: string, docs: readonly ClassifiedDoc[]): Promise<void>;
  emitAudit(event: IdpAuditEvent): Promise<void>;
}

export interface IdpResult {
  readonly dealId: string;
  readonly documents: readonly ClassifiedDoc[];
  readonly unreadable: readonly UnreadableSegment[];
}
