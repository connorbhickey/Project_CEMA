import type { NormalizedApplication } from './types';

/**
 * Deterministic loan-application fixtures for testing the Intake Agent without
 * any LOS credentials (plan Decision 2). Reused by the FixtureLosAdapter and the
 * Braintrust eval (plan §4 tasks 5 + 9). Each has a unique externalId.
 */

// ── Eligible ────────────────────────────────────────────────────────────────

export const FIXTURE_ELIGIBLE_SINGLE_FAMILY: NormalizedApplication = {
  externalId: 'FIX-ELIG-SF',
  state: 'NY',
  propertyType: 'single_family',
  loanProgram: 'conventional',
  lienPosition: 1,
  existingUpb: 400_000,
  newLoanAmount: 520_000,
  county: 'Kings',
};

export const FIXTURE_ELIGIBLE_CONDO: NormalizedApplication = {
  externalId: 'FIX-ELIG-CONDO',
  state: 'NY',
  propertyType: 'condo',
  loanProgram: 'conventional',
  lienPosition: 1,
  existingUpb: 615_000,
  newLoanAmount: 700_000,
  county: 'New York',
};

export const FIXTURE_ELIGIBLE_TWO_FAMILY: NormalizedApplication = {
  externalId: 'FIX-ELIG-2FAM',
  state: 'NY',
  propertyType: 'two_family',
  loanProgram: 'conventional',
  lienPosition: 1,
  existingUpb: 480_000,
  newLoanAmount: 540_000,
  county: 'Queens',
};

export const FIXTURE_ELIGIBLE_THREE_FAMILY: NormalizedApplication = {
  externalId: 'FIX-ELIG-3FAM',
  state: 'NY',
  propertyType: 'three_family',
  loanProgram: 'conventional',
  lienPosition: 1,
  existingUpb: 550_000,
  newLoanAmount: 610_000,
  county: 'Bronx',
};

export const FIXTURE_ELIGIBLE_PUD: NormalizedApplication = {
  externalId: 'FIX-ELIG-PUD',
  state: 'NY',
  propertyType: 'pud',
  loanProgram: 'conventional',
  lienPosition: 1,
  existingUpb: 325_000,
  newLoanAmount: 400_000,
  county: 'Suffolk',
};

/** USDA is not on the VA/FHA blocklist, so it currently passes — a deliberate edge for the eval (see plan §6.2). */
export const FIXTURE_ELIGIBLE_USDA: NormalizedApplication = {
  externalId: 'FIX-ELIG-USDA',
  state: 'NY',
  propertyType: 'single_family',
  loanProgram: 'usda',
  lienPosition: 1,
  existingUpb: 210_000,
  newLoanAmount: 260_000,
  county: 'Ulster',
};

// ── Ineligible ──────────────────────────────────────────────────────────────

export const FIXTURE_INELIGIBLE_NON_NY: NormalizedApplication = {
  externalId: 'FIX-INELIG-NONNY',
  state: 'NJ',
  propertyType: 'single_family',
  loanProgram: 'conventional',
  lienPosition: 1,
  existingUpb: 400_000,
  newLoanAmount: 500_000,
  county: 'Bergen',
};

export const FIXTURE_INELIGIBLE_COOP: NormalizedApplication = {
  externalId: 'FIX-INELIG-COOP',
  state: 'NY',
  propertyType: 'co_op',
  loanProgram: 'conventional',
  lienPosition: 1,
  existingUpb: 300_000,
  newLoanAmount: 360_000,
  county: 'New York',
};

export const FIXTURE_INELIGIBLE_VA: NormalizedApplication = {
  externalId: 'FIX-INELIG-VA',
  state: 'NY',
  propertyType: 'single_family',
  loanProgram: 'va',
  lienPosition: 1,
  existingUpb: 350_000,
  newLoanAmount: 420_000,
  county: 'Erie',
};

export const FIXTURE_INELIGIBLE_FHA: NormalizedApplication = {
  externalId: 'FIX-INELIG-FHA',
  state: 'NY',
  propertyType: 'two_family',
  loanProgram: 'fha',
  lienPosition: 1,
  existingUpb: 410_000,
  newLoanAmount: 470_000,
  county: 'Monroe',
};

export const FIXTURE_INELIGIBLE_SECOND_LIEN: NormalizedApplication = {
  externalId: 'FIX-INELIG-2NDLIEN',
  state: 'NY',
  propertyType: 'single_family',
  loanProgram: 'conventional',
  lienPosition: 2,
  existingUpb: 90_000,
  newLoanAmount: 120_000,
  county: 'Nassau',
};

export const FIXTURE_INELIGIBLE_ZERO_UPB: NormalizedApplication = {
  externalId: 'FIX-INELIG-ZEROUPB',
  state: 'NY',
  propertyType: 'condo',
  loanProgram: 'conventional',
  lienPosition: 1,
  existingUpb: 0,
  newLoanAmount: 500_000,
  county: 'Westchester',
};

// ── Edge (fail closed in v1; pending Connor — plan §6.2) ──────────────────────

export const FIXTURE_EDGE_FOUR_PLUS_FAMILY: NormalizedApplication = {
  externalId: 'FIX-EDGE-4PLUS',
  state: 'NY',
  propertyType: 'four_plus_family',
  loanProgram: 'conventional',
  lienPosition: 1,
  existingUpb: 720_000,
  newLoanAmount: 800_000,
  county: 'Kings',
};

export const FIXTURE_EDGE_MIXED_USE: NormalizedApplication = {
  externalId: 'FIX-EDGE-MIXEDUSE',
  state: 'NY',
  propertyType: 'mixed_use',
  loanProgram: 'conventional',
  lienPosition: 1,
  existingUpb: 640_000,
  newLoanAmount: 760_000,
  county: 'New York',
};

/** Trips every rule at once — exercises the multi-reason accumulation path. */
export const FIXTURE_EDGE_MULTI_FAIL: NormalizedApplication = {
  externalId: 'FIX-EDGE-MULTIFAIL',
  state: 'CA',
  propertyType: 'co_op',
  loanProgram: 'fha',
  lienPosition: 3,
  existingUpb: 0,
  newLoanAmount: 300_000,
  county: 'Los Angeles',
};

/** All seeded fixtures. The FixtureLosAdapter serves these by externalId. */
export const DEFAULT_FIXTURES: readonly NormalizedApplication[] = [
  FIXTURE_ELIGIBLE_SINGLE_FAMILY,
  FIXTURE_ELIGIBLE_CONDO,
  FIXTURE_ELIGIBLE_TWO_FAMILY,
  FIXTURE_ELIGIBLE_THREE_FAMILY,
  FIXTURE_ELIGIBLE_PUD,
  FIXTURE_ELIGIBLE_USDA,
  FIXTURE_INELIGIBLE_NON_NY,
  FIXTURE_INELIGIBLE_COOP,
  FIXTURE_INELIGIBLE_VA,
  FIXTURE_INELIGIBLE_FHA,
  FIXTURE_INELIGIBLE_SECOND_LIEN,
  FIXTURE_INELIGIBLE_ZERO_UPB,
  FIXTURE_EDGE_FOUR_PLUS_FAMILY,
  FIXTURE_EDGE_MIXED_USE,
  FIXTURE_EDGE_MULTI_FAIL,
] as const;
