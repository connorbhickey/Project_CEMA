import { describe, expect, it } from 'vitest';

import {
  OUTREACH_OFFSETS_BUSINESS_DAYS,
  addBusinessDays,
  planOutreachCadence,
  nextOutreachAction,
} from './cadence';
import type { OutreachCadence } from './types';

const MON_2026_06_01 = new Date('2026-06-01T14:00:00.000Z'); // Monday

describe('addBusinessDays', () => {
  it('returns a copy of the input for n=0 (T+0 = trigger instant)', () => {
    const out = addBusinessDays(MON_2026_06_01, 0);
    expect(out.getTime()).toBe(MON_2026_06_01.getTime());
    expect(out).not.toBe(MON_2026_06_01); // copy, not same ref
  });

  it('skips weekends counting forward from Monday', () => {
    // Mon +5 business days = next Monday (2026-06-08)
    expect(addBusinessDays(MON_2026_06_01, 5).toISOString()).toBe('2026-06-08T14:00:00.000Z');
  });

  it('skips the weekend when starting Friday', () => {
    const fri = new Date('2026-06-05T09:00:00.000Z'); // Friday
    // Fri +1 bd = Mon 2026-06-08
    expect(addBusinessDays(fri, 1).toISOString()).toBe('2026-06-08T09:00:00.000Z');
  });
});

describe('planOutreachCadence', () => {
  it('produces 5 due-dates at the named offsets and resolves email channel', () => {
    const cadence = planOutreachCadence({
      triggeredAt: MON_2026_06_01,
      acceptedSubmissionMethods: ['email', 'portal'],
    });
    expect(cadence.channel).toBe('email');
    expect(cadence.dueAt.map((d) => d.toISOString())).toEqual([
      '2026-06-01T14:00:00.000Z', // T+0
      '2026-06-08T14:00:00.000Z', // T+5bd
      '2026-06-15T14:00:00.000Z', // T+10bd
      '2026-06-22T14:00:00.000Z', // T+15bd
      '2026-06-29T14:00:00.000Z', // T+20bd
    ]);
    expect(cadence.dueAt.length).toBe(OUTREACH_OFFSETS_BUSINESS_DAYS.length);
  });

  it('falls back to the first method when email is not accepted', () => {
    const cadence = planOutreachCadence({
      triggeredAt: MON_2026_06_01,
      acceptedSubmissionMethods: ['portal', 'fax_only'],
    });
    expect(cadence.channel).toBe('portal');
  });

  it('resolves a null channel when no methods are accepted', () => {
    const cadence = planOutreachCadence({
      triggeredAt: MON_2026_06_01,
      acceptedSubmissionMethods: [],
    });
    expect(cadence.channel).toBeNull();
  });
});

describe('nextOutreachAction', () => {
  const cadence: OutreachCadence = planOutreachCadence({
    triggeredAt: MON_2026_06_01,
    acceptedSubmissionMethods: ['email'],
  });

  it('sends touch 1 when now >= first due-date and nothing sent', () => {
    const action = nextOutreachAction({ cadence, now: MON_2026_06_01, touchesSent: 0 });
    expect(action).toEqual({ kind: 'send', touchNumber: 1 });
  });

  it('waits until the next due-date when the next touch is in the future', () => {
    const action = nextOutreachAction({ cadence, now: MON_2026_06_01, touchesSent: 1 });
    expect(action).toEqual({ kind: 'wait', until: new Date('2026-06-08T14:00:00.000Z') });
  });

  it('stops as exhausted after the final touch', () => {
    const action = nextOutreachAction({
      cadence,
      now: new Date('2026-07-01T00:00:00.000Z'),
      touchesSent: 5,
    });
    expect(action).toEqual({ kind: 'stop', reason: 'exhausted' });
  });

  it('stops as responded on an actionable response', () => {
    const action = nextOutreachAction({
      cadence,
      now: MON_2026_06_01,
      touchesSent: 1,
      response: { kind: 'delivered' },
    });
    expect(action).toEqual({ kind: 'stop', reason: 'responded' });
  });

  it('does NOT stop on an "other" response (noise)', () => {
    const action = nextOutreachAction({
      cadence,
      now: MON_2026_06_01,
      touchesSent: 0,
      response: { kind: 'other' },
    });
    expect(action).toEqual({ kind: 'send', touchNumber: 1 });
  });

  it('returns unsupported_channel when the channel is not email', () => {
    const portal = planOutreachCadence({
      triggeredAt: MON_2026_06_01,
      acceptedSubmissionMethods: ['portal'],
    });
    const action = nextOutreachAction({ cadence: portal, now: MON_2026_06_01, touchesSent: 0 });
    expect(action).toEqual({ kind: 'unsupported_channel', method: 'portal' });
  });
});
