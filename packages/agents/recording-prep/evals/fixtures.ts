import type { DocumentKind } from '@cema/collateral';

import type { DealRecordingInput, RecordingVenue } from '../src/types';

export interface RecordingFixture {
  readonly name: string;
  readonly input: DealRecordingInput;
  readonly expected: {
    readonly venue: RecordingVenue;
    readonly borough: number | null;
    readonly kinds: readonly DocumentKind[];
    readonly total: number;
  };
}

// Fee math restated independently (regression guard): base 40 + 5*pageCount +
// flat county (Nassau 355, Suffolk 300, else 0). Default pageCount = 40 -> 240.
const ACRIS_REFI: readonly DocumentKind[] = ['acris_cover_pages'];
const COUNTY_REFI: readonly DocumentKind[] = ['county_cover_sheet'];
const ACRIS_PURCHASE: readonly DocumentKind[] = ['acris_cover_pages', 'nyc_rpt', 'tp_584'];
const COUNTY_PURCHASE: readonly DocumentKind[] = ['county_cover_sheet', 'tp_584'];

export const RECORDING_FIXTURES: readonly RecordingFixture[] = [
  // --- BBL-driven venue (refi, acris); BBL borough digit wins ---
  {
    name: 'BBL borough 1 (Manhattan)',
    input: { dealId: 'rp-01', cemaType: 'refi_cema', county: 'New York', acrisBbl: '1-00123-0045' },
    expected: { venue: 'acris', borough: 1, kinds: ACRIS_REFI, total: 240 },
  },
  {
    name: 'BBL borough 2 (Bronx)',
    input: { dealId: 'rp-02', cemaType: 'refi_cema', county: 'Bronx', acrisBbl: '2-00500-0010' },
    expected: { venue: 'acris', borough: 2, kinds: ACRIS_REFI, total: 240 },
  },
  {
    name: 'BBL borough 3 (Brooklyn)',
    input: { dealId: 'rp-03', cemaType: 'refi_cema', county: 'Kings', acrisBbl: '3-01000-0001' },
    expected: { venue: 'acris', borough: 3, kinds: ACRIS_REFI, total: 240 },
  },
  {
    name: 'BBL borough 4 (Queens)',
    input: { dealId: 'rp-04', cemaType: 'refi_cema', county: 'Queens', acrisBbl: '4-02000-0123' },
    expected: { venue: 'acris', borough: 4, kinds: ACRIS_REFI, total: 240 },
  },
  {
    name: 'BBL borough 5 (Staten Island)',
    input: { dealId: 'rp-05', cemaType: 'refi_cema', county: 'Richmond', acrisBbl: '5-00077-0007' },
    expected: { venue: 'acris', borough: 5, kinds: ACRIS_REFI, total: 240 },
  },
  {
    name: 'BBL wins over a mismatched upstate county name',
    input: { dealId: 'rp-06', cemaType: 'refi_cema', county: 'Albany', acrisBbl: '3-00123-0045' },
    expected: { venue: 'acris', borough: 3, kinds: ACRIS_REFI, total: 240 },
  },
  // --- County-name fallback (acrisBbl null, NYC county/alias) ---
  {
    name: 'county fallback: New York -> 1',
    input: { dealId: 'rp-07', cemaType: 'refi_cema', county: 'New York', acrisBbl: null },
    expected: { venue: 'acris', borough: 1, kinds: ACRIS_REFI, total: 240 },
  },
  {
    name: 'county fallback alias: Manhattan -> 1',
    input: { dealId: 'rp-08', cemaType: 'refi_cema', county: 'Manhattan', acrisBbl: null },
    expected: { venue: 'acris', borough: 1, kinds: ACRIS_REFI, total: 240 },
  },
  {
    name: 'county fallback: Bronx -> 2',
    input: { dealId: 'rp-09', cemaType: 'refi_cema', county: 'Bronx', acrisBbl: null },
    expected: { venue: 'acris', borough: 2, kinds: ACRIS_REFI, total: 240 },
  },
  {
    name: 'county fallback: Kings -> 3',
    input: { dealId: 'rp-10', cemaType: 'refi_cema', county: 'Kings', acrisBbl: null },
    expected: { venue: 'acris', borough: 3, kinds: ACRIS_REFI, total: 240 },
  },
  {
    name: 'county fallback alias: Brooklyn -> 3',
    input: { dealId: 'rp-11', cemaType: 'refi_cema', county: 'Brooklyn', acrisBbl: null },
    expected: { venue: 'acris', borough: 3, kinds: ACRIS_REFI, total: 240 },
  },
  {
    name: 'county fallback: Queens -> 4',
    input: { dealId: 'rp-12', cemaType: 'refi_cema', county: 'Queens', acrisBbl: null },
    expected: { venue: 'acris', borough: 4, kinds: ACRIS_REFI, total: 240 },
  },
  {
    name: 'county fallback: Richmond -> 5',
    input: { dealId: 'rp-13', cemaType: 'refi_cema', county: 'Richmond', acrisBbl: null },
    expected: { venue: 'acris', borough: 5, kinds: ACRIS_REFI, total: 240 },
  },
  {
    name: 'county fallback alias: Staten Island -> 5',
    input: { dealId: 'rp-14', cemaType: 'refi_cema', county: 'Staten Island', acrisBbl: null },
    expected: { venue: 'acris', borough: 5, kinds: ACRIS_REFI, total: 240 },
  },
  {
    name: 'county fallback is case/whitespace-insensitive',
    input: { dealId: 'rp-15', cemaType: 'refi_cema', county: '  QUEENS ', acrisBbl: null },
    expected: { venue: 'acris', borough: 4, kinds: ACRIS_REFI, total: 240 },
  },
  // --- Upstate county venue (acrisBbl null, non-NYC county) ---
  {
    name: 'upstate Nassau: county venue + flat $355',
    input: { dealId: 'rp-16', cemaType: 'refi_cema', county: 'Nassau', acrisBbl: null },
    expected: { venue: 'county', borough: null, kinds: COUNTY_REFI, total: 595 },
  },
  {
    name: 'upstate Suffolk: county venue + flat $300',
    input: { dealId: 'rp-17', cemaType: 'refi_cema', county: 'Suffolk', acrisBbl: null },
    expected: { venue: 'county', borough: null, kinds: COUNTY_REFI, total: 540 },
  },
  {
    name: 'upstate Westchester: county venue, no flat',
    input: { dealId: 'rp-18', cemaType: 'refi_cema', county: 'Westchester', acrisBbl: null },
    expected: { venue: 'county', borough: null, kinds: COUNTY_REFI, total: 240 },
  },
  {
    name: 'upstate Erie: county venue, no flat',
    input: { dealId: 'rp-19', cemaType: 'refi_cema', county: 'Erie', acrisBbl: null },
    expected: { venue: 'county', borough: null, kinds: COUNTY_REFI, total: 240 },
  },
  {
    name: 'upstate Albany: county venue, no flat',
    input: { dealId: 'rp-20', cemaType: 'refi_cema', county: 'Albany', acrisBbl: null },
    expected: { venue: 'county', borough: null, kinds: COUNTY_REFI, total: 240 },
  },
  // --- Purchase CEMA: adds nyc_rpt (acris only) + tp_584 (both venues) ---
  {
    name: 'purchase + acris (county fallback) -> +nyc_rpt +tp_584',
    input: { dealId: 'rp-21', cemaType: 'purchase_cema', county: 'Queens', acrisBbl: null },
    expected: { venue: 'acris', borough: 4, kinds: ACRIS_PURCHASE, total: 240 },
  },
  {
    name: 'purchase + acris (BBL) -> +nyc_rpt +tp_584',
    input: {
      dealId: 'rp-22',
      cemaType: 'purchase_cema',
      county: 'New York',
      acrisBbl: '1-00010-0001',
    },
    expected: { venue: 'acris', borough: 1, kinds: ACRIS_PURCHASE, total: 240 },
  },
  {
    name: 'purchase + county -> +tp_584 only (no nyc_rpt upstate)',
    input: { dealId: 'rp-23', cemaType: 'purchase_cema', county: 'Westchester', acrisBbl: null },
    expected: { venue: 'county', borough: null, kinds: COUNTY_PURCHASE, total: 240 },
  },
  {
    name: 'purchase + county with flat fee',
    input: { dealId: 'rp-24', cemaType: 'purchase_cema', county: 'Nassau', acrisBbl: null },
    expected: { venue: 'county', borough: null, kinds: COUNTY_PURCHASE, total: 595 },
  },
  // --- Explicit pageCount overrides the default estimate ---
  {
    name: 'explicit pageCount 50 (county): 40 + 5*50 = 290',
    input: {
      dealId: 'rp-25',
      cemaType: 'refi_cema',
      county: 'Erie',
      acrisBbl: null,
      pageCount: 50,
    },
    expected: { venue: 'county', borough: null, kinds: COUNTY_REFI, total: 290 },
  },
  {
    name: 'explicit pageCount 35 (acris): 40 + 5*35 = 215',
    input: {
      dealId: 'rp-26',
      cemaType: 'refi_cema',
      county: 'Queens',
      acrisBbl: null,
      pageCount: 35,
    },
    expected: { venue: 'acris', borough: 4, kinds: ACRIS_REFI, total: 215 },
  },
];
