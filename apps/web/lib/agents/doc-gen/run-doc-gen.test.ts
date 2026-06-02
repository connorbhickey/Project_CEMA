import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Identity resolution (mirrors runOutreachFromDeal): clerk ids -> internal ids.
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

vi.mock('./deal-data', () => ({ loadDocGenInput: vi.fn() }));
vi.mock('./persist', () => ({ hasExistingPackage: vi.fn(), persistGeneratedDocument: vi.fn() }));
vi.mock('./adapter', () => ({
  docGenAdapter: { render: vi.fn().mockResolvedValue({ rendered: false }) },
}));
vi.mock('@cema/compliance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@cema/compliance')>();
  return { ...actual, emitAuditEvent: vi.fn() };
});
vi.mock('../../with-rls', () => ({
  withRls: vi.fn((_orgId: string, cb: (tx: unknown) => unknown) => cb({})),
}));

import { emitAuditEvent } from '@cema/compliance';

import { loadDocGenInput } from './deal-data';
import { hasExistingPackage, persistGeneratedDocument } from './persist';
import { runDocGen } from './run-doc-gen';

const INPUT = {
  dealId: 'deal-1',
  cemaType: 'refi_cema',
  newPrincipal: 500000,
  existingLoans: [{ id: 'l1', upb: 300000 }],
  county: 'Kings',
  borrowerNames: ['Jane Doe'],
};

const auditActions = () => vi.mocked(emitAuditEvent).mock.calls.map((c) => c[1].action);

beforeEach(() => {
  vi.mocked(hasExistingPackage).mockResolvedValue(false);
  vi.mocked(loadDocGenInput).mockResolvedValue(INPUT);
  vi.mocked(persistGeneratedDocument).mockResolvedValue(undefined);
  vi.mocked(emitAuditEvent).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('runDocGen', () => {
  it('persists each planned document + split-audits on a clean refi', async () => {
    await runDocGen('deal-1');

    // clean refi with gap>0 + 1 loan => 8 docs
    expect(persistGeneratedDocument).toHaveBeenCalledTimes(8);
    expect(persistGeneratedDocument).toHaveBeenCalledWith(
      'org-1',
      'user-1',
      'deal-1',
      expect.anything(),
    );
    expect(auditActions()).toContain('docgen.evaluated');
    expect(auditActions()).toContain('docgen.generated');
    expect(auditActions()).not.toContain('docgen.inconsistent');
  });

  it('skips (idempotent) when a cema_3172 already exists', async () => {
    vi.mocked(hasExistingPackage).mockResolvedValue(true);
    await runDocGen('deal-1');
    expect(loadDocGenInput).not.toHaveBeenCalled();
    expect(persistGeneratedDocument).not.toHaveBeenCalled();
    expect(emitAuditEvent).not.toHaveBeenCalled();
  });

  it('records docgen.inconsistent + persists nothing when numbers do not tie', async () => {
    vi.mocked(loadDocGenInput).mockResolvedValue({ ...INPUT, newPrincipal: 100000 });
    await runDocGen('deal-1');
    expect(persistGeneratedDocument).not.toHaveBeenCalled();
    expect(auditActions()).toContain('docgen.inconsistent');
    expect(auditActions()).not.toContain('docgen.generated');
  });

  it('no-ops when the deal data is missing', async () => {
    vi.mocked(loadDocGenInput).mockResolvedValue(null);
    await runDocGen('deal-1');
    expect(persistGeneratedDocument).not.toHaveBeenCalled();
  });

  it('audit metadata is PII-safe (no borrower name / amounts)', async () => {
    await runDocGen('deal-1');
    for (const call of vi.mocked(emitAuditEvent).mock.calls) {
      const meta = JSON.stringify(call[1].metadata ?? {});
      expect(meta).not.toContain('Jane Doe');
      expect(meta).not.toContain('500000');
    }
  });
});
