import { describe, expect, it } from 'vitest';

import { PLACEHOLDER_RATES, estimateSavings } from './savings';
import type { NormalizedApplication, RecordingTaxRateTable } from './types';

function app(overrides: Partial<NormalizedApplication> = {}): NormalizedApplication {
  return {
    externalId: 'LOS-0001',
    state: 'NY',
    propertyType: 'single_family',
    loanProgram: 'conventional',
    lienPosition: 1,
    existingUpb: 400_000,
    newLoanAmount: 500_000,
    county: 'Kings',
    ...overrides,
  };
}

/** A deterministic, NON-placeholder table for exercising the arithmetic and county lookup. */
const synthetic: RecordingTaxRateTable = {
  isPlaceholder: false,
  ratesByCounty: { kings: 0.02, 'new york': 0.0205 },
  defaultRate: 0.01,
  estimatedFees: 1_000,
};

describe('estimateSavings', () => {
  it('returns a fully-populated SavingsEstimate', () => {
    const result = estimateSavings(app(), synthetic);
    expect(typeof result.assignedUpb).toBe('number');
    expect(typeof result.appliedRate).toBe('number');
    expect(typeof result.taxSaved).toBe('number');
    expect(typeof result.fees).toBe('number');
    expect(typeof result.netSavings).toBe('number');
    expect(typeof result.isPlaceholderRate).toBe('boolean');
  });

  it('assigns the full existing UPB as the §255-exempt base', () => {
    const result = estimateSavings(app({ existingUpb: 350_000 }), synthetic);
    expect(result.assignedUpb).toBe(350_000);
  });

  it('clamps a non-positive UPB to zero (no negative tax base)', () => {
    expect(estimateSavings(app({ existingUpb: 0 }), synthetic).assignedUpb).toBe(0);
    expect(estimateSavings(app({ existingUpb: -5 }), synthetic).assignedUpb).toBe(0);
  });

  it('computes taxSaved as assignedUpb × appliedRate', () => {
    const result = estimateSavings(app({ existingUpb: 400_000, county: 'Kings' }), synthetic);
    expect(result.appliedRate).toBe(0.02);
    expect(result.taxSaved).toBeCloseTo(400_000 * 0.02, 6);
  });

  it('computes netSavings as taxSaved − fees', () => {
    const result = estimateSavings(app(), synthetic);
    expect(result.netSavings).toBeCloseTo(result.taxSaved - result.fees, 6);
  });

  it('allows a negative net saving when fees exceed the tax saved', () => {
    const tinyUpb = estimateSavings(app({ existingUpb: 100, county: 'Kings' }), synthetic);
    expect(tinyUpb.netSavings).toBeLessThan(0);
  });

  describe('county rate lookup', () => {
    it('uses the county-specific rate when present', () => {
      expect(estimateSavings(app({ county: 'New York' }), synthetic).appliedRate).toBe(0.0205);
    });

    it('matches county names case-insensitively', () => {
      expect(estimateSavings(app({ county: 'KINGS' }), synthetic).appliedRate).toBe(0.02);
      expect(estimateSavings(app({ county: '  kings  ' }), synthetic).appliedRate).toBe(0.02);
    });

    it('falls back to the default rate for an unknown county', () => {
      expect(estimateSavings(app({ county: 'Nowhere' }), synthetic).appliedRate).toBe(0.01);
    });
  });

  describe('placeholder semantics', () => {
    it('flags estimates derived from PLACEHOLDER_RATES', () => {
      expect(estimateSavings(app(), PLACEHOLDER_RATES).isPlaceholderRate).toBe(true);
    });

    it('does not flag estimates from a confirmed (non-placeholder) table', () => {
      expect(estimateSavings(app(), synthetic).isPlaceholderRate).toBe(false);
    });

    it('defaults to PLACEHOLDER_RATES when no table is supplied', () => {
      expect(estimateSavings(app()).isPlaceholderRate).toBe(true);
    });

    it('keeps PLACEHOLDER_RATES marked as placeholder (compliance guard)', () => {
      expect(PLACEHOLDER_RATES.isPlaceholder).toBe(true);
    });
  });
});
