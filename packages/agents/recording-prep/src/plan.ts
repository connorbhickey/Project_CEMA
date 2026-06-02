import { GATE_REQUIRED_KINDS, type DocumentKind } from '@cema/collateral';

import type {
  DealRecordingInput,
  FeeBreakdown,
  PlannedCoverSheet,
  RecordingPlan,
  RecordingVenue,
} from './types';
import { resolveVenue } from './venue';

const GATE_SET = new Set<DocumentKind>(GATE_REQUIRED_KINDS);

// Placeholder recording-fee schedule (Connor-gated -- see design spec section 1/7).
// Real per-county schedules replace these; until then every fee is preliminary.
export const ESTIMATED_CEMA_PAGE_COUNT = 40; // spec section 9.8: CEMA packages 35-45 pages
const BASE_FEE = 40; // placeholder clerk base filing fee ($)
const PER_PAGE_FEE = 5; // placeholder per-page fee ($)
// Flat county add-on fees keyed by lowercased county (placeholder examples, spec 9.8).
const FLAT_COUNTY_FEE: Record<string, number> = {
  nassau: 355, // Tax Lot Verification Letter
  suffolk: 300, // Mortgage Verification Fee
};

// Cover-sheet kinds this agent emits (a subset of DOCUMENT_KINDS). Title per kind;
// the gate flag is derived PER-KIND from GATE_SET (the IDP pattern) -- unlike
// Doc-Gen, the emitted set MIXES gated (county_cover_sheet) and non-gated kinds.
const TITLE_BY_KIND = {
  acris_cover_pages: 'ACRIS Recording & Endorsement Cover Pages',
  county_cover_sheet: 'County Clerk Recording Cover Sheet',
  nyc_rpt: 'NYC Real Property Transfer Tax Return (NYC-RPT)',
  tp_584: 'NY TP-584 Combined Transfer Tax Return',
} satisfies Partial<Record<DocumentKind, string>>;

type EmittedKind = keyof typeof TITLE_BY_KIND;

// Load-time guard: our per-kind gate derivation must agree with @cema/collateral
// (+ the documents_attorney_gate_required DB CHECK). county_cover_sheet is gated;
// the others are not. A future edit that flips a kind's gate status in only one
// place is caught here at module load.
const EXPECTED_GATED: Record<EmittedKind, boolean> = {
  acris_cover_pages: false,
  county_cover_sheet: true,
  nyc_rpt: false,
  tp_584: false,
};
for (const kind of Object.keys(TITLE_BY_KIND) as EmittedKind[]) {
  if (GATE_SET.has(kind) !== EXPECTED_GATED[kind]) {
    throw new Error(`recording-prep gate mismatch for "${kind}" vs GATE_REQUIRED_KINDS`);
  }
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Placeholder recording-fee math: base + per-page * pages + flat county add-on. */
export function computeFees(county: string, pageCount: number): FeeBreakdown {
  const flatCountyFee = FLAT_COUNTY_FEE[county.trim().toLowerCase()] ?? 0;
  const total = round2(BASE_FEE + PER_PAGE_FEE * pageCount + flatCountyFee);
  return { baseFee: BASE_FEE, perPageFee: PER_PAGE_FEE, pageCount, flatCountyFee, total };
}

function make(
  kind: EmittedKind,
  input: DealRecordingInput,
  venue: RecordingVenue,
  fees: FeeBreakdown,
): PlannedCoverSheet {
  return {
    kind,
    attorneyReviewRequired: GATE_SET.has(kind),
    title: TITLE_BY_KIND[kind],
    fields: { dealId: input.dealId, venue, county: input.county, total: fees.total },
  };
}

/**
 * Pure, deterministic recording-package planner (spec section 9.8). Resolves the
 * venue, composes the venue x CEMA-type cover-sheet set, and computes the
 * placeholder recording fees. No clock, no LLM, no IO. PII-safe (static titles;
 * fields carry only venue/county/fee -- the document's own content).
 */
export function planRecording(input: DealRecordingInput): RecordingPlan {
  const { venue, borough } = resolveVenue(input);
  const isPurchase = input.cemaType === 'purchase_cema';
  const pageCount = input.pageCount ?? ESTIMATED_CEMA_PAGE_COUNT;
  const fees = computeFees(input.county, pageCount);

  const kinds: EmittedKind[] = [];
  if (venue === 'acris') kinds.push('acris_cover_pages');
  else kinds.push('county_cover_sheet');
  if (venue === 'acris' && isPurchase) kinds.push('nyc_rpt');
  if (isPurchase) kinds.push('tp_584');

  const coverSheets = kinds.map((kind) => make(kind, input, venue, fees));
  return { venue, borough, coverSheets, fees };
}
