import { describe, expect, it, vi } from 'vitest';

import { runOutreach } from './orchestrator';
import type {
  ChannelSendResult,
  OutreachAuditEvent,
  OutreachContext,
  OutreachDeps,
  OutreachPacket,
  OutreachTouchRecord,
} from './types';

const DEAL = '11111111-1111-1111-1111-111111111111';
const ORG = '22222222-2222-2222-2222-222222222222';
const TRIGGER = new Date('2026-06-01T14:00:00.000Z'); // Monday

function buildContext(overrides: Partial<OutreachContext> = {}): OutreachContext {
  return {
    dealId: DEAL,
    organizationId: ORG,
    servicerName: 'Acme Servicing',
    departmentEmail: 'cema@acme.example',
    acceptedSubmissionMethods: ['email'],
    triggeredAt: TRIGGER,
    touchesSent: 0,
    response: null,
    ...overrides,
  };
}

function buildDeps(context: OutreachContext, opts: { now?: Date; sendAccepted?: boolean } = {}) {
  const events: string[] = [];
  const sent: OutreachPacket[] = [];
  const recorded: number[] = [];
  const deps: OutreachDeps = {
    channel: {
      send: vi.fn((packet: OutreachPacket): Promise<ChannelSendResult> => {
        events.push('send');
        sent.push(packet);
        return Promise.resolve({
          accepted: opts.sendAccepted ?? true,
          channelMessageId: 'fixture:msg',
        });
      }),
    },
    loadContext: vi.fn((): Promise<OutreachContext> => Promise.resolve(context)),
    recordTouch: vi.fn((record: OutreachTouchRecord): Promise<void> => {
      events.push('record');
      recorded.push(record.touchNumber);
      return Promise.resolve();
    }),
    emitAudit: vi.fn((event: OutreachAuditEvent): Promise<void> => {
      events.push(`audit:${event.action}`);
      return Promise.resolve();
    }),
    now: () => opts.now ?? TRIGGER,
  };
  return { deps, events, sent, recorded };
}

describe('runOutreach', () => {
  it('sends touch 1 on a due first run: plans BEFORE sending, records the touch', async () => {
    const ctx = buildContext({ touchesSent: 0 });
    const { deps, events, sent, recorded } = buildDeps(ctx);

    const result = await runOutreach(DEAL, deps);

    expect(result).toEqual({
      dealId: DEAL,
      action: { kind: 'send', touchNumber: 1 },
      touchSent: 1,
    });
    // Split audit: planned emitted before the send.
    expect(events).toEqual(['audit:outreach.planned', 'send', 'record']);
    expect(sent[0]).toMatchObject({
      channel: 'email',
      to: 'cema@acme.example',
      touchNumber: 1,
      dealId: DEAL,
    });
    expect(recorded).toEqual([1]);
  });

  it('waits (no send/record) when the next touch is in the future', async () => {
    const ctx = buildContext({ touchesSent: 1 }); // touch 2 due 2026-06-08
    const { deps, events, sent } = buildDeps(ctx, { now: TRIGGER });

    const result = await runOutreach(DEAL, deps);

    expect(result.action.kind).toBe('wait');
    expect(result.touchSent).toBeNull();
    expect(events).toEqual(['audit:outreach.planned']); // planned only, no send
    expect(sent).toHaveLength(0);
  });

  it('stops (no send) on an actionable servicer response', async () => {
    const ctx = buildContext({ touchesSent: 1, response: { kind: 'delivered' } });
    const { deps, events } = buildDeps(ctx);

    const result = await runOutreach(DEAL, deps);

    expect(result.action).toEqual({ kind: 'stop', reason: 'responded' });
    expect(events).toEqual(['audit:outreach.planned']);
  });

  it('returns unsupported_channel (no send) when the resolved channel is not email', async () => {
    const ctx = buildContext({ acceptedSubmissionMethods: ['portal'] });
    const { deps, events, sent } = buildDeps(ctx);

    const result = await runOutreach(DEAL, deps);

    expect(result.action).toEqual({ kind: 'unsupported_channel', method: 'portal' });
    expect(events).toEqual(['audit:outreach.planned']);
    expect(sent).toHaveLength(0);
  });

  it('returns unsupported_channel when email is accepted but no department address is on file', async () => {
    const ctx = buildContext({ departmentEmail: null });
    const { deps, sent } = buildDeps(ctx);

    const result = await runOutreach(DEAL, deps);

    expect(result.action).toEqual({ kind: 'unsupported_channel', method: 'email' });
    expect(sent).toHaveLength(0);
  });

  it('does NOT record a touch when the channel rejects the send', async () => {
    const ctx = buildContext({ touchesSent: 0 });
    const { deps, events, recorded } = buildDeps(ctx, { sendAccepted: false });

    const result = await runOutreach(DEAL, deps);

    expect(result.touchSent).toBeNull();
    expect(recorded).toEqual([]);
    expect(events).toEqual(['audit:outreach.planned', 'send']); // sent attempted, not recorded
  });
});
