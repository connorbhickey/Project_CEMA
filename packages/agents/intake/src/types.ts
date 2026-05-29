/**
 * Core types for the Intake Agent (spec §9.3) — the first Layer 3 CEMA agent.
 *
 * Eligibility and savings are deterministic by design (legal correctness over
 * LLM judgment); the LLM only drafts borrower-facing narrative downstream.
 */

/** Subject-property type. The first five are CEMA-eligible in v1; the rest are modeled so they can be explicitly rejected. */
export type PropertyType =
  | 'single_family' // 1-family
  | 'two_family'
  | 'three_family'
  | 'condo'
  | 'pud'
  | 'co_op' // excluded in v1 (spec §9.3)
  | 'four_plus_family' // edge — pending Connor (plan §6.2)
  | 'mixed_use'; // edge — pending Connor (plan §6.2)

/** Loan program. VA/FHA are government-backed and excluded in v1 (spec §9.3). */
export type LoanProgram = 'conventional' | 'va' | 'fha' | 'usda';

/** CEMA-eligible property types (v1). Anything not in this set fails closed. */
export const ELIGIBLE_PROPERTY_TYPES: readonly PropertyType[] = [
  'single_family',
  'two_family',
  'three_family',
  'condo',
  'pud',
] as const;

/** Loan programs excluded in v1. Modeled as a blocklist to match spec §9.3 phrasing ("exclude VA, FHA"). */
export const EXCLUDED_LOAN_PROGRAMS: readonly LoanProgram[] = ['va', 'fha'] as const;

/**
 * LOS-agnostic loan application. Each LOS adapter (Encompass, LendingPad,
 * MeridianLink, Calyx) maps its native model into this shape — the only data
 * surface the agent depends on (spec §13.6, Decision 2).
 */
export interface NormalizedApplication {
  /** Stable identifier in the source LOS. */
  externalId: string;
  /** USPS two-letter state code of the subject property (e.g. "NY"). */
  state: string;
  /** Subject-property type. */
  propertyType: PropertyType;
  /** Loan program — distinguishes conventional from government-backed (VA/FHA). */
  loanProgram: LoanProgram;
  /** Lien position of the new mortgage; 1 = first lien. */
  lienPosition: number;
  /** UPB of the existing mortgage to be assigned, in whole US dollars. The §255-exempt base. */
  existingUpb: number;
  /** Principal of the new loan, in whole US dollars. */
  newLoanAmount: number;
  /** NY county of the subject property (rate-table key for the savings estimate). */
  county: string;
}

/** Machine-readable reason an application failed an eligibility rule. */
export type IneligibilityReason =
  | 'not_ny'
  | 'ineligible_property_type'
  | 'ineligible_loan_program'
  | 'not_first_lien'
  | 'no_existing_upb';

/** Outcome of the deterministic eligibility check (spec §9.3 step 2). */
export interface EligibilityResult {
  eligible: boolean;
  /** Every failed rule (empty when eligible) — full list, not first-fail, for audit + eval explainability. */
  reasons: IneligibilityReason[];
}

/**
 * Recording-tax savings estimate (spec §9.3 step 5). The §255 supplemental-
 * mortgage exemption means recording tax is NOT paid on the assigned UPB; that
 * un-paid tax is the saving.
 */
export interface SavingsEstimate {
  /** UPB assigned under §255 — the base the recording-tax saving is computed on. */
  assignedUpb: number;
  /** Applicable NY mortgage-recording-tax rate (decimal fraction, e.g. 0.0205). */
  appliedRate: number;
  /** Gross recording tax avoided = assignedUpb × appliedRate. */
  taxSaved: number;
  /** CEMA-specific costs (servicer CEMA fee, attorney, title endorsement). */
  fees: number;
  /** Net borrower saving = taxSaved − fees. */
  netSavings: number;
  /** True when computed from placeholder rates, pending Connor's confirmed table (plan §6.1). */
  isPlaceholderRate: boolean;
}

/**
 * The single surface the Intake Agent depends on for loan data (spec §13.6).
 * Encompass / LendingPad / MeridianLink / Calyx each become an adapter impl;
 * slice 1 ships a FixtureLosAdapter so the core is testable without credentials.
 */
export interface LosAdapter {
  getApplication(externalId: string): Promise<NormalizedApplication>;
}
