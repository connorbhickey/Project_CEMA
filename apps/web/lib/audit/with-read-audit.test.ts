import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@cema/auth', () => ({
  getCurrentOrganizationId: vi.fn().mockResolvedValue('clerk-org-1'),
  getCurrentUser: vi.fn().mockResolvedValue({ id: 'clerk-user-1' }),
}));

vi.mock('@cema/db', () => ({
  getDb: vi.fn(),
  organizations: {},
  users: {},
  auditEventReads: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue({}),
}));

import { getCurrentOrganizationId, getCurrentUser } from '@cema/auth';
import { getDb } from '@cema/db';

import { withReadAudit } from './with-read-audit';

const ORG = { id: 'org-uuid-1', clerkOrgId: 'clerk-org-1' };
const USER = { id: 'user-uuid-1', clerkUserId: 'clerk-user-1' };

function makeMockDb(orgResult = ORG, userResult = USER) {
  const insertValues = vi.fn().mockResolvedValue(undefined);
  const insertReturn = { values: insertValues };
  return {
    query: {
      organizations: { findFirst: vi.fn().mockResolvedValue(orgResult) },
      users: { findFirst: vi.fn().mockResolvedValue(userResult) },
    },
    insert: vi.fn().mockReturnValue(insertReturn),
    _insertValues: insertValues,
  };
}

describe('withReadAudit', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('happy path: calls fn, inserts audit row, and returns the result', async () => {
    const mockDb = makeMockDb();
    vi.mocked(getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    const expected = { data: 'some-sensitive-value' };
    const fn = vi.fn().mockResolvedValue(expected);

    const result = await withReadAudit(
      { entityType: 'communication', entityId: 'comm-uuid-1', purpose: 'view_detail' },
      fn,
    );

    expect(result).toBe(expected);
    expect(fn).toHaveBeenCalledOnce();
    expect(mockDb.insert).toHaveBeenCalledOnce();
    expect(mockDb._insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG.id,
        actorUserId: USER.id,
        entityType: 'communication',
        entityId: 'comm-uuid-1',
        purpose: 'view_detail',
      }),
    );
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('org-not-found: skips insert and still returns fn result', async () => {
    const mockDb = makeMockDb(null as unknown as typeof ORG, USER);
    vi.mocked(getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    const expected = 'result-value';
    const fn = vi.fn().mockResolvedValue(expected);

    const result = await withReadAudit(
      { entityType: 'document', entityId: 'doc-uuid-1', purpose: 'list' },
      fn,
    );

    expect(result).toBe(expected);
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('insert failure: swallows the error, returns fn result, and logs ONE redacted token line', async () => {
    const failingDb = {
      query: {
        organizations: { findFirst: vi.fn().mockResolvedValue(ORG) },
        users: { findFirst: vi.fn().mockResolvedValue(USER) },
      },
      insert: vi.fn().mockReturnValue({
        // The error message carries an SSN + a CR/LF (a log-injection attempt).
        values: vi.fn().mockRejectedValue(new Error('insert failed for 123-45-6789\nINJECTED')),
      }),
    };
    vi.mocked(getDb).mockReturnValue(failingDb as unknown as ReturnType<typeof getDb>);

    const expected = 42;
    const fn = vi.fn().mockResolvedValue(expected);

    const result = await withReadAudit(
      { entityType: 'deal', entityId: 'deal-uuid-1', purpose: 'export' },
      fn,
    );

    expect(result).toBe(expected); // the swallow never breaks the request
    expect(consoleSpy).toHaveBeenCalledOnce();
    // A single redacted string — NOT (message, rawError), which would leak the
    // unredacted exception (hard rule #3).
    expect(consoleSpy.mock.calls[0]).toHaveLength(1);
    const logged = consoleSpy.mock.calls[0]![0] as string;
    expect(logged).toContain('READ_AUDIT_WRITE_FAILED'); // greppable token
    expect(logged).not.toContain('123-45-6789'); // SSN redacted (masked to ***-**-6789)
    expect(logged).not.toMatch(/[\r\n]/); // CR/LF stripped (log-injection-safe)
  });

  it('getCurrentOrganizationId throws: swallows error and returns fn result', async () => {
    vi.mocked(getCurrentOrganizationId).mockRejectedValueOnce(
      new Error('NoActiveOrganizationError'),
    );
    const mockDb = makeMockDb();
    vi.mocked(getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    const expected = 'data';
    const fn = vi.fn().mockResolvedValue(expected);

    const result = await withReadAudit(
      { entityType: 'recording', entityId: 'rec-uuid-1', purpose: 'agent' },
      fn,
    );

    expect(result).toBe(expected);
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledOnce();
  });

  it('null getCurrentUser: skips insert and returns fn result', async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(null);
    const mockDb = makeMockDb();
    vi.mocked(getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    const expected = null;
    const fn = vi.fn().mockResolvedValue(expected);

    const result = await withReadAudit(
      { entityType: 'contact', entityId: 'contact-uuid-1', purpose: 'admin' },
      fn,
    );

    expect(result).toBe(expected);
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(consoleSpy).not.toHaveBeenCalled();
  });
});
