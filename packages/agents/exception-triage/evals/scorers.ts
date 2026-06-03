import { triageExceptions } from '../src/triage';
import type {
  DealSignals,
  Exception,
  ExceptionKind,
  ExceptionRoute,
  ExceptionSeverity,
} from '../src/types';

import type { TriageFixture } from './fixtures';

export type TriageExpected = TriageFixture['expected'];

export interface TriageScorerArgs {
  readonly input: DealSignals;
  readonly expected: TriageExpected;
  readonly output: readonly Exception[];
}

export interface TriageScore {
  readonly name: string;
  readonly score: number;
}

// Independent restatement of the agent's static maps (a regression guard, not a
// copy of the impl). A drift in SEVERITY_BY_KIND / ROUTE_BY_KIND / REASON_BY_KIND
// makes the corresponding scorer fail.
const SEVERITY: Record<ExceptionKind, ExceptionSeverity> = {
  chain_break: 'high',
  agent_dispatch_failed: 'medium',
  deal_flagged_exception: 'high',
  rejected_recording: 'high',
};
const ROUTE: Record<ExceptionKind, ExceptionRoute> = {
  chain_break: 'attorney_review',
  agent_dispatch_failed: 'reprocess',
  deal_flagged_exception: 'processor_review',
  rejected_recording: 'processor_review',
};
const REASON: Record<ExceptionKind, string> = {
  chain_break: 'Chain-of-title breaks are awaiting attorney review.',
  agent_dispatch_failed:
    'A post-commit agent dispatch failed; re-run the collateral pipeline for this deal.',
  deal_flagged_exception: 'This deal is flagged as an exception and needs processor review.',
  rejected_recording: 'A recording submission was rejected and needs processor review.',
};

const sortedJoin = (xs: readonly string[]): string => [...xs].sort().join(',');

// 1) The classified kind set matches (which signals -> which exceptions). The
//    clean-deal floor (expected.kinds == []) is checked here too: a clean deal
//    must yield no exceptions.
function kindsCorrect({ output, expected }: TriageScorerArgs): TriageScore {
  const got = sortedJoin(output.map((e) => e.kind));
  const want = sortedJoin(expected.kinds);
  return { name: 'kinds-correct', score: got === want ? 1 : 0 };
}

// 2) Each emitted exception carries the correct severity + route for its kind.
function severityRouteCorrect({ output }: TriageScorerArgs): TriageScore {
  const ok = output.every((e) => e.severity === SEVERITY[e.kind] && e.route === ROUTE[e.kind]);
  return { name: 'severity-route-correct', score: ok ? 1 : 0 };
}

// 3) Each emitted reason is the expected static, PII-free template.
function reasonCorrect({ output }: TriageScorerArgs): TriageScore {
  const ok = output.every((e) => e.reason === REASON[e.kind]);
  return { name: 'reason-correct', score: ok ? 1 : 0 };
}

// 4) No PII embedded in any reason (hard rule #3): no SSN pattern and no 3+ digit
//    run (an id/count/amount would leak through interpolation).
const SSN = /\b\d{3}-\d{2}-\d{4}\b/;
const DIGIT_RUN = /\d{3,}/;
function noPiiLeak({ output }: TriageScorerArgs): TriageScore {
  const leaked = output.some(
    (e) => e.reason.length === 0 || SSN.test(e.reason) || DIGIT_RUN.test(e.reason),
  );
  return { name: 'no-pii-leak', score: leaked ? 0 : 1 };
}

export const TRIAGE_SCORERS = [
  kindsCorrect,
  severityRouteCorrect,
  reasonCorrect,
  noPiiLeak,
] as const;

export function runTriage(input: DealSignals): readonly Exception[] {
  return triageExceptions(input);
}
