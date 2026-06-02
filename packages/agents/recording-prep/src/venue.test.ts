import { describe, expect, it } from 'vitest';

import type { DealRecordingInput } from './types';
import { resolveVenue } from './venue';

const base = (over: Partial<DealRecordingInput>): DealRecordingInput => ({
  dealId: 'd1',
  cemaType: 'refi_cema',
  county: 'Albany',
  acrisBbl: null,
  ...over,
});

describe('resolveVenue', () => {
  it('routes each NYC borough via the acrisBbl borough digit', () => {
    expect(resolveVenue(base({ acrisBbl: '1-00100-0001' }))).toEqual({
      venue: 'acris',
      borough: 1,
    });
    expect(resolveVenue(base({ acrisBbl: '3-09999-1234' }))).toEqual({
      venue: 'acris',
      borough: 3,
    });
    expect(resolveVenue(base({ acrisBbl: '5-00001-0001' }))).toEqual({
      venue: 'acris',
      borough: 5,
    });
  });

  it('falls back to NYC county / borough-alias names when acrisBbl is absent', () => {
    expect(resolveVenue(base({ county: 'Kings' }))).toEqual({ venue: 'acris', borough: 3 });
    expect(resolveVenue(base({ county: 'Brooklyn' }))).toEqual({ venue: 'acris', borough: 3 });
    expect(resolveVenue(base({ county: 'New York' }))).toEqual({ venue: 'acris', borough: 1 });
    expect(resolveVenue(base({ county: 'Richmond' }))).toEqual({ venue: 'acris', borough: 5 });
  });

  it('routes upstate counties to the county clerk', () => {
    expect(resolveVenue(base({ county: 'Nassau' }))).toEqual({ venue: 'county', borough: null });
    expect(resolveVenue(base({ county: 'Erie' }))).toEqual({ venue: 'county', borough: null });
  });

  it('prefers acrisBbl over a conflicting county name', () => {
    // bbl says borough 2 (Bronx); county text says Nassau (upstate) -> bbl wins
    expect(resolveVenue(base({ county: 'Nassau', acrisBbl: '2-00100-0001' }))).toEqual({
      venue: 'acris',
      borough: 2,
    });
  });

  it('is case- and whitespace-insensitive on the county fallback', () => {
    expect(resolveVenue(base({ county: '  queens ' }))).toEqual({ venue: 'acris', borough: 4 });
  });
});
