export type {
  PropertyType,
  LoanProgram,
  CemaType,
  NormalizedApplication,
  IneligibilityReason,
  EligibilityResult,
  SavingsEstimate,
  RecordingTaxRateTable,
  LosAdapter,
  IntakeDealInput,
  IntakeAuditEvent,
  IntakeDeps,
  IntakeResult,
} from './types';
export { ELIGIBLE_PROPERTY_TYPES, EXCLUDED_LOAN_PROGRAMS } from './types';
export { checkEligibility } from './eligibility';
export { estimateSavings, PLACEHOLDER_RATES } from './savings';
export { isLlmConfigured, draftSavingsNarrative } from './narrative';
export { buildSavingsNarrativePrompt } from './prompts/savings-narrative';
export { FixtureLosAdapter } from './fixture-los-adapter';
export { runIntake } from './orchestrator';
export {
  DEFAULT_FIXTURES,
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
} from './fixtures';
