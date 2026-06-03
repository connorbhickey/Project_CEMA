import { auditEvents, deals, getDb, organizations, properties, users } from '@cema/db';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Only @cema/auth is mocked (org resolution); @cema/db + withRls hit real Neon.
vi.mock('@cema/auth', () => ({ getCurrentOrganizationId: vi.fn() }));

import { getCurrentOrganizationId } from '@cema/auth';

import { getAgentActionCounts } from '../../lib/queries/agent-action-counts';
import { getDealsByStatus } from '../../lib/queries/deals-by-status';

const skip = !process.env.DATABASE_URL;

// Distinctive namespace — never reuse across runs (see neon-integration-test
// collision hazard). Org A is touched ONLY by this suite, so its aggregates are
// deterministic under onConflictDoNothing + stable ids.
const ORG_A = 'da5b0a00-0000-0000-0000-000000000001';
const ORG_B = 'da5b0a00-0000-0000-0000-000000000002';
const USER = 'da5b0a00-0000-0000-0000-000000000003';
const PROP_A1 = 'da5b0a00-0000-0000-0000-000000000004';
const PROP_A2 = 'da5b0a00-0000-0000-0000-000000000005';
const PROP_B1 = 'da5b0a00-0000-0000-0000-000000000006';
const DEAL_A1 = 'da5b0a00-0000-0000-0000-000000000007'; // intake
const DEAL_A2 = 'da5b0a00-0000-0000-0000-000000000008'; // recording
const DEAL_B1 = 'da5b0a00-0000-0000-0000-000000000009'; // closing
const AE_A_DOCGEN1 = 'da5b0a00-0000-0000-0000-00000000000a';
const AE_A_DOCGEN2 = 'da5b0a00-0000-0000-0000-00000000000b';
const AE_A_IDP = 'da5b0a00-0000-0000-0000-00000000000c';
const AE_A_DOC = 'da5b0a00-0000-0000-0000-00000000000d'; // document-scoped (excluded)
const AE_B_INTAKE = 'da5b0a00-0000-0000-0000-00000000000e';
const DOC_ENTITY = 'da5b0a00-0000-0000-0000-00000000000f'; // entityId for the doc-scoped audit

describe.skipIf(skip)('dashboard aggregates (Neon integration)', () => {
  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(organizations)
      .values([
        { id: ORG_A, clerkOrgId: 'dashagg_org_a', name: 'Dash Agg A', slug: 'dashagg-a' },
        { id: ORG_B, clerkOrgId: 'dashagg_org_b', name: 'Dash Agg B', slug: 'dashagg-b' },
      ])
      .onConflictDoNothing();
    await db
      .insert(users)
      .values({ id: USER, clerkUserId: 'dashagg_user', email: 'dashagg@example.invalid' })
      .onConflictDoNothing();
    await db
      .insert(properties)
      .values(
        [PROP_A1, PROP_A2, PROP_B1].map((id, i) => ({
          id,
          streetAddress: `${100 + i} Dash St`,
          city: 'Brooklyn',
          county: 'Kings',
          zipCode: '11201',
          propertyType: 'one_family' as const,
        })),
      )
      .onConflictDoNothing();
    await db
      .insert(deals)
      .values([
        {
          id: DEAL_A1,
          organizationId: ORG_A,
          cemaType: 'refi_cema',
          status: 'intake',
          propertyId: PROP_A1,
          createdById: USER,
        },
        {
          id: DEAL_A2,
          organizationId: ORG_A,
          cemaType: 'refi_cema',
          status: 'recording',
          propertyId: PROP_A2,
          createdById: USER,
        },
        {
          id: DEAL_B1,
          organizationId: ORG_B,
          cemaType: 'refi_cema',
          status: 'closing',
          propertyId: PROP_B1,
          createdById: USER,
        },
      ])
      .onConflictDoNothing();
    // audit_events is append-only — stable ids + onConflictDoNothing make this re-runnable.
    await db
      .insert(auditEvents)
      .values([
        {
          id: AE_A_DOCGEN1,
          organizationId: ORG_A,
          actorUserId: USER,
          action: 'docgen.evaluated',
          entityType: 'deal',
          entityId: DEAL_A1,
          metadata: { count: 7 },
          occurredAt: new Date('2026-06-01T10:00:00Z'),
        },
        {
          id: AE_A_DOCGEN2,
          organizationId: ORG_A,
          actorUserId: USER,
          action: 'docgen.evaluated',
          entityType: 'deal',
          entityId: DEAL_A2,
          metadata: { count: 7 },
          occurredAt: new Date('2026-06-01T10:05:00Z'),
        },
        {
          id: AE_A_IDP,
          organizationId: ORG_A,
          actorUserId: USER,
          action: 'idp.evaluated',
          entityType: 'deal',
          entityId: DEAL_A1,
          metadata: {},
          occurredAt: new Date('2026-06-01T10:10:00Z'),
        },
        {
          id: AE_A_DOC,
          organizationId: ORG_A,
          actorUserId: USER,
          action: 'document.submitted_for_review',
          entityType: 'document',
          entityId: DOC_ENTITY,
          metadata: { source: 'doc-gen' },
          occurredAt: new Date('2026-06-01T10:15:00Z'),
        },
        {
          id: AE_B_INTAKE,
          organizationId: ORG_B,
          actorUserId: USER,
          action: 'intake.evaluated',
          entityType: 'deal',
          entityId: DEAL_B1,
          metadata: {},
          occurredAt: new Date('2026-06-01T10:20:00Z'),
        },
      ])
      .onConflictDoNothing();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('counts deals by status, isolated to the org (getDealsByStatus)', async () => {
    vi.mocked(getCurrentOrganizationId).mockResolvedValue('dashagg_org_a');
    const map = new Map((await getDealsByStatus()).map((c) => [c.status, c.count]));
    expect(map.get('intake')).toBe(1);
    expect(map.get('recording')).toBe(1);
    expect(map.has('closing')).toBe(false); // Org B's deal — isolated
  });

  it('counts deal-scoped audit actions, excluding document-scoped, isolated (getAgentActionCounts)', async () => {
    vi.mocked(getCurrentOrganizationId).mockResolvedValue('dashagg_org_a');
    const map = new Map((await getAgentActionCounts()).map((c) => [c.action, c.count]));
    expect(map.get('docgen.evaluated')).toBe(2);
    expect(map.get('idp.evaluated')).toBe(1);
    expect(map.has('document.submitted_for_review')).toBe(false); // document-scoped excluded
    expect(map.has('intake.evaluated')).toBe(false); // Org B's — isolated
  });

  it('isolates the other org (RLS): Org B sees only its own aggregates', async () => {
    vi.mocked(getCurrentOrganizationId).mockResolvedValue('dashagg_org_b');
    const statusMap = new Map((await getDealsByStatus()).map((c) => [c.status, c.count]));
    expect(statusMap.get('closing')).toBe(1);
    expect(statusMap.has('intake')).toBe(false);
    const actionMap = new Map((await getAgentActionCounts()).map((c) => [c.action, c.count]));
    expect(actionMap.get('intake.evaluated')).toBe(1);
    expect(actionMap.has('docgen.evaluated')).toBe(false);
  });
});
