import { notificationForStatus } from '../src/notify';
import type { InternalNotification } from '../src/types';

import type { InternalFixture } from './fixtures';

export type InternalExpected = InternalFixture['expected'];

export interface InternalScorerArgs {
  readonly input: string;
  readonly expected: InternalExpected;
  readonly output: InternalNotification | null;
}

export interface InternalScore {
  readonly name: string;
  readonly score: number;
}

// 1) Notify-vs-null decision matches; when notifying, the status echoes the input
//    and the channel is 'pipeline'.
function decisionCorrect({ input, expected, output }: InternalScorerArgs): InternalScore {
  if (expected === null) return { name: 'decision-correct', score: output === null ? 1 : 0 };
  if (output === null) return { name: 'decision-correct', score: 0 };
  const ok = output.status === input && output.channel === 'pipeline';
  return { name: 'decision-correct', score: ok ? 1 : 0 };
}

// 2) The emitted message matches the expected static template (or both are null).
function messageCorrect({ expected, output }: InternalScorerArgs): InternalScore {
  if (expected === null) return { name: 'message-correct', score: output === null ? 1 : 0 };
  return { name: 'message-correct', score: output?.message === expected.message ? 1 : 0 };
}

// 3) No PII in the message (hard rule #3): static template, so no SSN and no 3+
//    digit run (guards a future interpolation of a count/id/amount).
const SSN = /\b\d{3}-\d{2}-\d{4}\b/;
const DIGIT_RUN = /\d{3,}/;
function noPiiLeak({ output }: InternalScorerArgs): InternalScore {
  if (output === null) return { name: 'no-pii-leak', score: 1 };
  const bad =
    output.message.length === 0 || SSN.test(output.message) || DIGIT_RUN.test(output.message);
  return { name: 'no-pii-leak', score: bad ? 0 : 1 };
}

export const INTERNAL_SCORERS = [decisionCorrect, messageCorrect, noPiiLeak] as const;

export function runNotify(input: string): InternalNotification | null {
  return notificationForStatus(input);
}
