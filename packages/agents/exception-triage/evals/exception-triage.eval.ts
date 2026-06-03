import { Eval } from 'braintrust';

import type { DealSignals, Exception } from '../src/types';

import { TRIAGE_FIXTURES } from './fixtures';
import type { TriageExpected } from './scorers';
import { TRIAGE_SCORERS, runTriage } from './scorers';

// Live Braintrust eval over the deterministic exception classifier. The offline
// scorers.test.ts is the real gate; this run is skip-green in CI unless
// BRAINTRUST_API_KEY is set (run.mjs guards it). TRIAGE_SCORERS already take
// Braintrust's { input, output, expected } arg shape, so they pass directly.
void Eval<DealSignals, readonly Exception[], TriageExpected>('exception-triage', {
  data: TRIAGE_FIXTURES.map((f) => ({
    input: f.input,
    expected: f.expected,
    metadata: { name: f.name },
  })),
  task: (input) => runTriage(input),
  scores: [...TRIAGE_SCORERS],
});
