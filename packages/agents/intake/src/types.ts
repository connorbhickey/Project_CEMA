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

/**
 * CEMA transaction type (spec §14 glossary). Refi-CEMA is ~75% of volume (same
 * borrower refinances); Purchase CEMA is ~25% (buyer assumes the seller's chain).
 * Mirrors the `deals.cemaType` NOT-NULL column, so the agent can create a Deal
 * without inventing this classification.
 */
export type CemaType = 'refi_cema' | 'purchase_cema';

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
  /** CEMA transaction type (refi vs purchase) — drives the Deal's `cemaType`. */
  cemaType: CemaType;
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
 * NY mortgage-recording-tax rates for the savings estimate. Table-driven so the
 * real, attorney-confirmed table (plan §6.1) is a config swap, not a code change.
 */
export interface RecordingTaxRateTable {
  /** True for non-authoritative placeholder values — propagates to SavingsEstimate.isPlaceholderRate. */
  isPlaceholder: boolean;
  /** Combined recording-tax rate (decimal fraction) per NY county; keys matched case-insensitively. */
  ratesByCounty: Record<string, number>;
  /** Rate applied when a county is absent from ratesByCounty. */
  defaultRate: number;
  /** Estimated CEMA-specific costs (servicer fee + attorney + title endorsement), in whole US dollars. */
  estimatedFees: number;
}

/**
 * The single surface the Intake Agent depends on for loan data (spec §13.6).
 * Encompass / LendingPad / MeridianLink / Calyx each become an adapter impl;
 * slice 1 ships a FixtureLosAdapter so the core is testable without credentials.
 */
export interface LosAdapter {
  getApplication(externalId: string): Promise<NormalizedApplication>;
}

/** What the orchestrator hands its deal-creation collaborator (eligible applications only). */
export interface IntakeDealInput {
  application: NormalizedApplication;
  savings: SavingsEstimate;
}

/**
 * The audit event the orchestrator emits for every run (eligible or not), so the
 * agent's decision is always recorded. `deal.created` is intentionally absent —
 * that row is owned by `createDeal`, which writes it atomically with the insert.
 */
export interface IntakeAuditEvent {
  action: 'intake.evaluated';
  externalId: string;
  eligible: boolean;
  reasons: IneligibilityReason[];
}

/**
 * Collaborators injected into `runIntake` so the agent core carries no app, DB,
 * Clerk, or LLM dependency (orchestration-agnostic posture, plan Decision 1). The
 * app wires these to the real createDeal Server Action + audit emitter; tests pass
 * deterministic fakes.
 */
export interface IntakeDeps {
  /** Loan-data surface (FixtureLosAdapter in tests; Encompass etc. in production). */
  adapter: LosAdapter;
  /** Creates a Deal (status='intake') from an eligible application. Owns the atomic `deal.created` audit row. */
  createDeal: (input: IntakeDealInput) => Promise<{ dealId: string }>;
  /** Emits the `intake.evaluated` audit event. */
  emitAudit: (event: IntakeAuditEvent) => Promise<void>;
  /** Recording-tax table; defaults to PLACEHOLDER_RATES when omitted. */
  rates?: RecordingTaxRateTable;
}

/** Outcome of an intake run. */
export interface IntakeResult {
  externalId: string;
  eligibility: EligibilityResult;
  /** Computed only for eligible applications; null otherwise. */
  savings: SavingsEstimate | null;
  /** Set only when a Deal was created (eligible path); null otherwise. */
  dealId: string | null;
}
