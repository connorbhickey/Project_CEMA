import { describe, expect, it } from 'vitest';

import { bankHolidaysForYear, isBankHoliday } from './holidays';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe('bank holidays', () => {
  it('flags fixed-date holidays on a weekday', () => {
    expect(isBankHoliday(d('2026-01-01'))).toBe(true); // New Year's Day (Thu)
    expect(isBankHoliday(d('2026-06-19'))).toBe(true); // Juneteenth (Fri)
    expect(isBankHoliday(d('2026-12-25'))).toBe(true); // Christmas (Fri)
  });

  it('computes floating holidays (nth / last weekday)', () => {
    expect(isBankHoliday(d('2026-01-19'))).toBe(true); // MLK — 3rd Mon Jan
    expect(isBankHoliday(d('2026-02-16'))).toBe(true); // Presidents' — 3rd Mon Feb
    expect(isBankHoliday(d('2026-05-25'))).toBe(true); // Memorial — last Mon May
    expect(isBankHoliday(d('2026-09-07'))).toBe(true); // Labor — 1st Mon Sep
    expect(isBankHoliday(d('2026-10-12'))).toBe(true); // Columbus — 2nd Mon Oct
    expect(isBankHoliday(d('2026-11-26'))).toBe(true); // Thanksgiving — 4th Thu Nov
  });

  it('observes a Sunday holiday on the following Monday (Fed rule)', () => {
    // 2028-12-31 is Sunday → New Year's Day 2029-01-01 is Monday (weekday, in set).
    // Test the canonical case: New Year 2023 fell on Sunday → observed Mon Jan 2.
    expect(isBankHoliday(d('2023-01-02'))).toBe(true); // observed Monday
    expect(bankHolidaysForYear(2023).has('2023-01-01')).toBe(false); // the Sunday itself is not the observed key
  });

  it('does NOT flag ordinary weekdays', () => {
    expect(isBankHoliday(d('2026-01-20'))).toBe(false); // Tue after MLK
    expect(isBankHoliday(d('2026-07-06'))).toBe(false); // Mon after July 4 (Sat) — Fed does not shift Sat to a weekday
  });

  it('produces the full Federal Reserve set (11 holidays) per year', () => {
    expect(bankHolidaysForYear(2026).size).toBe(11);
  });
});
