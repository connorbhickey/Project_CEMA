import type { DocumentKind, RecordingRef } from '@cema/collateral';

// Recording venue. 'acris' = one of the five NYC boroughs (borough 1-5); 'county'
// = an upstate county clerk.
export type RecordingVenue = 'acris' | 'county';

// Plain data the planner needs (decoupled from @cema/db). The loader passes the raw
// enum value for cemaType; acrisBbl is the NYC Borough-Block-Lot ("1-00123-0045")
// or null upstate; pageCount defaults to the placeholder estimate.
export interface DealRecordingInput {
  readonly dealId: string;
  readonly cemaType: string; // 'refi_cema' | 'purchase_cema'
  readonly county: string; // properties.county
  readonly acrisBbl: string | null; // properties.acrisBbl (NYC only)
  readonly pageCount?: number; // estimated; defaults to ESTIMATED_CEMA_PAGE_COUNT
}

// Resolved venue + borough (1-5 for ACRIS, null upstate).
export interface VenueResolution {
  readonly venue: RecordingVenue;
  readonly borough: number | null;
}

// A planned cover sheet: its kind, the hard-rule-#2 gate flag, a human title, and a
// thin deterministic field-map. `fields` is the document's own content (venue, fee)
// -- stored in documents.extractedData (the IDP/Doc-Gen precedent), NOT logged.
export interface PlannedCoverSheet {
  readonly kind: DocumentKind;
  readonly attorneyReviewRequired: boolean;
  readonly title: string;
  readonly fields: Readonly<Record<string, string | number>>;
}

// Placeholder recording-fee breakdown (Connor-gated schedule). Amounts in dollars.
export interface FeeBreakdown {
  readonly baseFee: number;
  readonly perPageFee: number;
  readonly pageCount: number;
  readonly flatCountyFee: number; // e.g. Nassau $355, Suffolk $300; 0 otherwise
  readonly total: number;
}

export interface RecordingPlan {
  readonly venue: RecordingVenue;
  readonly borough: number | null;
  readonly coverSheets: readonly PlannedCoverSheet[];
  readonly fees: FeeBreakdown;
}

// Dormant submission seam (Simplifile + ACRIS later).
export type RecordingStatus = 'not_submitted' | 'pending' | 'accepted' | 'rejected';

export interface RecordingSubmission {
  readonly submissionId: string | null;
  readonly submitted: boolean;
}

export interface RecordingPollResult {
  readonly status: RecordingStatus;
  readonly recordingRef?: RecordingRef; // present iff accepted
  readonly rejectionReason?: string; // a static token, never authority free-text
}

export interface RecordingAdapter {
  submit(plan: RecordingPlan): Promise<RecordingSubmission>;
  poll(submissionId: string): Promise<RecordingPollResult>;
}
