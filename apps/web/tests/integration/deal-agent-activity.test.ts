import { auditEvents, deals, getDb, organizations, users } from '@cema/db';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Only @cema/auth is mocked (org resolution); @cema/db + withRls hit real Neon.
vi.mock('@cema/auth', () => ({ getCurrentOrganizationId: vi.fn() }));

import { getCurrentOrganizationId } from '@cema/auth';

import { getDealAgentActivity } from '../../lib/queries/deal-agent-activity';

const skip = !process.env.DATABASE_URL;

// Distinct UUID block (…b1–b7) + unique clerk ids/slugs (see the shared-dev-branch
// parallel-flake note — run serially to verify).
const ORG_ID = '00000000-0000-0000-0000-0000000000b1';
const OTHER_ORG_ID = '00000000-0000-0000-0000-0000000000b2';
const USER_ID = '00000000-0000-0000-0000-0000000000b3';
const DEAL_ID = '00000000-0000-0000-0000-0000000000b4';
const AE_OLDER = '00000000-0000-0000-0000-0000000000b5'; // deal-scoped, older
const AE_NEWER = '00000000-0000-0000-0000-0000000000b6'; // deal-scoped, newer
const AE_DOCUMENT = '00000000-0000-0000-0000-0000000000b7'; // document-scoped (excluded)

describe.skipIf(skip)('getDealAgentActivity (Neon integration)', () => {
  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(organizations)
      .values([
        {
          id: ORG_ID,
          clerkOrgId: 'agent_activity_org',
          name: 'Agent Activity',
          slug: 'agent-activity',
        },
        {
          id: OTHER_ORG_ID,
          clerkOrgId: 'agent_activity_other',
          name: 'Agent Activity Other',
          slug: 'agent-activity-other',
        },
      ])
      .onConflictDoNothing();
    await db
      .insert(users)
      .values({
        id: USER_ID,
        clerkUserId: 'user_agent_activity',
        email: 'agent-activity@example.invalid',
      })
      .onConflictDoNothing();
    await db
      .insert(deals)
      .values({
        id: DEAL_ID,
        organizationId: ORG_ID,
        cemaType: 'refi_cema',
        status: 'doc_prep',
        createdById: USER_ID,
      })
      .onConflictDoNothing();
    // audit_events is append-only (immutability trigger) — never deleted; stable
    // ids + onConflictDoNothing make the suite re-runnable.
    await db
      .insert(auditEvents)
      .values([
        {
          id: AE_OLDER,
          organizationId: ORG_ID,
          actorUserId: USER_ID,
          action: 'docgen.evaluated',
          entityType: 'deal',
          entityId: DEAL_ID,
          metadata: { count: 8, consistent: true },
          occurredAt: new Date('2026-06-01T10:00:00Z'),
        },
        {
          id: AE_NEWER,
          organizationId: ORG_ID,
          actorUserId: USER_ID,
          action: 'docgen.generated',
          entityType: 'deal',
          entityId: DEAL_ID,
          metadata: { count: 8 },
          occurredAt: new Date('2026-06-01T11:00:00Z'),
        },
        {
          id: AE_DOCUMENT,
          organizationId: ORG_ID,
          actorUserId: USER_ID,
          action: 'document.submitted_for_review',
          entityType: 'document',
          entityId: '00000000-0000-0000-0000-0000000000bf',
          metadata: { source: 'doc-gen' },
          occurredAt: new Date('2026-06-01T12:00:00Z'),
        },
      ])
      .onConflictDoNothing();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns only the deal-scoped events, newest first', async () => {
    vi.mocked(getCurrentOrganizationId).mockResolvedValue('agent_activity_org');

    const { items, nextCursor } = await getDealAgentActivity(DEAL_ID);
    const ids = items.map((e) => e.id);

    // The document-scoped event is excluded; deal-scoped events come newest-first.
    expect(ids).toContain(AE_NEWER);
    expect(ids).toContain(AE_OLDER);
    expect(ids).not.toContain(AE_DOCUMENT);
    expect(ids.indexOf(AE_NEWER)).toBeLessThan(ids.indexOf(AE_OLDER));
    expect(items.every((e) => e.action.startsWith('docgen.'))).toBe(true);
    // Only two deal events (< LIMIT) -> no further page.
    expect(nextCursor).toBeNull();
  });

  it('isolates cross-org (RLS): another org sees none of this deal’s events', async () => {
    vi.mocked(getCurrentOrganizationId).mockResolvedValue('agent_activity_other');

    const { items } = await getDealAgentActivity(DEAL_ID);
    expect(items).toEqual([]);
  });

  it('filters by since (occurredAt cutoff), composing with the agent filter', async () => {
    vi.mocked(getCurrentOrganizationId).mockResolvedValue('agent_activity_org');

    // A cutoff between OLDER (10:00) and NEWER (11:00): only the newer survives.
    const cutoff = new Date('2026-06-01T10:30:00Z');
    const sinceIds = (await getDealAgentActivity(DEAL_ID, undefined, cutoff)).items.map(
      (e) => e.id,
    );
    expect(sinceIds).toContain(AE_NEWER);
    expect(sinceIds).not.toContain(AE_OLDER);

    // Composes with the agent filter (docgen + since).
    const composed = (await getDealAgentActivity(DEAL_ID, 'docgen', cutoff)).items.map((e) => e.id);
    expect(composed).toContain(AE_NEWER);
    expect(composed).not.toContain(AE_OLDER);
  });

  it('paginates with a cursor: returns only events strictly older than the cursor', async () => {
    vi.mocked(getCurrentOrganizationId).mockResolvedValue('agent_activity_org');

    // Cursor positioned AT the newer event -> the next page is everything older.
    const cursor = { occurredAt: new Date('2026-06-01T11:00:00.000Z'), id: AE_NEWER };
    const { items } = await getDealAgentActivity(DEAL_ID, undefined, undefined, cursor);
    const ids = items.map((e) => e.id);

    expect(ids).toContain(AE_OLDER);
    expect(ids).not.toContain(AE_NEWER); // the cursor row itself is excluded
  });
});
