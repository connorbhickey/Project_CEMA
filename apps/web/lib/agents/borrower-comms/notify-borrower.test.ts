import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./parties', () => ({ loadBorrowerParties: vi.fn() }));
vi.mock('./channel', () => ({ sendBorrowerComm: vi.fn() }));

// emitAuditEvent mocked (no DB); redactPii stays REAL so the PII/log-injection
// assertions exercise the actual sanitizer.
vi.mock('@cema/compliance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@cema/compliance')>();
  return { ...actual, emitAuditEvent: vi.fn() };
});

vi.mock('../../with-rls', () => ({
  withRls: vi.fn((_orgId: string, cb: (tx: unknown) => unknown) => cb({})),
}));

import { emitAuditEvent } from '@cema/compliance';

import { withRls } from '../../with-rls';

import { sendBorrowerComm } from './channel';
import { notifyBorrower } from './notify-borrower';
import { loadBorrowerParties } from './parties';

const CTX = { organizationId: 'org-1', actorUserId: 'user-1' };

beforeEach(() => {
  vi.mocked(loadBorrowerParties).mockResolvedValue([{ id: 'party-1', email: 'b1@example.com' }]);
  vi.mocked(sendBorrowerComm).mockResolvedValue({ accepted: true, channelMessageId: 'fixture:x' });
  vi.mocked(emitAuditEvent).mockResolvedValue(undefined);
  vi.mocked(withRls).mockImplementation((_orgId, cb) => cb({} as never));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('notifyBorrower', () => {
  it('split-audits + emails for a borrower touchpoint status', async () => {
    await notifyBorrower('deal-1', 'closing', CTX);

    expect(sendBorrowerComm).toHaveBeenCalledTimes(1);
    const packet = vi.mocked(sendBorrowerComm).mock.calls[0]![0];
    expect(packet).toMatchObject({
      dealId: 'deal-1',
      partyId: 'party-1',
      status: 'closing',
      channel: 'email',
      to: 'b1@example.com',
    });

    // Split audit: evaluated before, notified after -- per party.
    expect(emitAuditEvent).toHaveBeenCalledTimes(2);
    const [, evaluated] = vi.mocked(emitAuditEvent).mock.calls[0]!;
    expect(evaluated).toMatchObject({
      action: 'borrower_comm.evaluated',
      entityType: 'deal',
      entityId: 'deal-1',
      metadata: { status: 'closing', channel: 'email', partyId: 'party-1' },
    });
    const [, notified] = vi.mocked(emitAuditEvent).mock.calls[1]!;
    expect(notified).toMatchObject({ action: 'borrower_comm.notified', entityId: 'deal-1' });
  });

  it('the audit metadata never contains the borrower email (hard rule #3)', async () => {
    await notifyBorrower('deal-1', 'closing', CTX);
    for (const call of vi.mocked(emitAuditEvent).mock.calls) {
      expect(JSON.stringify(call[1].metadata)).not.toContain('b1@example.com');
    }
  });

  it('fans out to every borrower party (co-borrowers included)', async () => {
    vi.mocked(loadBorrowerParties).mockResolvedValue([
      { id: 'party-1', email: 'b1@example.com' },
      { id: 'party-2', email: 'b2@example.com' },
    ]);

    await notifyBorrower('deal-1', 'completed', CTX);

    expect(sendBorrowerComm).toHaveBeenCalledTimes(2);
    expect(emitAuditEvent).toHaveBeenCalledTimes(4); // 2 parties x (evaluated + notified)
  });

  it('does nothing for a routine status', async () => {
    await notifyBorrower('deal-1', 'title_work', CTX);
    expect(loadBorrowerParties).not.toHaveBeenCalled();
    expect(sendBorrowerComm).not.toHaveBeenCalled();
    expect(emitAuditEvent).not.toHaveBeenCalled();
  });

  it('does nothing when the deal has no borrower-email party', async () => {
    vi.mocked(loadBorrowerParties).mockResolvedValue([]);
    await notifyBorrower('deal-1', 'closing', CTX);
    expect(sendBorrowerComm).not.toHaveBeenCalled();
    expect(emitAuditEvent).not.toHaveBeenCalled();
  });

  it('swallows a failing send (leaves the evaluated trail) without blocking other parties', async () => {
    vi.mocked(loadBorrowerParties).mockResolvedValue([
      { id: 'party-1', email: 'b1@example.com' },
      { id: 'party-2', email: 'b2@example.com' },
    ]);
    vi.mocked(sendBorrowerComm)
      .mockRejectedValueOnce(new Error('resend boom for SSN 123-45-6789'))
      .mockResolvedValueOnce({ accepted: true });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(notifyBorrower('deal-1', 'closing', CTX)).resolves.toBeUndefined();

    // party-1 failed (evaluated only), party-2 succeeded (evaluated + notified) = 3 audits.
    expect(emitAuditEvent).toHaveBeenCalledTimes(3);
    expect(sendBorrowerComm).toHaveBeenCalledTimes(2); // the failure did not stop party-2
    const line = errSpy.mock.calls[0]?.[0] as string;
    expect(line).not.toMatch(/[\r\n]/);
    expect(line).not.toContain('123-45-6789');
    expect(line).toContain('***-**-6789');

    errSpy.mockRestore();
  });
});
