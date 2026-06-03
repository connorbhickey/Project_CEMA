import { planDocuments } from '../src/plan';
import type { DealDocGenInput, DocumentPlan } from '../src/types';

import type { DocGenFixture } from './fixtures';

export type DocGenExpected = DocGenFixture['expected'];

export interface DocGenScorerArgs {
  readonly input: DealDocGenInput;
  readonly expected: DocGenExpected;
  readonly output: DocumentPlan;
}

export interface DocGenScore {
  readonly name: string;
  readonly score: number;
}

const sortedJoin = (xs: readonly string[]): string => [...xs].sort().join(',');

// 1) The numbers-tie consistency verdict (ok + the exact issue set) matches.
function consistencyCorrect({ output, expected }: DocGenScorerArgs): DocGenScore {
  const ok = output.consistency.ok === expected.ok;
  const issuesMatch = sortedJoin(output.consistency.issues) === sortedJoin(expected.issues);
  return { name: 'consistency-correct', score: ok && issuesMatch ? 1 : 0 };
}

// 2) Every planned document is attorney-review-required (hard rule #2 -- doc-gen
//    only ever emits gate-required legal kinds). An inconsistent plan emits no
//    documents and trivially satisfies this.
function attorneyGateCorrect({ output }: DocGenScorerArgs): DocGenScore {
  const allGated = output.documents.every((d) => d.attorneyReviewRequired === true);
  return { name: 'attorney-gate-correct', score: allGated ? 1 : 0 };
}

// 3) The emitted document-kind multiset matches the expected set exactly
//    (right core set, gap docs only when gap > 0, one aom per existing loan).
function planCompleteness({ output, expected }: DocGenScorerArgs): DocGenScore {
  const got = sortedJoin(output.documents.map((d) => d.kind));
  const want = sortedJoin(expected.kinds);
  return { name: 'plan-completeness', score: got === want ? 1 : 0 };
}

// 4) No PII leaks into the document field-maps (hard rule #3): field values are
//    ids / amounts / county / static tokens -- never a borrower name (which IS
//    in the input) or an SSN. Verifies the field-maps stay PII-free by design.
function noPiiLeak({ input, output }: DocGenScorerArgs): DocGenScore {
  const names = input.borrowerNames.map((n) => n.toLowerCase()).filter((n) => n.length > 0);
  const ssn = /\b\d{3}-\d{2}-\d{4}\b/;
  const leaked = output.documents.some((d) =>
    Object.values(d.fields).some((v) => {
      if (typeof v !== 'string') return false;
      const lower = v.toLowerCase();
      return ssn.test(v) || names.some((n) => lower.includes(n));
    }),
  );
  return { name: 'no-pii-leak', score: leaked ? 0 : 1 };
}

// 5) The computed gap (new money = newPrincipal - sum(UPB)) matches expected.
function gapCorrect({ output, expected }: DocGenScorerArgs): DocGenScore {
  return { name: 'gap-correct', score: output.gap === expected.gap ? 1 : 0 };
}

export const DOC_GEN_SCORERS = [
  consistencyCorrect,
  attorneyGateCorrect,
  planCompleteness,
  noPiiLeak,
  gapCorrect,
] as const;

// Runs the real planner for a fixture -- shared by the offline test + the live
// Braintrust task so both grade identical output.
export function runPlan(input: DealDocGenInput): DocumentPlan {
  return planDocuments(input);
}
