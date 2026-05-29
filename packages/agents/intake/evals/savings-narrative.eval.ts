/**
 * Braintrust eval for the borrower-facing CEMA savings narrative (plan Task 8).
 *
 * The only non-deterministic part of the Intake Agent: it calls the live model via
 * `draftSavingsNarrative` for each fixture and grades the output with the pure,
 * unit-tested scorers in `./scorers`. Because it makes a real model call AND logs
 * to Braintrust, it is gated behind `./run.mjs`, which skips (exit 0) unless BOTH
 * BRAINTRUST_API_KEY and ANTHROPIC_API_KEY are present — so CI stays green without
 * provisioned keys while the compliance logic remains verified by the Unit tests job.
 *
 * Run via `pnpm --filter @cema/agents-intake eval` (→ run.mjs → `braintrust eval`).
 */

import { Eval } from 'braintrust';

import { draftSavingsNarrative } from '../src/narrative';

import { NARRATIVE_FIXTURES } from './fixtures';
import { NARRATIVE_SCORERS, type NarrativeEvalInput } from './scorers';

void Eval<NarrativeEvalInput, string>('cema-intake-savings-narrative', {
  // Carry the deterministic facts as metadata so a failing trace is legible
  // (which county, which transaction type, was the rate a placeholder) without
  // re-deriving them. No PII: these are loan-shape figures, not borrower identity.
  data: () =>
    NARRATIVE_FIXTURES.map((fixture) => ({
      input: fixture,
      metadata: {
        externalId: fixture.application.externalId,
        cemaType: fixture.application.cemaType,
        county: fixture.application.county,
        isPlaceholderRate: fixture.savings.isPlaceholderRate,
        netSavings: fixture.savings.netSavings,
      },
    })),

  task: async (input: NarrativeEvalInput): Promise<string> => {
    const narrative = await draftSavingsNarrative(input.application, input.savings);
    if (narrative === null) {
      // run.mjs guarantees AI_GATEWAY_API_KEY is set before this file executes, so a
      // null here is misconfiguration — not the "LLM intentionally off" signal that
      // null means in the deterministic write path.
      throw new Error(
        'draftSavingsNarrative returned null — AI_GATEWAY_API_KEY must be set to run this eval.',
      );
    }
    return narrative;
  },

  scores: NARRATIVE_SCORERS,
});
