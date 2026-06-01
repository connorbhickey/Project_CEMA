// Canonical home for the shared collateral-document vocabulary used across the
// Layer-3 agent family (Collateral IDP, Chain-of-Title, and future consumers).
//
// This package carries NO runtime @cema/db dependency: the full document_kind
// enum is re-declared here as a plain const so any consumer -- including agent
// cores wrapped in the WDK '"use workflow"' sandbox VM, which cannot load
// @cema/db -- can depend on it freely. A drift guard (types.test.ts, a dev-only
// @cema/db importer) keeps this in lockstep with the DB enum.
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
// the documents_attorney_gate_required DB check constraint). IDP's classify()
// sets attorneyReviewRequired=true for exactly these.
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
