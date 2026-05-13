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
