import { describe, expect, it, vi } from 'vitest';

// Mock @cema/db so that client.ts never runs (it requires DATABASE_URL at import
// time). The audit-log emitter only needs the `auditEvents` table reference to
// pass to db.insert(); the fakeDb mock below intercepts the actual call.
vi.mock('@cema/db', () => ({
  auditEvents: Symbol('auditEvents'),
}));

import { emitAuditEvent } from './audit-log';

describe('audit log', () => {
  it('emit creates an audit row with required fields', async () => {
    const insertSpy = vi.fn().mockResolvedValue({ rowCount: 1 });
    const fakeDb = {
      insert: () => ({ values: insertSpy }),
    };

    await emitAuditEvent(fakeDb as never, {
      organizationId: '00000000-0000-0000-0000-000000000001',
      actorUserId: '00000000-0000-0000-0000-000000000002',
      action: 'deal.created',
      entityType: 'deal',
      entityId: '00000000-0000-0000-0000-000000000003',
      metadata: { foo: 'bar' },
    });

    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: '00000000-0000-0000-0000-000000000001',
        action: 'deal.created',
        entityType: 'deal',
      }),
    );
  });

  it('metadata is PII-redacted before insertion', async () => {
    const insertSpy = vi.fn().mockResolvedValue({ rowCount: 1 });
    const fakeDb = { insert: () => ({ values: insertSpy }) };

    await emitAuditEvent(fakeDb as never, {
      organizationId: '00000000-0000-0000-0000-000000000001',
      action: 'borrower.updated',
      entityType: 'borrower',
      entityId: '00000000-0000-0000-0000-000000000004',
      metadata: { ssn: '123-45-6789' },
    });

    const args = insertSpy.mock.calls[0]![0]! as { metadata: { ssn: string } };
    expect(args.metadata.ssn).toBe('***-**-6789');
  });
});
