import { describe, expect, it } from 'vitest';

import { planDocuments } from './plan';
import type { DealDocGenInput } from './types';

const BASE: DealDocGenInput = {
  dealId: 'deal-1',
  cemaType: 'refi_cema',
  newPrincipal: 500000,
  existingLoans: [{ id: 'loan-1', upb: 300000 }],
  county: 'Kings',
  borrowerNames: ['Jane Doe'],
};

const kinds = (i: DealDocGenInput) =>
  planDocuments(i)
    .documents.map((d) => d.kind)
    .sort();

describe('planDocuments', () => {
  it('plans always-docs + gap docs + one aom per loan for a clean refi with new money', () => {
    const plan = planDocuments(BASE);
    expect(plan.consistency.ok).toBe(true);
    expect(plan.gap).toBe(200000);
    expect(kinds(BASE)).toEqual(
      [
        'aff_255',
        'aff_275',
        'aom',
        'cema_3172',
        'consolidated_note',
        'gap_mortgage',
        'gap_note',
        'mt_15',
      ].sort(),
    );
  });

  it('omits gap_note/gap_mortgage when gap is zero (no new money)', () => {
    const plan = planDocuments({ ...BASE, newPrincipal: 300000 });
    expect(plan.gap).toBe(0);
    expect(plan.documents.some((d) => d.kind === 'gap_note')).toBe(false);
    expect(plan.documents.some((d) => d.kind === 'gap_mortgage')).toBe(false);
  });

  it('emits one aom per existing loan', () => {
    const plan = planDocuments({
      ...BASE,
      newPrincipal: 900000,
      existingLoans: [
        { id: 'l1', upb: 100000 },
        { id: 'l2', upb: 200000 },
      ],
    });
    expect(plan.documents.filter((d) => d.kind === 'aom')).toHaveLength(2);
  });

  it('every generated document is attorney-review-required (hard rule #2)', () => {
    for (const d of planDocuments(BASE).documents) {
      expect(d.attorneyReviewRequired).toBe(true);
    }
  });

  it('flags numbers_do_not_tie + plans nothing when UPB exceeds the new loan', () => {
    const plan = planDocuments({
      ...BASE,
      newPrincipal: 200000,
      existingLoans: [{ id: 'l', upb: 300000 }],
    });
    expect(plan.consistency.ok).toBe(false);
    expect(plan.consistency.issues).toContain('numbers_do_not_tie');
    expect(plan.documents).toEqual([]);
  });

  it('flags non-refi / no-loans / non-positive-principal and plans nothing', () => {
    expect(planDocuments({ ...BASE, cemaType: 'purchase_cema' }).consistency.issues).toContain(
      'not_refi_cema',
    );
    expect(planDocuments({ ...BASE, existingLoans: [] }).consistency.issues).toContain(
      'no_existing_loans',
    );
    expect(planDocuments({ ...BASE, newPrincipal: 0 }).consistency.issues).toContain(
      'new_principal_not_positive',
    );
    expect(planDocuments({ ...BASE, cemaType: 'purchase_cema' }).documents).toEqual([]);
  });

  it('titles are static (never leak the borrower name or amounts); issues are PII-free tokens', () => {
    // Titles may carry public form numbers (MT-15, Form 3172, §255/§275) — those
    // are not PII. What matters is that the static titles never interpolate deal
    // data, and that consistency issues are digit-free snake_case tokens.
    const plan = planDocuments(BASE);
    for (const d of plan.documents) {
      expect(d.title).not.toContain('Jane Doe');
      expect(d.title).not.toContain('500000');
      expect(d.title).not.toContain('300000');
    }
    const bad = planDocuments({ ...BASE, newPrincipal: 1, existingLoans: [{ id: 'l', upb: 9 }] });
    for (const issue of bad.consistency.issues) expect(issue).not.toMatch(/\d/);
  });
});
