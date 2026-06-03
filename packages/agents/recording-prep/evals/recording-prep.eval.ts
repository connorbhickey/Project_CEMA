import { Eval } from 'braintrust';

import type { DealRecordingInput, RecordingPlan } from '../src/types';

import { RECORDING_FIXTURES } from './fixtures';
import type { RecordingExpected } from './scorers';
import { RECORDING_SCORERS, runPlan } from './scorers';

// Live Braintrust eval over the deterministic recording-package planner. The
// offline scorers.test.ts is the real gate; this run is skip-green in CI unless
// BRAINTRUST_API_KEY is set (run.mjs guards it). RECORDING_SCORERS already take
// Braintrust's { input, output, expected } arg shape, so they pass directly.
void Eval<DealRecordingInput, RecordingPlan, RecordingExpected>('recording-prep', {
  data: RECORDING_FIXTURES.map((f) => ({
    input: f.input,
    expected: f.expected,
    metadata: { name: f.name },
  })),
  task: (input) => runPlan(input),
  scores: [...RECORDING_SCORERS],
});
