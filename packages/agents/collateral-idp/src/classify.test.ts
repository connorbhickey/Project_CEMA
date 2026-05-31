import { describe, expect, it } from 'vitest';

import { classify, requiresAttorneyReview } from './classify';
import type { RawExtraction } from './types';

function raw(documentType: string): RawExtraction {
  return { text: null, fields: { documentType }, confidence: 0.9 };
}

describe('requiresAttorneyReview', () => {
  it('is true for a gate-required kind', () => {
    expect(requiresAttorneyReview('aom')).toBe(true);
  });

  it('is false for a non-gate kind', () => {
    expect(requiresAttorneyReview('note')).toBe(false);
  });
});

describe('classify', () => {
  it('maps "Assignment of Mortgage" to aom (gated)', () => {
    const out = classify(raw('Assignment of Mortgage'));
    expect(out.kind).toBe('aom');
    expect(out.attorneyReviewRequired).toBe(true);
  });

  it('maps "Consolidation, Extension and Modification Agreement" to cema_3172 before plain "agreement"', () => {
    const out = classify(raw('Consolidation, Extension and Modification Agreement'));
    expect(out.kind).toBe('cema_3172');
    expect(out.attorneyReviewRequired).toBe(true);
  });

  it('maps "Allonge to Note" to allonge, not note (specific wins)', () => {
    const out = classify(raw('Allonge to Note'));
    expect(out.kind).toBe('allonge');
  });

  it('maps "Section 255 Affidavit" to aff_255', () => {
    const out = classify(raw('Section 255 Affidavit')).kind;
    expect(out).toBe('aff_255');
  });

  it('maps a plain mortgage to mortgage (non-gated)', () => {
    const out = classify(raw('Mortgage'));
    expect(out.kind).toBe('mortgage');
    expect(out.attorneyReviewRequired).toBe(false);
  });

  it('falls back to other when no signal matches', () => {
    const out = classify(raw('Quarterly Escrow Statement'));
    expect(out.kind).toBe('other');
    expect(out.attorneyReviewRequired).toBe(false);
  });

  it('reads the raw text when no documentType field is present', () => {
    const out = classify({ text: 'PROMISSORY NOTE', fields: {}, confidence: 0.8 });
    expect(out.kind).toBe('note');
  });

  it('passes the raw confidence through', () => {
    expect(classify(raw('Mortgage')).confidence).toBe(0.9);
  });
});
