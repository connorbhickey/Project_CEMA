import { describe, expect, it } from 'vitest';

import { isPurchaseMissingSeller } from './purchase-seller-signal';

describe('isPurchaseMissingSeller', () => {
  it('flags a Purchase CEMA in an active processing stage with no seller', () => {
    expect(isPurchaseMissingSeller('purchase_cema', 'collateral_chase', false)).toBe(true);
    expect(isPurchaseMissingSeller('purchase_cema', 'title_work', false)).toBe(true);
    expect(isPurchaseMissingSeller('purchase_cema', 'doc_prep', false)).toBe(true);
    expect(isPurchaseMissingSeller('purchase_cema', 'recording', false)).toBe(true);
  });

  it('does not flag when the seller party is present', () => {
    expect(isPurchaseMissingSeller('purchase_cema', 'title_work', true)).toBe(false);
  });

  it('does not flag a Refi CEMA (no seller is expected)', () => {
    expect(isPurchaseMissingSeller('refi_cema', 'title_work', false)).toBe(false);
  });

  it('does not flag early stages (seller still being added) or terminal stages', () => {
    for (const status of [
      'intake',
      'eligibility',
      'authorization',
      'completed',
      'cancelled',
      'exception',
    ]) {
      expect(isPurchaseMissingSeller('purchase_cema', status, false)).toBe(false);
    }
  });
});
