import { describe, expect, it } from 'vitest';

import { describeAuditEvent } from './describe-audit-event';

describe('describeAuditEvent', () => {
  it('maps known agent actions to human labels', () => {
    expect(describeAuditEvent('docgen.generated', { count: 8 }).label).toBe(
      'CEMA documents generated',
    );
    expect(describeAuditEvent('borrower_comm.notified', {}).label).toBe('Borrower emailed');
    expect(describeAuditEvent('chain.analyzed', {}).label).toBe('Chain-of-title analyzed');
  });

  it('builds a PII-safe detail from whitelisted fields only', () => {
    expect(
      describeAuditEvent('deal.status_changed', { from: 'doc_prep', to: 'attorney_review' }).detail,
    ).toBe('doc_prep → attorney_review');
    expect(describeAuditEvent('docgen.generated', { count: 8 }).detail).toBe('8 documents');
    expect(describeAuditEvent('internal_comm.notified', { channel: 'pipeline' }).detail).toBe(
      'via pipeline',
    );
  });

  it('never renders non-whitelisted metadata (defense in depth)', () => {
    const d = describeAuditEvent('deal.status_changed', {
      from: 'doc_prep',
      to: 'attorney_review',
      borrowerName: 'Jane Doe',
    });
    expect(d.detail).toBe('doc_prep → attorney_review');
    expect(d.detail).not.toContain('Jane Doe');
  });

  it('humanizes unknown actions with no detail', () => {
    const d = describeAuditEvent('some.future_action', { x: 1 });
    expect(d.label).toBe('Some future action');
    expect(d.detail).toBeNull();
  });

  it('returns a null detail when whitelisted fields are absent/wrong-typed', () => {
    expect(describeAuditEvent('deal.status_changed', {}).detail).toBeNull();
    expect(describeAuditEvent('docgen.generated', { count: 'eight' }).detail).toBeNull();
  });

  it('labels the recording agent actions', () => {
    expect(describeAuditEvent('recording.evaluated', {}).label).toBe('Recording prep evaluated');
    expect(describeAuditEvent('recording.prepared', {}).label).toBe('Recording package prepared');
    expect(describeAuditEvent('recording.completed', {}).label).toBe('Recording completed');
    expect(describeAuditEvent('recording.rejected', {}).label).toBe('Recording rejected');
  });

  it('builds PII-safe recording details from whitelisted fields', () => {
    expect(describeAuditEvent('recording.prepared', { count: 1 }).detail).toBe('1 cover sheets');
    expect(describeAuditEvent('recording.completed', { venue: 'acris' }).detail).toBe('via acris');
    expect(
      describeAuditEvent('recording.rejected', { reason: 'bad_legal_description' }).detail,
    ).toBe('reason: bad_legal_description');
  });

  it('labels the party/loan editor actions + PII-safe role/chain-position detail', () => {
    // party.* carry { partyId, role }; loan.* carry { loanId, chainPosition }.
    const party = describeAuditEvent('party.added', {
      partyId: 'p-1',
      role: 'seller_attorney',
      fullName: 'Jane Doe',
    });
    expect(party.label).toBe('Party added');
    expect(party.detail).toBe('Seller attorney'); // role humanized
    expect(party.detail).not.toContain('Jane Doe'); // name never rendered
    expect(party.detail).not.toContain('p-1'); // id never rendered

    const loan = describeAuditEvent('loan.updated', {
      loanId: 'l-1',
      chainPosition: 2,
      upb: '420000',
    });
    expect(loan.label).toBe('Existing loan updated');
    expect(loan.detail).toBe('chain position 2');
    expect(loan.detail).not.toContain('420000'); // the UPB dollar figure never rendered
  });
});
