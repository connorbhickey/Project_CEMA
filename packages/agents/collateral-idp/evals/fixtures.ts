import type { DocumentKind, RawExtraction } from '../src/types';

export interface IdpFixture {
  readonly name: string;
  readonly input: RawExtraction;
  readonly expected: {
    readonly kind: DocumentKind;
    readonly attorneyReviewRequired: boolean;
    readonly nonNullFields: readonly string[];
  };
}

function fx(
  name: string,
  documentType: string,
  fields: Readonly<Record<string, string>>,
  expected: IdpFixture['expected'],
): IdpFixture {
  return {
    name,
    input: { text: null, fields: { documentType, ...fields }, confidence: 0.9 },
    expected,
  };
}

// >= 20 readable fixtures: every one of the 14 gate kinds + note + mortgage +
// representative non-gated kinds + field-coercion variations. Party names are
// synthetic.
export const IDP_FIXTURES: readonly IdpFixture[] = [
  fx(
    'assignment of mortgage',
    'Assignment of Mortgage',
    { assignor: 'Alpha Servicing LLC', assignee: 'Beta Bank NA', crfn: '2025000111111' },
    { kind: 'aom', attorneyReviewRequired: true, nonNullFields: ['assignor', 'assignee'] },
  ),
  fx(
    'allonge to note',
    'Allonge to Note',
    { references: 'Note dated 2019-01-01' },
    { kind: 'allonge', attorneyReviewRequired: true, nonNullFields: ['references'] },
  ),
  fx(
    'cema 3172',
    'Consolidation, Extension and Modification Agreement',
    { amount: '$500,000.00', county: 'Queens' },
    { kind: 'cema_3172', attorneyReviewRequired: true, nonNullFields: ['amount', 'county'] },
  ),
  fx(
    'consolidated note',
    'Consolidated Note',
    { amount: '$500,000.00' },
    { kind: 'consolidated_note', attorneyReviewRequired: true, nonNullFields: ['amount'] },
  ),
  fx(
    'gap note',
    'Gap Note',
    { amount: '$80,000.00' },
    { kind: 'gap_note', attorneyReviewRequired: true, nonNullFields: ['amount'] },
  ),
  fx(
    'gap mortgage',
    'Gap Mortgage',
    { amount: '$80,000.00', county: 'Kings' },
    { kind: 'gap_mortgage', attorneyReviewRequired: true, nonNullFields: ['amount', 'county'] },
  ),
  fx(
    'exhibit a',
    'Exhibit A',
    {},
    { kind: 'exhibit_a', attorneyReviewRequired: true, nonNullFields: [] },
  ),
  fx(
    'exhibit b',
    'Exhibit B',
    {},
    { kind: 'exhibit_b', attorneyReviewRequired: true, nonNullFields: [] },
  ),
  fx(
    'exhibit c',
    'Exhibit C',
    {},
    { kind: 'exhibit_c', attorneyReviewRequired: true, nonNullFields: [] },
  ),
  fx(
    'exhibit d',
    'Exhibit D',
    {},
    { kind: 'exhibit_d', attorneyReviewRequired: true, nonNullFields: [] },
  ),
  fx(
    'section 255 affidavit',
    'Section 255 Affidavit',
    {},
    { kind: 'aff_255', attorneyReviewRequired: true, nonNullFields: [] },
  ),
  fx(
    'section 275 affidavit',
    'Section 275 Affidavit',
    {},
    { kind: 'aff_275', attorneyReviewRequired: true, nonNullFields: [] },
  ),
  fx(
    'mt-15',
    'MT-15 Mortgage Recording Tax Return',
    {},
    {
      kind: 'mt_15',
      attorneyReviewRequired: true,
      nonNullFields: [],
    },
  ),
  fx(
    'county cover sheet',
    'County Cover Sheet',
    { county: 'Nassau' },
    {
      kind: 'county_cover_sheet',
      attorneyReviewRequired: true,
      nonNullFields: ['county'],
    },
  ),
  fx(
    'promissory note',
    'Promissory Note',
    { amount: '$420,000.00' },
    { kind: 'note', attorneyReviewRequired: false, nonNullFields: ['amount'] },
  ),
  fx(
    'mortgage',
    'Mortgage',
    { amount: '$420,000.00', county: 'Bronx', recordedAt: '2019-05-01' },
    {
      kind: 'mortgage',
      attorneyReviewRequired: false,
      nonNullFields: ['amount', 'county', 'recordedAt'],
    },
  ),
  fx(
    'payoff letter',
    'Payoff Letter',
    { amount: '$311,204.55' },
    {
      kind: 'payoff_letter',
      attorneyReviewRequired: false,
      nonNullFields: ['amount'],
    },
  ),
  fx(
    'title commitment',
    'Title Commitment',
    {},
    {
      kind: 'title_commitment',
      attorneyReviewRequired: false,
      nonNullFields: [],
    },
  ),
  fx(
    'title policy',
    'Title Policy',
    {},
    {
      kind: 'title_policy',
      attorneyReviewRequired: false,
      nonNullFields: [],
    },
  ),
  fx(
    'endorsement 11.1',
    'ALTA 11.1-06 Endorsement',
    {},
    {
      kind: 'endorsement_111',
      attorneyReviewRequired: false,
      nonNullFields: [],
    },
  ),
  fx(
    'authorization',
    'Borrower Authorization',
    {},
    {
      kind: 'authorization',
      attorneyReviewRequired: false,
      nonNullFields: [],
    },
  ),
  fx(
    'reel-page mortgage',
    'Mortgage',
    { reelPage: '1234/567' },
    {
      kind: 'mortgage',
      attorneyReviewRequired: false,
      nonNullFields: [],
    },
  ),
  fx(
    'unrecognized doc',
    'Quarterly Escrow Statement',
    {},
    {
      kind: 'other',
      attorneyReviewRequired: false,
      nonNullFields: [],
    },
  ),
];
