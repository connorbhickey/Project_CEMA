import { auditEvents, deals, getDb, organizations, properties, users } from '@cema/db';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Only @cema/auth is mocked (org resolution); @cema/db + withRls hit real Neon.
vi.mock('@cema/auth', () => ({ getCurrentOrganizationId: vi.fn() }));

import { getCurrentOrganizationId } from '@cema/auth';

import { getOrgAgentActivity } from '../../lib/queries/org-agent-activity';

const skip = !process.env.DATABASE_URL;

// Distinct UUID block (…d1–d8) + unique clerk ids/slugs (see the shared-dev-branch
// parallel-flake note — run serially to verify).
const ORG_ID = '00000000-0000-0000-0000-0000000000d1';
const OTHER_ORG_ID = '00000000-0000-0000-0000-0000000000d2';
const USER_ID = '00000000-0000-0000-0000-0000000000d3';
const PROPERTY_ID = '00000000-0000-0000-0000-0000000000d4';
const DEAL_ID = '00000000-0000-0000-0000-0000000000d5';
const AE_NEWER = '00000000-0000-0000-0000-0000000000d6'; // deal-scoped, newer
const AE_OLDER = '00000000-0000-0000-0000-0000000000d7'; // deal-scoped, older
const AE_DOCUMENT = '00000000-0000-0000-0000-0000000000d8'; // document-scoped (excluded)

describe.skipIf(skip)('getOrgAgentActivity (Neon integration)', () => {
  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(organizations)
      .values([
        { id: ORG_ID, clerkOrgId: 'org_agent_feed', name: 'Agent Feed', slug: 'agent-feed' },
        {
          id: OTHER_ORG_ID,
          clerkOrgId: 'org_agent_feed_other',
          name: 'Agent Feed Other',
          slug: 'agent-feed-other',
        },
      ])
      .onConflictDoNothing();
    await db
      .insert(users)
      .values({ id: USER_ID, clerkUserId: 'user_agent_feed', email: 'agent-feed@example.invalid' })
      .onConflictDoNothing();
    await db
      .insert(properties)
      .values({
        id: PROPERTY_ID,
        organizationId: ORG_ID,
        streetAddress: '123 Main St',
        city: 'Brooklyn',
        county: 'Kings',
        zipCode: '11201',
        propertyType: 'one_family',
      })
      .onConflictDoNothing();
    await db
      .insert(deals)
      .values({
        id: DEAL_ID,
        organizationId: ORG_ID,
        cemaType: 'refi_cema',
        status: 'doc_prep',
        propertyId: PROPERTY_ID,
        createdById: USER_ID,
      })
      .onConflictDoNothing();
    // audit_events is append-only (immutability trigger) — never deleted; stable ids
    // + onConflictDoNothing make the suite re-runnable.
    await db
      .insert(auditEvents)
      .values([
        {
          id: AE_OLDER,
          organizationId: ORG_ID,
          actorUserId: USER_ID,
          action: 'deal.status_changed',
          entityType: 'deal',
          entityId: DEAL_ID,
          metadata: { from: 'title_work', to: 'doc_prep' },
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
          entityId: '00000000-0000-0000-0000-0000000000df',
          metadata: { source: 'doc-gen' },
          occurredAt: new Date('2026-06-01T12:00:00Z'),
        },
      ])
      .onConflictDoNothing();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns the org deal-scoped events (newest first) with joined deal + address context', async () => {
    vi.mocked(getCurrentOrganizationId).mockResolvedValue('org_agent_feed');

    const rows = await getOrgAgentActivity();
    const mine = rows.filter((r) => r.dealId === DEAL_ID);
    const ids = mine.map((r) => r.id);

    expect(ids).toContain(AE_NEWER);
    expect(ids).toContain(AE_OLDER);
    expect(ids).not.toContain(AE_DOCUMENT); // document-scoped excluded
    expect(ids.indexOf(AE_NEWER)).toBeLessThan(ids.indexOf(AE_OLDER)); // newest first

    const newer = mine.find((r) => r.id === AE_NEWER)!;
    expect(newer.cemaType).toBe('refi_cema');
    expect(newer.status).toBe('doc_prep');
    expect(newer.streetAddress).toBe('123 Main St');
    expect(newer.city).toBe('Brooklyn');
  });

  it('isolates cross-org (RLS): another org sees none of this org’s events', async () => {
    vi.mocked(getCurrentOrganizationId).mockResolvedValue('org_agent_feed_other');

    const rows = await getOrgAgentActivity();
    expect(rows.filter((r) => r.dealId === DEAL_ID)).toEqual([]);
  });
});
