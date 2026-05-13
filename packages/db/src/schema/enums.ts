import { pgEnum } from 'drizzle-orm/pg-core';

export const lenderSubtypeEnum = pgEnum('lender_subtype', [
  'imb',
  'regional_bank',
  'community_bank_cu',
  'wholesale_broker',
]);

export const cemaTypeEnum = pgEnum('cema_type', ['refi_cema', 'purchase_cema']);

export const propertyTypeEnum = pgEnum('property_type', [
  'one_family',
  'two_family',
  'three_family',
  'condo',
  'pud',
]);

export const dealStatusEnum = pgEnum('deal_status', [
  'intake',
  'eligibility',
  'authorization',
  'collateral_chase',
  'title_work',
  'doc_prep',
  'attorney_review',
  'closing',
  'recording',
  'completed',
  'exception',
  'cancelled',
]);

export const partyRoleEnum = pgEnum('party_role', [
  'borrower',
  'co_borrower',
  'seller',
  'loan_officer',
  'processor',
  'closing_attorney',
  'title_agent',
  'seller_attorney',
  'doc_custodian',
]);

export const documentKindEnum = pgEnum('document_kind', [
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
]);

export const documentStatusEnum = pgEnum('document_status', [
  'draft',
  'attorney_review',
  'approved',
  'executed',
  'recorded',
  'rejected',
]);

// VA permanently excluded (does not permit CEMA per spec §2.2 / 5.1).
// FHA technically eligible but rarely used; revisit Phase 2.5.
export const loanProgramEnum = pgEnum('loan_program', [
  'conventional_fannie',
  'conventional_freddie',
  'conventional_private',
  'jumbo',
]);

export const submissionMethodEnum = pgEnum('submission_method', [
  'email',
  'portal',
  'fax_only',
  'usps',
]);
