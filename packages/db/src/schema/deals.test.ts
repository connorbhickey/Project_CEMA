import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { deals, existingLoans, newLoans, properties } from './deals.js';

describe('deals schema', () => {
  it('deals scoped to organization with full lifecycle columns', () => {
    const cols = Object.keys(deals);
    expect(cols).toEqual(
      expect.arrayContaining([
        'id',
        'organizationId',
        'cemaType',
        'status',
        'propertyId',
        'newLoanId',
        'createdById',
        'notes',
        'metadata',
        'createdAt',
        'updatedAt',
        'targetCloseAt',
        'slaBreachAt',
        'completedAt',
      ]),
    );
  });

  it('property includes NYC borough and ACRIS hooks', () => {
    const cols = Object.keys(properties);
    expect(cols).toEqual(
      expect.arrayContaining([
        'id',
        'streetAddress',
        'unit',
        'city',
        'county',
        'zipCode',
        'propertyType',
        'block',
        'lot',
        'taxMapId',
        'acrisBbl',
        'createdAt',
        'updatedAt',
      ]),
    );
  });

  it('existing loans capture full prior-mortgage chain', () => {
    const cols = Object.keys(existingLoans);
    expect(cols).toEqual(
      expect.arrayContaining([
        'id',
        'dealId',
        'upb',
        'originalPrincipal',
        'noteDate',
        'maturityDate',
        'currentServicerId',
        'investor',
        'recordedReelPage',
        'recordedCrfn',
        'chainPosition',
        'createdAt',
        'updatedAt',
      ]),
    );
  });

  it('new loan captures the funding details', () => {
    const cols = Object.keys(newLoans);
    expect(cols).toEqual(
      expect.arrayContaining([
        'id',
        'organizationId',
        'principal',
        'rate',
        'termMonths',
        'program',
        'targetFundingDate',
        'createdAt',
        'updatedAt',
      ]),
    );
  });
});

describe('deals schema constraints', () => {
  it('new_loans has principal/term/rate CHECK constraints', () => {
    const config = getTableConfig(newLoans);
    const checkNames = config.checks.map((c) => c.name);
    expect(checkNames).toContain('new_loans_principal_positive');
    expect(checkNames).toContain('new_loans_term_months_positive');
    expect(checkNames).toContain('new_loans_rate_nonneg');
  });

  it('existing_loans has unique chain_position per deal + recording XOR', () => {
    const config = getTableConfig(existingLoans);
    // uniqueIndex() produces an Index (lives in config.indexes, not uniqueConstraints).
    const indexNames = config.indexes.map((i) => i.config.name);
    expect(indexNames).toContain('existing_loans_deal_chain_pos_idx');
    const checkNames = config.checks.map((c) => c.name);
    expect(checkNames).toContain('existing_loans_recording_xor');
  });

  it('deals enforces completedAt when status=completed', () => {
    const config = getTableConfig(deals);
    const checkNames = config.checks.map((c) => c.name);
    expect(checkNames).toContain('deals_completed_at_required');
  });

  it('new_loans is org-scoped', () => {
    const cols = Object.keys(newLoans);
    expect(cols).toContain('organizationId');
  });

  it('properties acris_bbl has format CHECK', () => {
    const config = getTableConfig(properties);
    const checkNames = config.checks.map((c) => c.name);
    expect(checkNames).toContain('properties_acris_bbl_format');
  });
});
