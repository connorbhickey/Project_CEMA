import { describe, expect, it } from 'vitest';

import { TcpaConsentMissingError, tcpaGuard } from './tcpa-guard';

const NOW = new Date('2026-01-15T10:00:00Z');

describe('tcpaGuard', () => {
  it('passes for a borrower with valid opt-in and timestamp', () => {
    expect(() =>
      tcpaGuard({ id: 'p1', role: 'borrower', tcpaOptIn: true, tcpaOptInAt: NOW }),
    ).not.toThrow();
  });

  it('throws TcpaConsentMissingError for a borrower with no opt-in', () => {
    expect(() =>
      tcpaGuard({ id: 'p1', role: 'borrower', tcpaOptIn: false, tcpaOptInAt: null }),
    ).toThrow(TcpaConsentMissingError);
  });

  it('throws for a borrower where tcpaOptIn=true but tcpaOptInAt is null', () => {
    // DB CHECK enforces this too, but app layer should catch it first
    expect(() =>
      tcpaGuard({ id: 'p1', role: 'borrower', tcpaOptIn: true, tcpaOptInAt: null }),
    ).toThrow(TcpaConsentMissingError);
  });

  it('throws for a co_borrower without opt-in', () => {
    expect(() =>
      tcpaGuard({ id: 'p2', role: 'co_borrower', tcpaOptIn: false, tcpaOptInAt: null }),
    ).toThrow(TcpaConsentMissingError);
  });

  it('passes for a co_borrower with valid opt-in', () => {
    expect(() =>
      tcpaGuard({ id: 'p2', role: 'co_borrower', tcpaOptIn: true, tcpaOptInAt: NOW }),
    ).not.toThrow();
  });

  it('passes for a non-borrower role without opt-in (B2B — TCPA not required)', () => {
    expect(() =>
      tcpaGuard({ id: 'p3', role: 'doc_custodian', tcpaOptIn: false, tcpaOptInAt: null }),
    ).not.toThrow();
  });

  it('passes for loan_officer without opt-in', () => {
    expect(() =>
      tcpaGuard({ id: 'p4', role: 'loan_officer', tcpaOptIn: false, tcpaOptInAt: null }),
    ).not.toThrow();
  });

  it('TcpaConsentMissingError carries the partyId', () => {
    let caught: unknown;
    try {
      tcpaGuard({ id: 'p-abc', role: 'borrower', tcpaOptIn: false, tcpaOptInAt: null });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TcpaConsentMissingError);
    expect((caught as TcpaConsentMissingError).partyId).toBe('p-abc');
  });
});
