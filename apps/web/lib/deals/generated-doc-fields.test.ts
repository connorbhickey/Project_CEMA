import { describe, expect, it } from 'vitest';

import { generatedDocFields } from './generated-doc-fields';

describe('generatedDocFields', () => {
  it('maps a Doc-Gen field-map to labelled amounts, excluding ids', () => {
    expect(
      generatedDocFields({
        dealId: 'deal-1',
        county: 'Queens',
        newPrincipal: 500000,
        totalUpb: 300000,
        gap: 200000,
      }),
    ).toEqual([
      { label: 'County', value: 'Queens' },
      { label: 'New Principal', value: '500000' },
      { label: 'Total Upb', value: '300000' },
      { label: 'Gap', value: '200000' },
    ]);
  });

  it('excludes existingLoanId and renders the UPB for an AOM field-map', () => {
    expect(generatedDocFields({ dealId: 'd', existingLoanId: 'l1', upb: 150000 })).toEqual([
      { label: 'Upb', value: '150000' },
    ]);
  });

  it('returns null for an empty map or one with only ids', () => {
    expect(generatedDocFields({})).toBeNull();
    expect(generatedDocFields({ dealId: 'd', existingLoanId: 'l' })).toBeNull();
  });

  it('skips non-scalar values', () => {
    expect(generatedDocFields({ gap: 100, nested: { x: 1 }, list: [1, 2] })).toEqual([
      { label: 'Gap', value: '100' },
    ]);
  });

  it('is defensive against non-object input', () => {
    expect(generatedDocFields(null)).toBeNull();
    expect(generatedDocFields('x')).toBeNull();
    expect(generatedDocFields(undefined)).toBeNull();
  });
});
