import { describe, expect, it } from 'vitest';

import { toOrgActivityItem, type OrgAgentActivityRow } from './org-activity-item';

const ROW: OrgAgentActivityRow = {
  id: 'ae-1',
  action: 'docgen.generated',
  occurredAt: new Date('2026-06-01T10:00:00Z'),
  metadata: { count: 8 },
  dealId: 'deal-1',
  cemaType: 'refi_cema',
  status: 'doc_prep',
  streetAddress: '123 Main St',
  city: 'Brooklyn',
};

describe('toOrgActivityItem', () => {
  it('delegates label/detail to describeAuditEvent', () => {
    const item = toOrgActivityItem(ROW);
    expect(item.label).toBe('CEMA documents generated');
    expect(item.detail).toBe('8 documents');
    expect(item.dealId).toBe('deal-1');
    expect(item.occurredAt).toEqual(ROW.occurredAt);
  });

  it('builds a PII-safe context (cemaType · status · address)', () => {
    expect(toOrgActivityItem(ROW).context).toBe('Refi CEMA · doc_prep · 123 Main St, Brooklyn');
  });

  it('omits the address segment when absent', () => {
    const item = toOrgActivityItem({ ...ROW, streetAddress: null, city: null });
    expect(item.context).toBe('Refi CEMA · doc_prep');
  });

  it('maps the purchase_cema label', () => {
    expect(toOrgActivityItem({ ...ROW, cemaType: 'purchase_cema' }).context).toContain(
      'Purchase CEMA',
    );
  });

  it('context + detail never contain borrower metadata (PII-safe)', () => {
    const item = toOrgActivityItem({ ...ROW, metadata: { count: 8, borrowerName: 'Jane Doe' } });
    expect(item.context).not.toContain('Jane Doe');
    expect(item.detail).not.toContain('Jane Doe');
  });
});
