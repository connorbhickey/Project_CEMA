// Federal Reserve bank-holiday calendar (the schedule national mortgage servicers
// follow for mail/processing), computed in UTC for determinism + durable-replay
// safety (no Date.now / argless new Date). Sunday holidays are observed the
// following Monday (the Fed rule); Saturday holidays are NOT shifted to Friday
// (banks are closed Saturday anyway, and addBusinessDays never lands on a weekend).
//
// NOTE for Connor: this is the FEDERAL RESERVE set. NY-State-chartered banks also
// observe Lincoln's Birthday (Feb 12) and may close for Election Day — add those
// here once the design partner's servicer charter is confirmed (the carry-over's
// "Connor-owned NY reference-data confirmation").

const FIXED: ReadonlyArray<{ month: number; day: number }> = [
  { month: 0, day: 1 }, // New Year's Day
  { month: 5, day: 19 }, // Juneteenth
  { month: 6, day: 4 }, // Independence Day
  { month: 10, day: 11 }, // Veterans Day
  { month: 11, day: 25 }, // Christmas Day
];

function utc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day));
}

/** The nth (1-based) `weekday` (0=Sun..6=Sat) of `month` (0-based) in `year`. */
function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  const firstWeekday = utc(year, month, 1).getUTCDay();
  const offset = (weekday - firstWeekday + 7) % 7;
  return utc(year, month, 1 + offset + (n - 1) * 7);
}

/** The last `weekday` of `month` (0-based) in `year`. */
function lastWeekday(year: number, month: number, weekday: number): Date {
  const lastDay = utc(year, month + 1, 0); // day 0 of next month = last day of this one
  const offset = (lastDay.getUTCDay() - weekday + 7) % 7;
  return utc(year, month, lastDay.getUTCDate() - offset);
}

const dayKey = (d: Date): string => d.toISOString().slice(0, 10);

/** Sunday holidays are observed the following Monday (Federal Reserve rule). */
function observed(d: Date): Date {
  if (d.getUTCDay() !== 0) return d;
  return utc(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

/** The set of observed bank-holiday date keys (YYYY-MM-DD, UTC) for a year. */
export function bankHolidaysForYear(year: number): ReadonlySet<string> {
  const dates: Date[] = [
    ...FIXED.map((f) => utc(year, f.month, f.day)),
    nthWeekday(year, 0, 1, 3), // MLK Jr. Day — 3rd Monday of January
    nthWeekday(year, 1, 1, 3), // Presidents' Day — 3rd Monday of February
    lastWeekday(year, 4, 1), // Memorial Day — last Monday of May
    nthWeekday(year, 8, 1, 1), // Labor Day — 1st Monday of September
    nthWeekday(year, 9, 1, 2), // Columbus Day — 2nd Monday of October
    nthWeekday(year, 10, 4, 4), // Thanksgiving — 4th Thursday of November
  ];
  return new Set(dates.map((d) => dayKey(observed(d))));
}

/** Whether `date` (UTC) is an observed Federal Reserve bank holiday. */
export function isBankHoliday(date: Date): boolean {
  return bankHolidaysForYear(date.getUTCFullYear()).has(dayKey(date));
}
