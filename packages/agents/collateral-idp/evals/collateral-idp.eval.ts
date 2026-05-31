import { Eval } from 'braintrust';

import type { RawExtraction } from '../src/types';

import { IDP_FIXTURES } from './fixtures';
import type { IdpExpected, PipelineOutput } from './scorers';
import { IDP_SCORERS, runPipeline } from './scorers';

// Live Braintrust eval over the deterministic classify+extract pipeline. The
// offline scorers.test.ts is the real gate; this run is skip-green in CI
// unless BRAINTRUST_API_KEY is set (run.mjs guards it).
// IDP_SCORERS already take Braintrust's { input, output, expected } arg shape,
// so they are passed directly -- no wrapper. Generics are pinned so inference
// does not depend on Braintrust's defaults.
void Eval<RawExtraction, PipelineOutput, IdpExpected>('collateral-idp', {
  data: IDP_FIXTURES.map((f) => ({
    input: f.input,
    expected: f.expected,
    metadata: { name: f.name },
  })),
  task: (input) => runPipeline(input),
  scores: [...IDP_SCORERS],
});
