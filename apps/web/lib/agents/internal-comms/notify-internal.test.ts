import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The channel send is a module-level function mocked to a spy (mirrors how
// on-deal-status-changed.test mocks the agent entry points -- functions, not
// object methods, so no unbound-method); the pure notificationForStatus runs real.
vi.mock('./channel', () => ({
  sendInternalComm: vi.fn(),
}));

// emitAuditEvent mocked (no DB); redactPii stays REAL so the PII/log-injection
// assertions exercise the actual sanitizer.
vi.mock('@cema/compliance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@cema/compliance')>();
  return { ...actual, emitAuditEvent: vi.fn() };
});

// withRls runs its callback with a throwaway tx (emitAuditEvent is mocked).
vi.mock('../../with-rls', () => ({
  withRls: vi.fn((_orgId: string, cb: (tx: unknown) => unknown) => cb({})),
}));

import { emitAuditEvent } from '@cema/compliance';

import { withRls } from '../../with-rls';

import { sendInternalComm } from './channel';
import { notifyInternal } from './notify-internal';

const CTX = { organizationId: 'org-1', actorUserId: 'user-1' };

beforeEach(() => {
  vi.mocked(sendInternalComm).mockResolvedValue({
    accepted: true,
    channelMessageId: 'fixture:deal-1:attorney_review',
  });
  vi.mocked(emitAuditEvent).mockResolvedValue(undefined);
  vi.mocked(withRls).mockImplementation((_orgId, cb) => cb({} as never));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('notifyInternal', () => {
  it('sends a notification + records the audit for a notify-worthy status', async () => {
    await notifyInternal('deal-1', 'attorney_review', CTX);

    expect(sendInternalComm).toHaveBeenCalledTimes(1);
    expect(sendInternalComm).toHaveBeenCalledWith({
      dealId: 'deal-1',
      status: 'attorney_review',
      channel: 'pipeline',
      message: 'A deal has entered attorney review and is ready for an attorney to act.',
    });

    expect(withRls).toHaveBeenCalledWith('org-1', expect.any(Function));
    expect(emitAuditEvent).toHaveBeenCalledTimes(1);
    const [, event] = vi.mocked(emitAuditEvent).mock.calls[0]!;
    expect(event).toMatchObject({
      organizationId: 'org-1',
      actorUserId: 'user-1',
      action: 'internal_comm.notified',
      entityType: 'deal',
      entityId: 'deal-1',
      metadata: { status: 'attorney_review', channel: 'pipeline', accepted: true },
    });
  });

  it('does nothing for a routine status', async () => {
    await notifyInternal('deal-1', 'title_work', CTX);

    expect(sendInternalComm).not.toHaveBeenCalled();
    expect(emitAuditEvent).not.toHaveBeenCalled();
  });

  it('swallows a failing send so the status write is never blocked', async () => {
    vi.mocked(sendInternalComm).mockRejectedValue(new Error('slack boom'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(notifyInternal('deal-1', 'exception', CTX)).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalledTimes(1);

    errSpy.mockRestore();
  });

  it('emits a single-line, PII-redacted log entry on hostile dealId/error input', async () => {
    vi.mocked(sendInternalComm).mockRejectedValue(
      new Error('boom for SSN 123-45-6789\nFAKE forged log line'),
    );
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(notifyInternal('deal-1\nINJECTED', 'exception', CTX)).resolves.toBeUndefined();

    const line = errSpy.mock.calls[0]?.[0] as string;
    expect(line).not.toMatch(/[\r\n]/); // log-injection neutralized
    expect(line).not.toContain('123-45-6789'); // raw SSN never logged
    expect(line).toContain('***-**-6789'); // masked instead

    errSpy.mockRestore();
  });
});
