/** One time-window filter for the activity feeds. `cutoffMs` is the lookback
 *  duration in milliseconds, or null for "all time" (no filter). */
export interface SinceFilter {
  readonly key: string;
  readonly label: string;
  readonly cutoffMs: number | null;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const SINCE_FILTERS: readonly SinceFilter[] = [
  { key: 'all', label: 'All time', cutoffMs: null },
  { key: '24h', label: '24h', cutoffMs: 24 * HOUR },
  { key: '7d', label: '7d', cutoffMs: 7 * DAY },
  { key: '30d', label: '30d', cutoffMs: 30 * DAY },
];

/** Validate an untrusted `?since=` searchParam. Returns the key only for a real
 *  time window; 'all' / unknown / absent → null (no time filter). */
export function parseSinceFilter(raw: string | undefined | null): string | null {
  if (raw == null) return null;
  const f = SINCE_FILTERS.find((x) => x.key === raw);
  return f && f.cutoffMs !== null ? f.key : null;
}

/** The lookback duration (ms) for a key, or null (all-time / unknown). The RSC
 *  turns this into `new Date(Date.now() - ms)` — Date.now() stays out of here so
 *  this module is deterministic + node-testable. */
export function sinceCutoffMs(key: string): number | null {
  return SINCE_FILTERS.find((f) => f.key === key)?.cutoffMs ?? null;
}
