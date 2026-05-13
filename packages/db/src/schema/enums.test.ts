import { describe, expect, it } from 'vitest';

import {
  cemaTypeEnum,
  dealStatusEnum,
  documentKindEnum,
  documentStatusEnum,
  lenderSubtypeEnum,
  partyRoleEnum,
  propertyTypeEnum,
} from './enums.js';

describe('enums', () => {
  it('cema type covers refi and purchase', () => {
    expect(cemaTypeEnum.enumValues).toEqual(['refi_cema', 'purchase_cema']);
  });

  it('lender subtype includes all 4 types from the spec', () => {
    expect(lenderSubtypeEnum.enumValues).toEqual([
      'imb',
      'regional_bank',
      'community_bank_cu',
      'wholesale_broker',
    ]);
  });

  it('property type excludes co-op', () => {
    expect(propertyTypeEnum.enumValues).not.toContain('coop');
    expect(propertyTypeEnum.enumValues).toContain('one_family');
    expect(propertyTypeEnum.enumValues).toContain('condo');
  });

  it('deal status includes all lifecycle states', () => {
    expect(dealStatusEnum.enumValues).toEqual([
      'intake',
      'eligibility',
      'authorization',
      'collateral_chase',
      'title_work',
      'doc_prep',
      'attorney_review',
      'closing',
      'recording',
      'completed',
      'exception',
      'cancelled',
    ]);
  });

  it('document kind covers all CEMA legal doc types', () => {
    const required = [
      'note',
      'mortgage',
      'assignment',
      'allonge',
      'cema_3172',
      'exhibit_a',
      'exhibit_b',
      'exhibit_c',
      'exhibit_d',
      'consolidated_note',
      'gap_note',
      'gap_mortgage',
      'aff_255',
      'aff_275',
      'mt_15',
      'payoff_letter',
      'authorization',
      'title_commitment',
    ];
    for (const k of required) {
      expect(documentKindEnum.enumValues).toContain(k);
    }
  });

  it('party role covers all required CEMA roles', () => {
    expect(partyRoleEnum.enumValues).toEqual([
      'borrower',
      'co_borrower',
      'seller',
      'loan_officer',
      'processor',
      'closing_attorney',
      'title_agent',
      'seller_attorney',
      'doc_custodian',
    ]);
  });

  it('document status includes draft and approval gate', () => {
    expect(documentStatusEnum.enumValues).toEqual([
      'draft',
      'attorney_review',
      'approved',
      'executed',
      'recorded',
      'rejected',
    ]);
  });
});
