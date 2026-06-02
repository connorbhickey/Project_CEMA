import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the two agent entry points the dispatcher fans out to. The pure mapping
// (triggerForStatus) is NOT mocked — the real status->trigger decision runs.
// ---------------------------------------------------------------------------

vi.mock('./collateral-pipeline', () => ({
  runCollateralPipeline: vi.fn(),
}));

vi.mock('./servicer-outreach/run-outreach-action', () => ({
  runOutreachFromDeal: vi.fn(),
}));

vi.mock('./doc-gen/run-doc-gen', () => ({
  runDocGen: vi.fn(),
}));

// emitAuditEvent is mocked (no DB); redactPii stays REAL so the PII/log-injection
// assertions below exercise the actual sanitizer.
vi.mock('@cema/compliance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@cema/compliance')>();
  return { ...actual, emitAuditEvent: vi.fn() };
});

// withRls just runs its callback with a throwaway tx — emitAuditEvent is mocked,
// so the tx is never really used.
vi.mock('../with-rls', () => ({
  withRls: vi.fn((_orgId: string, cb: (tx: unknown) => unknown) => cb({})),
}));

import { emitAuditEvent } from '@cema/compliance';

import { withRls } from '../with-rls';

import { runCollateralPipeline } from './collateral-pipeline';
import { runDocGen } from './doc-gen/run-doc-gen';
import { onDealStatusChanged } from './on-deal-status-changed';
import { runOutreachFromDeal } from './servicer-outreach/run-outreach-action';

const CTX = { organizationId: 'org-1', actorUserId: 'user-1' };

beforeEach(() => {
  // The dispatcher discards each agent's return value, so the resolved shape is
  // irrelevant — only that the call was attempted.
  vi.mocked(runCollateralPipeline).mockResolvedValue(undefined as never);
  vi.mocked(runOutreachFromDeal).mockResolvedValue(undefined as never);
  vi.mocked(runDocGen).mockResolvedValue(undefined);
  vi.mocked(emitAuditEvent).mockResolvedValue(undefined);
  vi.mocked(withRls).mockImplementation((_orgId, cb) => cb({} as never));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('onDealStatusChanged', () => {
  it("runs the collateral pipeline when a deal enters 'title_work'", async () => {
    await onDealStatusChanged('deal-1', 'title_work', CTX);

    expect(runCollateralPipeline).toHaveBeenCalledWith('deal-1');
    expect(runOutreachFromDeal).not.toHaveBeenCalled();
  });

  it("runs the outreach agent when a deal enters 'collateral_chase'", async () => {
    await onDealStatusChanged('deal-1', 'collateral_chase', CTX);

    expect(runOutreachFromDeal).toHaveBeenCalledWith('deal-1');
    expect(runCollateralPipeline).not.toHaveBeenCalled();
  });

  it("runs the doc-gen agent when a deal enters 'doc_prep'", async () => {
    await onDealStatusChanged('deal-1', 'doc_prep', CTX);

    expect(runDocGen).toHaveBeenCalledWith('deal-1');
    expect(runCollateralPipeline).not.toHaveBeenCalled();
    expect(runOutreachFromDeal).not.toHaveBeenCalled();
  });

  it('does nothing for a status with no wired agent', async () => {
    await onDealStatusChanged('deal-1', 'eligibility', CTX);

    expect(runCollateralPipeline).not.toHaveBeenCalled();
    expect(runOutreachFromDeal).not.toHaveBeenCalled();
    expect(runDocGen).not.toHaveBeenCalled();
  });

  it('does not record a dispatch-failure audit on the happy path', async () => {
    await onDealStatusChanged('deal-1', 'title_work', CTX);
    expect(emitAuditEvent).not.toHaveBeenCalled();
  });

  it('swallows a failing agent run so the status write is never blocked', async () => {
    vi.mocked(runCollateralPipeline).mockRejectedValue(new Error('pipeline boom'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(onDealStatusChanged('deal-1', 'title_work', CTX)).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalledTimes(1);

    errSpy.mockRestore();
  });

  it('records a PII-safe deal.agent_dispatch_failed audit when an agent run fails', async () => {
    vi.mocked(runCollateralPipeline).mockRejectedValue(
      new Error('pipeline boom for SSN 123-45-6789'),
    );
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(onDealStatusChanged('deal-1', 'title_work', CTX)).resolves.toBeUndefined();

    expect(emitAuditEvent).toHaveBeenCalledTimes(1);
    const [, event] = vi.mocked(emitAuditEvent).mock.calls[0]!;
    expect(event).toMatchObject({
      organizationId: 'org-1',
      actorUserId: 'user-1',
      action: 'deal.agent_dispatch_failed',
      entityType: 'deal',
      entityId: 'deal-1',
      metadata: { status: 'title_work', trigger: 'collateral_pipeline' },
    });
    // The audit must never carry the error message (no error string / no PII):
    // no metadata value contains the raw SSN or the boom text.
    const metaStr = JSON.stringify(event.metadata);
    expect(metaStr).not.toContain('123-45-6789');
    expect(metaStr).not.toContain('boom');

    errSpy.mockRestore();
  });

  it('records the dispatch-failure audit under the org RLS context', async () => {
    vi.mocked(runOutreachFromDeal).mockRejectedValue(new Error('outreach boom'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await onDealStatusChanged('deal-2', 'collateral_chase', CTX);

    expect(withRls).toHaveBeenCalledWith('org-1', expect.any(Function));
    const [, event] = vi.mocked(emitAuditEvent).mock.calls[0]!;
    expect(event).toMatchObject({
      action: 'deal.agent_dispatch_failed',
      entityId: 'deal-2',
      metadata: { status: 'collateral_chase', trigger: 'outreach' },
    });

    errSpy.mockRestore();
  });

  it('never lets a FAILING failure-audit escape the dispatcher', async () => {
    // The same outage that failed the agent can also fail the audit insert. The
    // dispatcher must still resolve (the status write already committed).
    vi.mocked(runCollateralPipeline).mockRejectedValue(new Error('pipeline boom'));
    vi.mocked(emitAuditEvent).mockRejectedValue(new Error('db is down'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(onDealStatusChanged('deal-1', 'title_work', CTX)).resolves.toBeUndefined();

    // Two redacted lines: the agent failure, then the audit-record failure.
    expect(errSpy).toHaveBeenCalledTimes(2);
    for (const call of errSpy.mock.calls) {
      expect(call[0] as string).not.toMatch(/[\r\n]/);
    }

    errSpy.mockRestore();
  });

  it('emits a single-line, PII-redacted log entry even with hostile dealId/error input', async () => {
    // dealId is an untrusted RPC arg (the CodeQL log-injection SOURCE); the
    // error message is a second hostile vector. Both must be neutralized: no
    // newline may survive into the log (forged-entry defense) and any SSN must
    // be masked (hard rule #3).
    vi.mocked(runCollateralPipeline).mockRejectedValue(
      new Error('boom for SSN 123-45-6789\nFAKE forged log line'),
    );
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      onDealStatusChanged('deal-1\nINJECTED', 'title_work', CTX),
    ).resolves.toBeUndefined();

    const agentLine = errSpy.mock.calls[0]?.[0] as string;
    expect(agentLine).not.toMatch(/[\r\n]/); // log-injection neutralized
    expect(agentLine).not.toContain('123-45-6789'); // raw SSN never logged
    expect(agentLine).toContain('***-**-6789'); // masked instead

    errSpy.mockRestore();
  });
});
