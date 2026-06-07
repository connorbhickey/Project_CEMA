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
import { notifyInternal, notifyInternalDealCreated } from './notify-internal';

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
  it('split-audits (evaluated before, notified after) + sends for a notify-worthy status', async () => {
    await notifyInternal('deal-1', 'attorney_review', CTX);

    expect(sendInternalComm).toHaveBeenCalledTimes(1);
    expect(sendInternalComm).toHaveBeenCalledWith({
      dealId: 'deal-1',
      status: 'attorney_review',
      channel: 'pipeline',
      message: 'A deal has entered attorney review and is ready for an attorney to act.',
    });

    expect(withRls).toHaveBeenCalledWith('org-1', expect.any(Function));
    // Split audit: internal_comm.evaluated BEFORE the send, internal_comm.notified AFTER.
    expect(emitAuditEvent).toHaveBeenCalledTimes(2);
    const [, evaluated] = vi.mocked(emitAuditEvent).mock.calls[0]!;
    expect(evaluated).toMatchObject({
      organizationId: 'org-1',
      actorUserId: 'user-1',
      action: 'internal_comm.evaluated',
      entityType: 'deal',
      entityId: 'deal-1',
      metadata: { status: 'attorney_review', channel: 'pipeline' },
    });
    const [, notified] = vi.mocked(emitAuditEvent).mock.calls[1]!;
    expect(notified).toMatchObject({
      action: 'internal_comm.notified',
      entityId: 'deal-1',
      metadata: { status: 'attorney_review', channel: 'pipeline', accepted: true },
    });
  });

  it('does nothing for a routine status', async () => {
    await notifyInternal('deal-1', 'title_work', CTX);

    expect(sendInternalComm).not.toHaveBeenCalled();
    expect(emitAuditEvent).not.toHaveBeenCalled();
  });

  it('leaves an evaluated audit trail (no notified) and swallows a failing send', async () => {
    vi.mocked(sendInternalComm).mockRejectedValue(new Error('slack boom'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(notifyInternal('deal-1', 'exception', CTX)).resolves.toBeUndefined();

    // Durable trail survives the failure: evaluated written, notified never.
    expect(emitAuditEvent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(emitAuditEvent).mock.calls[0]![1]).toMatchObject({
      action: 'internal_comm.evaluated',
    });
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

describe('notifyInternalDealCreated', () => {
  it('always posts: split-audits (evaluated/notified) + sends a statusless deal-created packet', async () => {
    await notifyInternalDealCreated('deal-1', CTX);

    expect(sendInternalComm).toHaveBeenCalledTimes(1);
    expect(sendInternalComm).toHaveBeenCalledWith({
      dealId: 'deal-1',
      channel: 'pipeline',
      message: 'A new deal has been created and entered the pipeline.',
    });

    // Split audit: evaluated BEFORE, notified AFTER — both keyed by the trigger token.
    expect(emitAuditEvent).toHaveBeenCalledTimes(2);
    const [, evaluated] = vi.mocked(emitAuditEvent).mock.calls[0]!;
    expect(evaluated).toMatchObject({
      action: 'internal_comm.evaluated',
      entityId: 'deal-1',
      metadata: { trigger: 'deal_created', channel: 'pipeline' },
    });
    const [, notified] = vi.mocked(emitAuditEvent).mock.calls[1]!;
    expect(notified).toMatchObject({
      action: 'internal_comm.notified',
      metadata: { trigger: 'deal_created', accepted: true },
    });
  });

  it('is best-effort: a failed send is swallowed (never throws) + routed PII-safe', async () => {
    vi.mocked(sendInternalComm).mockRejectedValue(new Error('slack 500 for SSN 123-45-6789'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(notifyInternalDealCreated('deal-1', CTX)).resolves.toBeUndefined();

    const line = errSpy.mock.calls[0]?.[0] as string;
    expect(line).not.toMatch(/[\r\n]/);
    expect(line).not.toContain('123-45-6789');
    expect(line).toContain('***-**-6789');
    errSpy.mockRestore();
  });
});
