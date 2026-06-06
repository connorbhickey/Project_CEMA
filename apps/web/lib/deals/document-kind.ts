/**
 * Human labels for `document_kind` tokens, so the documents UI shows "Assignment
 * of Mortgage" rather than "aom". Single source of truth; the drift-guard test
 * keeps these keys in lockstep with the document_kind pg enum (a new kind can't
 * silently lose a label). Labels may carry public form numbers (MT-15, Form 3172,
 * §255/§275) — those are not PII.
 */
export const DOCUMENT_KIND_LABELS = {
  note: 'Promissory Note',
  mortgage: 'Mortgage',
  aom: 'Assignment of Mortgage',
  allonge: 'Allonge',
  cema_3172: 'CEMA (NY Form 3172)',
  exhibit_a: 'Exhibit A',
  exhibit_b: 'Exhibit B',
  exhibit_c: 'Exhibit C',
  exhibit_d: 'Exhibit D',
  consolidated_note: 'Consolidated Note',
  gap_note: 'Gap Note',
  gap_mortgage: 'Gap Mortgage',
  aff_255: 'NY Tax Law §255 Affidavit',
  aff_275: 'NY Tax Law §275 Affidavit',
  mt_15: 'MT-15 Mortgage Recording Tax Return',
  nyc_rpt: 'NYC-RPT (Real Property Transfer Tax)',
  tp_584: 'TP-584 (Combined Transfer Tax Return)',
  acris_cover_pages: 'ACRIS Cover Pages',
  county_cover_sheet: 'County Recording Cover Sheet',
  payoff_letter: 'Payoff Letter',
  authorization: 'Authorization',
  title_commitment: 'Title Commitment',
  title_policy: 'Title Policy',
  endorsement_111: 'ALTA 11.1 Endorsement',
  other: 'Other',
} as const;

export type DocumentKindToken = keyof typeof DOCUMENT_KIND_LABELS;

/** Display label for a document kind, or the raw token if unknown. */
export function documentKindLabel(kind: string): string {
  return (DOCUMENT_KIND_LABELS as Record<string, string>)[kind] ?? kind;
}
