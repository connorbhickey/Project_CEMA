import { describe, expect, it } from 'vitest';

import { createDealInputSchema } from './create-deal-schema.js';

describe('createDealInputSchema', () => {
  it('accepts a minimum Refi-CEMA input', () => {
    const result = createDealInputSchema.safeParse({
      cemaType: 'refi_cema',
      propertyType: 'one_family',
      streetAddress: '123 Main St',
      city: 'Brooklyn',
      county: 'Kings',
      zipCode: '11201',
      principal: '500000',
      program: 'conventional_fannie',
      upb: '420000',
    });
    expect(result.success).toBe(true);
  });

  it('rejects co-op property type', () => {
    const result = createDealInputSchema.safeParse({
      cemaType: 'refi_cema',
      propertyType: 'coop',
      streetAddress: '123 Main St',
      city: 'Brooklyn',
      county: 'Kings',
      zipCode: '11201',
      principal: '500000',
      program: 'conventional_fannie',
      upb: '420000',
    });
    expect(result.success).toBe(false);
  });

  it('rejects VA loan program', () => {
    const result = createDealInputSchema.safeParse({
      cemaType: 'refi_cema',
      propertyType: 'one_family',
      streetAddress: '123 Main St',
      city: 'Brooklyn',
      county: 'Kings',
      zipCode: '11201',
      principal: '500000',
      program: 'va',
      upb: '420000',
    });
    expect(result.success).toBe(false);
  });

  it('rejects FHA loan program (out of scope per spec §1)', () => {
    const result = createDealInputSchema.safeParse({
      cemaType: 'refi_cema',
      propertyType: 'one_family',
      streetAddress: '123 Main St',
      city: 'Brooklyn',
      county: 'Kings',
      zipCode: '11201',
      principal: '500000',
      program: 'fha',
      upb: '420000',
    });
    expect(result.success).toBe(false);
  });

  it('Purchase CEMA accepted (full Purchase flow ships in Phase 2.5)', () => {
    const result = createDealInputSchema.safeParse({
      cemaType: 'purchase_cema',
      propertyType: 'condo',
      streetAddress: '500 5th Ave',
      city: 'New York',
      county: 'New York',
      zipCode: '10110',
      principal: '900000',
      program: 'conventional_fannie',
      upb: '650000',
    });
    expect(result.success).toBe(true);
  });
});
