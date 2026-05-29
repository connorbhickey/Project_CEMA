/**
 * Prompt for the borrower-facing CEMA savings narrative (spec §9.3 step 6).
 *
 * Kept as a pure string builder, separate from the `generateText` call in
 * `../narrative.ts`, so every compliance property of the prompt — grounded
 * figures, the §255 preliminary caveat, the no-legal-advice guardrail — is
 * unit-testable without a model call or an API key.
 *
 * Versioned here under `src/prompts/` rather than the shared `@cema/prompts`
 * package because the M10 Braintrust eval (next PR) lives in this package and
 * imports the prompt directly; a package depending on `apps/web` would invert
 * the monorepo dependency direction.
 */

import type { NormalizedApplication, SavingsEstimate } from '../types';

/**
 * Build the grounding prompt for a single application's savings narrative.
 *
 * Every figure the model is allowed to use is injected as a bare integer/decimal
 * (no thousands separators) so the model cannot drift from the deterministic
 * estimate. The instructions forbid inventing numbers and require the attorney-
 * supervised, not-legal-or-tax-advice disclosure on every draft.
 */
export function buildSavingsNarrativePrompt(
  application: NormalizedApplication,
  savings: SavingsEstimate,
): string {
  const caveat = savings.isPlaceholderRate
    ? 'These figures are a PRELIMINARY estimate based on non-confirmed recording-tax rates and may change once the final county rate table is applied.'
    : 'These figures are based on the confirmed county recording-tax rate.';

  return `You are drafting a short, plain-language savings summary for a borrower on a New York CEMA (Consolidation, Extension, and Modification Agreement).

Ground every number STRICTLY in the figures below. Do not invent, recompute, or add any figure that is not provided. Use only these values:

- Transaction type: ${application.cemaType}
- County: ${application.county}
- Assigned UPB (the NY Tax Law §255 supplemental-mortgage-exempt base): ${savings.assignedUpb}
- Applied recording-tax rate (decimal fraction): ${savings.appliedRate}
- Recording tax avoided: ${savings.taxSaved}
- CEMA-specific fees (servicer fee, attorney, title endorsement): ${savings.fees}
- Estimated net savings: ${savings.netSavings}

Write 2-3 warm, clear sentences for a non-expert borrower. Lead with the estimated net savings figure, then briefly explain that the saving comes from not paying mortgage recording tax on the assigned UPB (§255), net of CEMA fees.

${caveat}

Close with this exact disclosure: this summary is informational only and is not legal or tax advice; a supervising attorney reviews every CEMA document before it is released to the borrower.`;
}
