import { describe, expect, it } from 'vitest';

import { checkEligibility } from './eligibility';
import type { LoanProgram, NormalizedApplication, PropertyType } from './types';

/** A baseline application that satisfies every eligibility rule. Tests override one field at a time. */
function eligibleApp(overrides: Partial<NormalizedApplication> = {}): NormalizedApplication {
  return {
    externalId: 'LOS-0001',
    cemaType: 'refi_cema',
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

describe('checkEligibility', () => {
  it('accepts a fully eligible application with no reasons', () => {
    const result = checkEligibility(eligibleApp());
    expect(result.eligible).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  describe('state rule (NY only)', () => {
    it('rejects a non-NY application', () => {
      const result = checkEligibility(eligibleApp({ state: 'NJ' }));
      expect(result.eligible).toBe(false);
      expect(result.reasons).toContain('not_ny');
    });

    it('treats the state code case-insensitively', () => {
      const result = checkEligibility(eligibleApp({ state: 'ny' }));
      expect(result.reasons).not.toContain('not_ny');
    });
  });

  describe('property-type rule (allowlist, fails closed)', () => {
    const eligibleTypes: PropertyType[] = [
      'single_family',
      'two_family',
      'three_family',
      'condo',
      'pud',
    ];
    for (const propertyType of eligibleTypes) {
      it(`accepts ${propertyType}`, () => {
        const result = checkEligibility(eligibleApp({ propertyType }));
        expect(result.reasons).not.toContain('ineligible_property_type');
      });
    }

    const ineligibleTypes: PropertyType[] = ['co_op', 'four_plus_family', 'mixed_use'];
    for (const propertyType of ineligibleTypes) {
      it(`rejects ${propertyType}`, () => {
        const result = checkEligibility(eligibleApp({ propertyType }));
        expect(result.eligible).toBe(false);
        expect(result.reasons).toContain('ineligible_property_type');
      });
    }
  });

  describe('loan-program rule (blocklist of VA/FHA)', () => {
    it('rejects a VA loan', () => {
      const result = checkEligibility(eligibleApp({ loanProgram: 'va' }));
      expect(result.eligible).toBe(false);
      expect(result.reasons).toContain('ineligible_loan_program');
    });

    it('rejects an FHA loan', () => {
      const result = checkEligibility(eligibleApp({ loanProgram: 'fha' }));
      expect(result.eligible).toBe(false);
      expect(result.reasons).toContain('ineligible_loan_program');
    });

    const allowedPrograms: LoanProgram[] = ['conventional', 'usda'];
    for (const loanProgram of allowedPrograms) {
      it(`accepts ${loanProgram}`, () => {
        const result = checkEligibility(eligibleApp({ loanProgram }));
        expect(result.reasons).not.toContain('ineligible_loan_program');
      });
    }
  });

  describe('first-lien rule', () => {
    it('rejects a second-lien application', () => {
      const result = checkEligibility(eligibleApp({ lienPosition: 2 }));
      expect(result.eligible).toBe(false);
      expect(result.reasons).toContain('not_first_lien');
    });

    it('accepts a first-lien application', () => {
      const result = checkEligibility(eligibleApp({ lienPosition: 1 }));
      expect(result.reasons).not.toContain('not_first_lien');
    });
  });

  describe('existing-UPB rule', () => {
    it('rejects a zero-UPB application', () => {
      const result = checkEligibility(eligibleApp({ existingUpb: 0 }));
      expect(result.eligible).toBe(false);
      expect(result.reasons).toContain('no_existing_upb');
    });

    it('rejects a negative UPB defensively', () => {
      const result = checkEligibility(eligibleApp({ existingUpb: -1 }));
      expect(result.eligible).toBe(false);
      expect(result.reasons).toContain('no_existing_upb');
    });
  });

  describe('multiple failures', () => {
    it('collects every failed rule rather than short-circuiting', () => {
      const result = checkEligibility(
        eligibleApp({
          state: 'CA',
          propertyType: 'co_op',
          loanProgram: 'va',
          lienPosition: 3,
          existingUpb: 0,
        }),
      );
      expect(result.eligible).toBe(false);
      expect(result.reasons).toEqual(
        expect.arrayContaining([
          'not_ny',
          'ineligible_property_type',
          'ineligible_loan_program',
          'not_first_lien',
          'no_existing_upb',
        ]),
      );
      expect(result.reasons).toHaveLength(5);
    });

    it('does not emit duplicate reasons', () => {
      const result = checkEligibility(eligibleApp({ state: 'NJ' }));
      const unique = new Set(result.reasons);
      expect(unique.size).toBe(result.reasons.length);
    });
  });
});
