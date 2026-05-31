import { classify } from '../src/classify';
import { extract } from '../src/extract';
import type { InstrumentRecord, RawExtraction } from '../src/types';

import type { IdpFixture } from './fixtures';

export type IdpExpected = IdpFixture['expected'];

export interface PipelineOutput {
  readonly kind: string;
  readonly attorneyReviewRequired: boolean;
  readonly instrument: InstrumentRecord;
}

export interface IdpScorerArgs {
  readonly input: RawExtraction;
  readonly expected: IdpExpected;
  readonly output: PipelineOutput;
}

export interface IdpScore {
  readonly name: string;
  readonly score: number;
}

// 1) Classification matches the expected kind.
function classificationCorrect({ output, expected }: IdpScorerArgs): IdpScore {
  return { name: 'classification-correct', score: output.kind === expected.kind ? 1 : 0 };
}

// 2) The attorney-review gate boolean is exactly right (hard rule #2).
function attorneyGateCorrect({ output, expected }: IdpScorerArgs): IdpScore {
  return {
    name: 'attorney-gate-correct',
    score: output.attorneyReviewRequired === expected.attorneyReviewRequired ? 1 : 0,
  };
}

// 3) No raw OCR text leaks into the structured record (PII hygiene): the
//    instrument carries only typed fields, never the free-text blob.
function noPiiLeak({ output }: IdpScorerArgs): IdpScore {
  const leaked = Object.values(output.instrument).some(
    (v) => typeof v === 'string' && v.length > 200,
  );
  return { name: 'no-pii-leak', score: leaked ? 0 : 1 };
}

// 4) Every field the fixture says should be populated is non-null.
function extractionCompleteness({ output, expected }: IdpScorerArgs): IdpScore {
  const rec = output.instrument as unknown as Record<string, unknown>;
  const allPresent = expected.nonNullFields.every((f) => rec[f] !== null && rec[f] !== undefined);
  return { name: 'extraction-completeness', score: allPresent ? 1 : 0 };
}

export const IDP_SCORERS = [
  classificationCorrect,
  attorneyGateCorrect,
  noPiiLeak,
  extractionCompleteness,
] as const;

// Runs the real pipeline for a fixture -- shared by the offline test + the
// live Braintrust task so both grade identical output.
export function runPipeline(input: RawExtraction): PipelineOutput {
  const classification = classify(input);
  return {
    kind: classification.kind,
    attorneyReviewRequired: classification.attorneyReviewRequired,
    instrument: extract('eval-doc', input, classification),
  };
}
