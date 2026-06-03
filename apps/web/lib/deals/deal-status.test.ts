import { dealStatusEnum } from '@cema/db';
import { describe, expect, it } from 'vitest';

import { DEAL_STATUS_LABELS, dealStatusLabel, parseDealStatusFilter } from './deal-status';

describe('dealStatusLabel', () => {
  it('returns the Title-Case label for a known status', () => {
    expect(dealStatusLabel('collateral_chase')).toBe('Collateral Chase');
  });
  it('falls back to the raw value for an unknown status', () => {
    expect(dealStatusLabel('mystery')).toBe('mystery');
  });
});

describe('parseDealStatusFilter', () => {
  it('accepts a valid status', () => {
    expect(parseDealStatusFilter('intake')).toBe('intake');
  });
  it('rejects an unknown status', () => {
    expect(parseDealStatusFilter('foo')).toBeNull();
  });
  it('rejects undefined and empty', () => {
    expect(parseDealStatusFilter(undefined)).toBeNull();
    expect(parseDealStatusFilter('')).toBeNull();
  });
});

describe('DEAL_STATUS_LABELS drift guard', () => {
  it('covers exactly the deal_status enum', () => {
    expect(Object.keys(DEAL_STATUS_LABELS).sort()).toEqual([...dealStatusEnum.enumValues].sort());
  });
});
