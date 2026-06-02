import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Standalone adapter mocks (vi.hoisted so the factory + the test body share the
// same fns) -- referencing recordingAdapter.submit/poll directly would trip
// @typescript-eslint/unbound-method.
const { submitMock, pollMock } = vi.hoisted(() => ({ submitMock: vi.fn(), pollMock: vi.fn() }));

// Identity resolution (mirrors runDocGen / runOutreachFromDeal): clerk -> internal.
vi.mock('@cema/auth', () => ({
  getCurrentOrganizationId: vi.fn().mockResolvedValue('clerk-org-1'),
  getCurrentUser: vi.fn().mockResolvedValue({ id: 'clerk-user-1' }),
}));
vi.mock('@cema/db', () => ({
  getDb: vi.fn(() => ({
    query: {
      organizations: { findFirst: vi.fn().mockResolvedValue({ id: 'org-1' }) },
      users: { findFirst: vi.fn().mockResolvedValue({ id: 'user-1' }) },
    },
  })),
  organizations: {},
  users: {},
}));
vi.mock('drizzle-orm', () => ({ eq: vi.fn().mockReturnValue({}) }));

vi.mock('./deal-data', () => ({ loadRecordingInput: vi.fn() }));
vi.mock('./persist', () => ({
  hasExistingRecordingPackage: vi.fn(),
  persistCoverSheet: vi.fn(),
  persistRecordingCoordinates: vi.fn(),
}));
vi.mock('./adapter', () => ({ recordingAdapter: { submit: submitMock, poll: pollMock } }));
vi.mock('@cema/compliance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@cema/compliance')>();
  return { ...actual, emitAuditEvent: vi.fn() };
});
vi.mock('../../with-rls', () => ({
  withRls: vi.fn((_orgId: string, cb: (tx: unknown) => unknown) => cb({})),
}));

import { emitAuditEvent } from '@cema/compliance';

import { loadRecordingInput } from './deal-data';
import {
  hasExistingRecordingPackage,
  persistCoverSheet,
  persistRecordingCoordinates,
} from './persist';
import { runRecordingPrep } from './run-recording-prep';

const NYC_REFI = {
  dealId: 'deal-1',
  cemaType: 'refi_cema',
  county: 'Kings',
  acrisBbl: '3-00100-0001',
};
const UPSTATE_REFI = {
  dealId: 'deal-1',
  cemaType: 'refi_cema',
  county: 'Nassau',
  acrisBbl: null,
};

const auditActions = () => vi.mocked(emitAuditEvent).mock.calls.map((c) => c[1].action);

beforeEach(() => {
  vi.mocked(hasExistingRecordingPackage).mockResolvedValue(false);
  vi.mocked(loadRecordingInput).mockResolvedValue(NYC_REFI);
  vi.mocked(persistCoverSheet).mockResolvedValue(undefined);
  vi.mocked(persistRecordingCoordinates).mockResolvedValue(undefined);
  vi.mocked(emitAuditEvent).mockResolvedValue(undefined);
  submitMock.mockResolvedValue({ submissionId: null, submitted: false });
  pollMock.mockResolvedValue({ status: 'not_submitted' });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('runRecordingPrep', () => {
  it('persists the venue cover sheet + split-audits (NYC refi -> acris)', async () => {
    await runRecordingPrep('deal-1');
    expect(persistCoverSheet).toHaveBeenCalledTimes(1);
    expect(persistCoverSheet).toHaveBeenCalledWith(
      'org-1',
      'user-1',
      'deal-1',
      expect.objectContaining({ kind: 'acris_cover_pages' }),
    );
    expect(auditActions()).toContain('recording.evaluated');
    expect(auditActions()).toContain('recording.prepared');
  });

  it('persists the gated county_cover_sheet (upstate refi)', async () => {
    vi.mocked(loadRecordingInput).mockResolvedValue(UPSTATE_REFI);
    await runRecordingPrep('deal-1');
    expect(persistCoverSheet).toHaveBeenCalledWith(
      'org-1',
      'user-1',
      'deal-1',
      expect.objectContaining({ kind: 'county_cover_sheet' }),
    );
  });

  it('is idempotent — skips when a cover sheet already exists', async () => {
    vi.mocked(hasExistingRecordingPackage).mockResolvedValue(true);
    await runRecordingPrep('deal-1');
    expect(loadRecordingInput).not.toHaveBeenCalled();
    expect(persistCoverSheet).not.toHaveBeenCalled();
    expect(emitAuditEvent).not.toHaveBeenCalled();
  });

  it('no-ops when the deal data is missing', async () => {
    vi.mocked(loadRecordingInput).mockResolvedValue(null);
    await runRecordingPrep('deal-1');
    expect(persistCoverSheet).not.toHaveBeenCalled();
  });

  it('on acceptance persists coordinates + recording.completed', async () => {
    submitMock.mockResolvedValue({ submissionId: 'sub-1', submitted: true });
    pollMock.mockResolvedValue({
      status: 'accepted',
      recordingRef: { reelPage: null, crfn: '2026000123456' },
    });
    await runRecordingPrep('deal-1');
    expect(persistRecordingCoordinates).toHaveBeenCalledTimes(1);
    expect(auditActions()).toContain('recording.completed');
    expect(auditActions()).not.toContain('recording.rejected');
  });

  it('on rejection emits recording.rejected + no coordinates', async () => {
    submitMock.mockResolvedValue({ submissionId: 'sub-1', submitted: true });
    pollMock.mockResolvedValue({
      status: 'rejected',
      rejectionReason: 'bad_legal_description',
    });
    await runRecordingPrep('deal-1');
    expect(persistRecordingCoordinates).not.toHaveBeenCalled();
    expect(auditActions()).toContain('recording.rejected');
    expect(auditActions()).not.toContain('recording.completed');
  });

  it('audit metadata is PII-safe (county name not leaked; venue token only)', async () => {
    await runRecordingPrep('deal-1');
    for (const call of vi.mocked(emitAuditEvent).mock.calls) {
      const meta = JSON.stringify(call[1].metadata ?? {});
      expect(meta).not.toContain('Kings'); // county name never in audit metadata
    }
  });
});
