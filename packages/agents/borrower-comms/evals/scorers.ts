import { borrowerNotificationForStatus } from '../src/notify';
import type { BorrowerNotification } from '../src/types';

import type { BorrowerFixture } from './fixtures';

export type BorrowerExpected = BorrowerFixture['expected'];

export interface BorrowerScorerArgs {
  readonly input: string;
  readonly expected: BorrowerExpected;
  readonly output: BorrowerNotification | null;
}

export interface BorrowerScore {
  readonly name: string;
  readonly score: number;
}

// 1) Notify-vs-null decision matches. CRITICAL: 'exception' (and every
//    non-touchpoint status) must be null -- a borrower is never emailed about it.
function decisionCorrect({ input, expected, output }: BorrowerScorerArgs): BorrowerScore {
  if (expected === null) return { name: 'decision-correct', score: output === null ? 1 : 0 };
  if (output === null) return { name: 'decision-correct', score: 0 };
  return { name: 'decision-correct', score: output.status === input ? 1 : 0 };
}

// 2) Subject + body match the expected static template (or both are null).
function contentCorrect({ expected, output }: BorrowerScorerArgs): BorrowerScore {
  if (expected === null) return { name: 'content-correct', score: output === null ? 1 : 0 };
  if (output === null) return { name: 'content-correct', score: 0 };
  const ok = output.subject === expected.subject && output.body === expected.body;
  return { name: 'content-correct', score: ok ? 1 : 0 };
}

// 3) No PII in subject/body (hard rule #3): static templates, so no SSN and no 3+
//    digit run (guards a future personalization leak of a name/amount/account).
const SSN = /\b\d{3}-\d{2}-\d{4}\b/;
const DIGIT_RUN = /\d{3,}/;
function noPiiLeak({ output }: BorrowerScorerArgs): BorrowerScore {
  if (output === null) return { name: 'no-pii-leak', score: 1 };
  const text = `${output.subject}\n${output.body}`;
  const bad = SSN.test(text) || DIGIT_RUN.test(text);
  return { name: 'no-pii-leak', score: bad ? 0 : 1 };
}

// 4) Email-only channel (hard rule #4 -- TCPA-safe). v1 must never emit sms/voice;
//    the single-member BorrowerChannel union enforces this at compile time, this
//    re-verifies it at runtime over every touchpoint.
function emailOnlyChannel({ output }: BorrowerScorerArgs): BorrowerScore {
  if (output === null) return { name: 'email-only-channel', score: 1 };
  return { name: 'email-only-channel', score: output.channel === 'email' ? 1 : 0 };
}

export const BORROWER_SCORERS = [
  decisionCorrect,
  contentCorrect,
  noPiiLeak,
  emailOnlyChannel,
] as const;

export function runNotify(input: string): BorrowerNotification | null {
  return borrowerNotificationForStatus(input);
}
