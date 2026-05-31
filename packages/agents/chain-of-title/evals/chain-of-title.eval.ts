import { Eval } from 'braintrust';

import type { InstrumentRecord } from '../src/types';

import { CHAIN_FIXTURES } from './fixtures';
import { CHAIN_SCORERS, runPipeline } from './scorers';
import type { ChainExpected, PipelineOutput } from './scorers';

// Live Braintrust eval. Skip-greens unless BRAINTRUST_API_KEY is set (run.mjs
// gates this). The offline scorers.test.ts is the real CI gate; this exists for
// the Braintrust dashboard + regression tracking once the key is provisioned.
void Eval<readonly InstrumentRecord[], PipelineOutput, ChainExpected>('chain-of-title', {
  data: CHAIN_FIXTURES.map((f) => ({
    input: f.instruments,
    expected: f.expected,
    metadata: { name: f.name },
  })),
  task: (input) => runPipeline(input),
  scores: CHAIN_SCORERS.map(({ name, scorer }) => {
    const fn = (args: { output: PipelineOutput; expected: ChainExpected }) => ({
      name,
      score: scorer(args),
    });
    Object.defineProperty(fn, 'name', { value: name });
    return fn;
  }),
});
