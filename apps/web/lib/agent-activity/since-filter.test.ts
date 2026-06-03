import { describe, expect, it } from 'vitest';

import { SINCE_FILTERS, parseSinceFilter, sinceCutoffMs } from './since-filter';

describe('since-filter', () => {
  it('exposes All + three windows, All first with a null cutoff', () => {
    expect(SINCE_FILTERS.map((f) => f.key)).toEqual(['all', '24h', '7d', '30d']);
    expect(SINCE_FILTERS[0]).toMatchObject({ key: 'all', cutoffMs: null });
  });

  it('parses a real window to its key', () => {
    expect(parseSinceFilter('7d')).toBe('7d');
    expect(parseSinceFilter('24h')).toBe('24h');
  });

  it('treats all / unknown / absent as no filter (null)', () => {
    expect(parseSinceFilter('all')).toBeNull(); // All time == no time filter
    expect(parseSinceFilter('nonsense')).toBeNull();
    expect(parseSinceFilter(undefined)).toBeNull();
    expect(parseSinceFilter(null)).toBeNull();
  });

  it('maps a key to its lookback duration in ms', () => {
    expect(sinceCutoffMs('24h')).toBe(24 * 60 * 60 * 1000);
    expect(sinceCutoffMs('7d')).toBe(7 * 24 * 60 * 60 * 1000);
    expect(sinceCutoffMs('30d')).toBe(30 * 24 * 60 * 60 * 1000);
    expect(sinceCutoffMs('all')).toBeNull();
    expect(sinceCutoffMs('nope')).toBeNull();
  });
});
