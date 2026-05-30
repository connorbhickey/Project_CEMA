/**
 * Braintrust eval for the outreach email. Calls the live model via
 * draftOutreachEmail for each fixture and grades it with the pure, unit-tested
 * scorers in ./scorers. Gated behind ./run.mjs, which skips (exit 0) unless
 * BOTH BRAINTRUST_API_KEY and AI_GATEWAY_API_KEY are present.
 */

import { Eval } from 'braintrust';

import { draftOutreachEmail, type DraftEmailInput } from '../src/draft';

import { OUTREACH_FIXTURES } from './fixtures';
import { OUTREACH_SCORERS, type OutreachEmail } from './scorers';

void Eval<DraftEmailInput, OutreachEmail>('cema-servicer-outreach-email', {
  data: () =>
    OUTREACH_FIXTURES.map((fixture) => ({
      input: fixture,
      metadata: {
        servicerName: fixture.servicerName ?? '(unknown)',
        touchNumber: fixture.touchNumber,
        dealReference: fixture.dealReference,
      },
    })),

  task: async (input: DraftEmailInput): Promise<OutreachEmail> => draftOutreachEmail(input),

  scores: OUTREACH_SCORERS,
});
