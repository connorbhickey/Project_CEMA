import { Eval } from 'braintrust';

import type { InternalNotification } from '../src/types';

import { INTERNAL_FIXTURES } from './fixtures';
import type { InternalExpected } from './scorers';
import { INTERNAL_SCORERS, runNotify } from './scorers';

// Live Braintrust eval over the deterministic internal-notify decision. The
// offline scorers.test.ts is the real gate; this run is skip-green in CI unless
// BRAINTRUST_API_KEY is set (run.mjs guards it). INTERNAL_SCORERS already take
// Braintrust's { input, output, expected } arg shape, so they pass directly.
void Eval<string, InternalNotification | null, InternalExpected>('internal-comms', {
  data: INTERNAL_FIXTURES.map((f) => ({
    input: f.input,
    expected: f.expected,
    metadata: { name: f.name },
  })),
  task: (input) => runNotify(input),
  scores: [...INTERNAL_SCORERS],
});
