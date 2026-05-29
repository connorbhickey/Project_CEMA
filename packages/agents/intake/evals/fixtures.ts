/**
 * Eval fixtures for the borrower-facing savings narrative (plan Task 8, ≥20 cases).
 *
 * Each fixture's `savings` is derived by running the REAL `estimateSavings` over a
 * constructed application — never hand-written — so a fixture can never drift from
 * the deterministic estimator it is meant to exercise. The only knob is which rate
 * table feeds the estimate: `PLACEHOLDER_RATES` (isPlaceholderRate=true → the eval
 * requires a preliminary caveat) vs. a local confirmed-style table.
 *
 * Rate values are deliberately held to ≤3 decimal places. `buildSavingsNarrativePrompt`
 * injects the raw numbers, and rate × (multiple-of-1000 UPB) is then an exact whole
 * dollar — so the live model is never handed a float tail like `6785.999999999999`
 * to echo into a borrower's summary.
 *
 * Imported from `../src/savings` (not `../src/index`) so this module — and anything
 * that imports it — stays free of the AI SDK that `../src/narrative` pulls in.
 */

import { PLACEHOLDER_RATES, estimateSavings } from '../src/savings';
import type {
  CemaType,
  LoanProgram,
  NormalizedApplication,
  PropertyType,
  RecordingTaxRateTable,
} from '../src/types';

import type { NarrativeEvalInput } from './scorers';

/**
 * An illustrative *confirmed* table (isPlaceholder=false) so fixtures can exercise
 * the eval's "no preliminary caveat required" branch and the per-county lookup path.
 * NOT the authoritative NY table (plan §6.1 — Connor's to confirm); magnitudes are
 * illustrative. Rates kept to ≤3 dp to stay float-clean on multiples-of-1000 UPBs.
 */
const CONFIRMED_RATES: RecordingTaxRateTable = {
  isPlaceholder: false,
  ratesByCounty: {
    Kings: 0.025,
    Queens: 0.025,
    'New York': 0.025,
    Bronx: 0.025,
    Richmond: 0.025,
    Nassau: 0.02,
    Suffolk: 0.02,
    Westchester: 0.02,
  },
  defaultRate: 0.015, // upstate counties absent from the map above
  estimatedFees: 1_500,
};

interface FixtureParams {
  externalId: string;
  cemaType: CemaType;
  county: string;
  existingUpb: number;
  newLoanAmount: number;
  propertyType?: PropertyType;
  loanProgram?: LoanProgram;
  /** Confirmed table → isPlaceholderRate=false; omitted → PLACEHOLDER_RATES. */
  rates?: RecordingTaxRateTable;
}

/**
 * Build one eligible NY application and derive its savings via the production
 * estimator. Every fixture is first-lien, NY, conventional, an eligible property
 * type — the narrative is only ever drafted for eligible applications.
 */
function makeFixture({
  externalId,
  cemaType,
  county,
  existingUpb,
  newLoanAmount,
  propertyType = 'single_family',
  loanProgram = 'conventional',
  rates = PLACEHOLDER_RATES,
}: FixtureParams): NarrativeEvalInput {
  const application: NormalizedApplication = {
    externalId,
    cemaType,
    state: 'NY',
    propertyType,
    loanProgram,
    lienPosition: 1,
    existingUpb,
    newLoanAmount,
    county,
  };
  return { application, savings: estimateSavings(application, rates) };
}

/**
 * 24 fixtures spanning refi/purchase × placeholder/confirmed × all five eligible
 * property types × NYC, suburban, and upstate counties × $250k–$2.05M UPB. Every
 * case has fees < taxSaved (netSavings > 0) so the headline figure is a real saving.
 */
export const NARRATIVE_FIXTURES: readonly NarrativeEvalInput[] = [
  // --- Placeholder rate (refi) — preliminary caveat required ---
  makeFixture({
    externalId: 'LOS-2001',
    cemaType: 'refi_cema',
    county: 'Kings',
    existingUpb: 420_000,
    newLoanAmount: 505_000,
  }),
  makeFixture({
    externalId: 'LOS-2002',
    cemaType: 'refi_cema',
    county: 'Queens',
    existingUpb: 318_000,
    newLoanAmount: 400_000,
    propertyType: 'condo',
  }),
  makeFixture({
    externalId: 'LOS-2003',
    cemaType: 'refi_cema',
    county: 'Nassau',
    existingUpb: 650_000,
    newLoanAmount: 780_000,
  }),
  makeFixture({
    externalId: 'LOS-2004',
    cemaType: 'refi_cema',
    county: 'Suffolk',
    existingUpb: 275_000,
    newLoanAmount: 330_000,
    propertyType: 'two_family',
  }),
  makeFixture({
    externalId: 'LOS-2005',
    cemaType: 'refi_cema',
    county: 'Westchester',
    existingUpb: 880_000,
    newLoanAmount: 1_050_000,
  }),
  makeFixture({
    externalId: 'LOS-2006',
    cemaType: 'refi_cema',
    county: 'Erie',
    existingUpb: 250_000,
    newLoanAmount: 300_000,
    propertyType: 'pud',
  }),
  makeFixture({
    externalId: 'LOS-2020',
    cemaType: 'refi_cema',
    county: 'Bronx',
    existingUpb: 375_000,
    newLoanAmount: 460_000,
    propertyType: 'condo',
  }),

  // --- Placeholder rate (purchase) — preliminary caveat required ---
  makeFixture({
    externalId: 'LOS-2007',
    cemaType: 'purchase_cema',
    county: 'Bronx',
    existingUpb: 410_000,
    newLoanAmount: 520_000,
    propertyType: 'three_family',
  }),
  makeFixture({
    externalId: 'LOS-2008',
    cemaType: 'purchase_cema',
    county: 'Richmond',
    existingUpb: 505_000,
    newLoanAmount: 640_000,
  }),
  makeFixture({
    externalId: 'LOS-2009',
    cemaType: 'purchase_cema',
    county: 'Monroe',
    existingUpb: 295_000,
    newLoanAmount: 360_000,
    propertyType: 'condo',
  }),
  makeFixture({
    externalId: 'LOS-2023',
    cemaType: 'purchase_cema',
    county: 'Westchester',
    existingUpb: 725_000,
    newLoanAmount: 910_000,
    propertyType: 'pud',
  }),

  // --- Confirmed rate (refi) — no caveat required ---
  makeFixture({
    externalId: 'LOS-2010',
    cemaType: 'refi_cema',
    county: 'Kings',
    existingUpb: 720_000,
    newLoanAmount: 900_000,
    rates: CONFIRMED_RATES,
  }),
  makeFixture({
    externalId: 'LOS-2011',
    cemaType: 'refi_cema',
    county: 'New York',
    existingUpb: 1_500_000,
    newLoanAmount: 1_850_000,
    propertyType: 'condo',
    rates: CONFIRMED_RATES,
  }),
  makeFixture({
    externalId: 'LOS-2012',
    cemaType: 'refi_cema',
    county: 'Albany',
    existingUpb: 365_000,
    newLoanAmount: 430_000,
    rates: CONFIRMED_RATES,
  }),
  makeFixture({
    externalId: 'LOS-2013',
    cemaType: 'refi_cema',
    county: 'Nassau',
    existingUpb: 540_000,
    newLoanAmount: 650_000,
    propertyType: 'two_family',
    rates: CONFIRMED_RATES,
  }),
  makeFixture({
    externalId: 'LOS-2014',
    cemaType: 'refi_cema',
    county: 'Westchester',
    existingUpb: 999_000,
    newLoanAmount: 1_200_000,
    rates: CONFIRMED_RATES,
  }),
  makeFixture({
    externalId: 'LOS-2015',
    cemaType: 'refi_cema',
    county: 'Onondaga',
    existingUpb: 312_000,
    newLoanAmount: 380_000,
    propertyType: 'pud',
    rates: CONFIRMED_RATES,
  }),
  makeFixture({
    externalId: 'LOS-2022',
    cemaType: 'refi_cema',
    county: 'Richmond',
    existingUpb: 460_000,
    newLoanAmount: 560_000,
    rates: CONFIRMED_RATES,
  }),
  makeFixture({
    externalId: 'LOS-2024',
    cemaType: 'refi_cema',
    county: 'Queens',
    existingUpb: 845_000,
    newLoanAmount: 1_020_000,
    rates: CONFIRMED_RATES,
  }),

  // --- Confirmed rate (purchase) — no caveat required ---
  makeFixture({
    externalId: 'LOS-2016',
    cemaType: 'purchase_cema',
    county: 'Queens',
    existingUpb: 615_000,
    newLoanAmount: 770_000,
    rates: CONFIRMED_RATES,
  }),
  makeFixture({
    externalId: 'LOS-2017',
    cemaType: 'purchase_cema',
    county: 'New York',
    existingUpb: 2_050_000,
    newLoanAmount: 2_400_000,
    propertyType: 'condo',
    rates: CONFIRMED_RATES,
  }),
  makeFixture({
    externalId: 'LOS-2018',
    cemaType: 'purchase_cema',
    county: 'Suffolk',
    existingUpb: 430_000,
    newLoanAmount: 520_000,
    propertyType: 'three_family',
    rates: CONFIRMED_RATES,
  }),
  makeFixture({
    externalId: 'LOS-2019',
    cemaType: 'purchase_cema',
    county: 'Dutchess',
    existingUpb: 285_000,
    newLoanAmount: 350_000,
    rates: CONFIRMED_RATES,
  }),
  makeFixture({
    externalId: 'LOS-2021',
    cemaType: 'purchase_cema',
    county: 'Kings',
    existingUpb: 1_200_000,
    newLoanAmount: 1_500_000,
    propertyType: 'two_family',
    rates: CONFIRMED_RATES,
  }),
];
