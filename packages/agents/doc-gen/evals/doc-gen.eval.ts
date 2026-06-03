import { Eval } from 'braintrust';

import type { DealDocGenInput, DocumentPlan } from '../src/types';

import { DOC_GEN_FIXTURES } from './fixtures';
import type { DocGenExpected } from './scorers';
import { DOC_GEN_SCORERS, runPlan } from './scorers';

// Live Braintrust eval over the deterministic Refi-CEMA planner. The offline
// scorers.test.ts is the real gate; this run is skip-green in CI unless
// BRAINTRUST_API_KEY is set (run.mjs guards it). DOC_GEN_SCORERS already take
// Braintrust's { input, output, expected } arg shape, so they pass directly.
void Eval<DealDocGenInput, DocumentPlan, DocGenExpected>('doc-gen', {
  data: DOC_GEN_FIXTURES.map((f) => ({
    input: f.input,
    expected: f.expected,
    metadata: { name: f.name },
  })),
  task: (input) => runPlan(input),
  scores: [...DOC_GEN_SCORERS],
});
