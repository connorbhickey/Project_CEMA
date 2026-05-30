import type { OutreachAction, OutreachCadence, ServicerResponse, SubmissionMethod } from './types';

/** Business-day offsets for the 5 touches: initial (T+0) + follow-ups at
 * T+5/10/15/20. A named constant so cadence is tunable without touching logic. */
export const OUTREACH_OFFSETS_BUSINESS_DAYS: readonly number[] = [0, 5, 10, 15, 20] as const;

/**
 * Adds `n` business days (Mon-Fri) to `from`, skipping weekends. `n = 0`
 * returns a copy of `from` unchanged (T+0 is the trigger instant, sent
 * immediately regardless of weekday). NY bank holidays are NOT yet excluded
 * (carry-over -- pairs with the Connor-owned NY reference-data confirmation).
 * Operates in UTC so the result is deterministic across server timezones.
 */
export function addBusinessDays(from: Date, n: number): Date {
  const r = new Date(from.getTime());
  let added = 0;
  while (added < n) {
    r.setUTCDate(r.getUTCDate() + 1);
    const day = r.getUTCDay();
    if (day !== 0 && day !== 6) added += 1;
  }
  return r;
}

/** Resolves the absolute due-dates + primary channel for one deal. Pure. */
export function planOutreachCadence(trigger: {
  triggeredAt: Date;
  acceptedSubmissionMethods: SubmissionMethod[];
}): OutreachCadence {
  const dueAt = OUTREACH_OFFSETS_BUSINESS_DAYS.map((offset) =>
    addBusinessDays(trigger.triggeredAt, offset),
  );
  const channel: SubmissionMethod | null = trigger.acceptedSubmissionMethods.includes('email')
    ? 'email'
    : (trigger.acceptedSubmissionMethods[0] ?? null);
  return { dueAt, channel };
}

/**
 * The decision function: given the planned cadence, the current time, how many
 * touches were already sent, and any classified response, returns the next
 * action. Storage-agnostic -- `touchesSent` is an input, so re-evaluation (and
 * WDK replay) is reproducible.
 */
export function nextOutreachAction(input: {
  cadence: OutreachCadence;
  now: Date;
  touchesSent: number;
  response?: ServicerResponse | null;
}): OutreachAction {
  const { cadence, now, touchesSent, response } = input;

  if (cadence.channel !== 'email') {
    return { kind: 'unsupported_channel', method: cadence.channel };
  }
  if (response && response.kind !== 'other') {
    return { kind: 'stop', reason: 'responded' };
  }
  if (touchesSent >= cadence.dueAt.length) {
    return { kind: 'stop', reason: 'exhausted' };
  }
  const nextDueAt = cadence.dueAt[touchesSent]!;
  if (now.getTime() >= nextDueAt.getTime()) {
    return { kind: 'send', touchNumber: touchesSent + 1 };
  }
  return { kind: 'wait', until: nextDueAt };
}
