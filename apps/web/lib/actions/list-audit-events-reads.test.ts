import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@cema/auth', () => ({
  getCurrentOrganizationId: vi.fn().mockResolvedValue('clerk-org-1'),
}));

vi.mock('@cema/db', () => ({
  getDb: vi.fn(),
  organizations: {},
  auditEventReads: {
    organizationId: 'org_col',
    createdAt: 'created_at_col',
    entityType: 'entity_type_col',
    entityId: 'entity_id_col',
    actorUserId: 'actor_user_id_col',
  },
  users: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue({}),
  and: vi.fn().mockReturnValue({}),
  desc: vi.fn().mockReturnValue({}),
  gte: vi.fn().mockReturnValue({}),
}));

vi.mock('../with-rls', () => ({ withRls: vi.fn() }));

import { getDb } from '@cema/db';

import { withRls } from '../with-rls';

import { listAuditEventReads } from './list-audit-events-reads';

const ORG = { id: 'org-uuid-1', clerkOrgId: 'clerk-org-1' };

const AUDIT_ROW = {
  id: 'audit-1',
  organizationId: ORG.id,
  actorUserId: 'user-1',
  entityType: 'communication' as const,
  entityId: 'comm-1',
  purpose: 'view_detail' as const,
  actorIp: null,
  createdAt: new Date('2026-05-23T10:00:00Z'),
};

const USER_ROW = { id: 'user-1', email: 'actor@example.com', clerkUserId: 'clerk-user-1' };

describe('listAuditEventReads', () => {
  beforeEach(() => {
    vi.mocked(getDb).mockReturnValue({
      query: { organizations: { findFirst: vi.fn().mockResolvedValue(ORG) } },
    } as unknown as ReturnType<typeof getDb>);
  });

  // Use resetAllMocks to clear the implementation queue between tests.
  afterEach(() => vi.resetAllMocks());

  it('returns [] when org not found', async () => {
    vi.mocked(getDb).mockReturnValue({
      query: { organizations: { findFirst: vi.fn().mockResolvedValue(null) } },
    } as unknown as ReturnType<typeof getDb>);
    const result = await listAuditEventReads();
    expect(result).toEqual([]);
  });

  it('returns hydrated rows with actor on happy path', async () => {
    const userById = new Map([[USER_ROW.id, USER_ROW]]);
    vi.mocked(withRls).mockImplementationOnce(() =>
      Promise.resolve(
        [AUDIT_ROW].map((r) => ({ read: r, actor: userById.get(r.actorUserId) ?? null })),
      ),
    );

    const result = await listAuditEventReads({ sinceDays: 7, limit: 10 });
    expect(result).toHaveLength(1);
    expect(result[0]?.read.entityType).toBe('communication');
    expect(result[0]?.actor?.email).toBe('actor@example.com');
  });

  it('returns rows with null actor when user not found', async () => {
    vi.mocked(withRls).mockImplementationOnce(() =>
      Promise.resolve([{ read: AUDIT_ROW, actor: null }]),
    );
    const result = await listAuditEventReads();
    expect(result[0]?.actor).toBeNull();
  });
});
