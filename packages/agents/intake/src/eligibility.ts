import {
  ELIGIBLE_PROPERTY_TYPES,
  EXCLUDED_LOAN_PROGRAMS,
  type EligibilityResult,
  type IneligibilityReason,
  type NormalizedApplication,
} from './types';

/**
 * Deterministic CEMA eligibility check (spec §9.3 step 2). Pure — no I/O, no LLM.
 *
 * Accumulates every failed rule (rather than short-circuiting) so the audit log
 * and Braintrust eval can fully explain the decision. An empty `reasons` array
 * means the application is eligible.
 */
export function checkEligibility(app: NormalizedApplication): EligibilityResult {
  const reasons: IneligibilityReason[] = [];

  if (app.state.toUpperCase() !== 'NY') {
    reasons.push('not_ny');
  }
  if (!ELIGIBLE_PROPERTY_TYPES.includes(app.propertyType)) {
    reasons.push('ineligible_property_type');
  }
  if (EXCLUDED_LOAN_PROGRAMS.includes(app.loanProgram)) {
    reasons.push('ineligible_loan_program');
  }
  if (app.lienPosition !== 1) {
    reasons.push('not_first_lien');
  }
  if (app.existingUpb <= 0) {
    reasons.push('no_existing_upb');
  }

  return { eligible: reasons.length === 0, reasons };
}
