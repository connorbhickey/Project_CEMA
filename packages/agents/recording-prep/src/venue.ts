import type { DealRecordingInput, VenueResolution } from './types';

// NYC counties (+ borough aliases) -> borough number. The fallback signal when
// acrisBbl is absent. Manhattan=1, Bronx=2, Brooklyn=3, Queens=4, Staten Island=5.
const NYC_BOROUGH_BY_COUNTY: Record<string, number> = {
  'new york': 1,
  manhattan: 1,
  bronx: 2,
  kings: 3,
  brooklyn: 3,
  queens: 4,
  richmond: 5,
  'staten island': 5,
};

/**
 * Resolve the recording venue. Primary signal: the acrisBbl borough digit (the DB
 * enforces ^[1-5]-\d{1,5}-\d{1,4}$). Fallback: the county name (NYC county or
 * borough alias). Else upstate county clerk. Pure, no IO.
 */
export function resolveVenue(input: DealRecordingInput): VenueResolution {
  const bbl = input.acrisBbl?.match(/^([1-5])-/);
  if (bbl) return { venue: 'acris', borough: Number(bbl[1]) };
  const borough = NYC_BOROUGH_BY_COUNTY[input.county.trim().toLowerCase()];
  if (borough) return { venue: 'acris', borough };
  return { venue: 'county', borough: null };
}
