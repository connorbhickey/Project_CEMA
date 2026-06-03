import { Eval } from 'braintrust';

import type { BorrowerNotification } from '../src/types';

import { BORROWER_FIXTURES } from './fixtures';
import type { BorrowerExpected } from './scorers';
import { BORROWER_SCORERS, runNotify } from './scorers';

// Live Braintrust eval over the deterministic borrower-notify decision. The
// offline scorers.test.ts is the real gate; this run is skip-green in CI unless
// BRAINTRUST_API_KEY is set (run.mjs guards it). BORROWER_SCORERS already take
// Braintrust's { input, output, expected } arg shape, so they pass directly.
void Eval<string, BorrowerNotification | null, BorrowerExpected>('borrower-comms', {
  data: BORROWER_FIXTURES.map((f) => ({
    input: f.input,
    expected: f.expected,
    metadata: { name: f.name },
  })),
  task: (input) => runNotify(input),
  scores: [...BORROWER_SCORERS],
});
