import { describe, expect, it } from 'vitest';

import { DEAL_ACTIVITY_TYPE_FILTERS, parseDealActivityType } from './deal-activity-filter';

describe('parseDealActivityType', () => {
  it('accepts the known type tokens', () => {
    expect(parseDealActivityType('communication')).toBe('communication');
    expect(parseDealActivityType('document')).toBe('document');
  });

  it('degrades unknown / absent input to null (unfiltered)', () => {
    expect(parseDealActivityType('communications')).toBeNull(); // plural typo
    expect(parseDealActivityType('email')).toBeNull();
    expect(parseDealActivityType('')).toBeNull();
    expect(parseDealActivityType(undefined)).toBeNull();
    expect(parseDealActivityType(null)).toBeNull();
  });
});

describe('DEAL_ACTIVITY_TYPE_FILTERS', () => {
  it('covers every parseable type exactly once', () => {
    const keys = DEAL_ACTIVITY_TYPE_FILTERS.map((f) => f.key);
    expect(keys).toEqual(['communication', 'document']);
    // every chip key must itself parse back to the same token (drift guard)
    for (const f of DEAL_ACTIVITY_TYPE_FILTERS) {
      expect(parseDealActivityType(f.key)).toBe(f.key);
    }
  });
});
