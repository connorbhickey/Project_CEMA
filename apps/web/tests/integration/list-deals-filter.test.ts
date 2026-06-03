import { deals, getDb, organizations, properties, users } from '@cema/db';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@cema/auth', () => ({ getCurrentOrganizationId: vi.fn() }));

import { getCurrentOrganizationId } from '@cema/auth';

import { listDeals } from '../../lib/actions/list-deals';

const skip = !process.env.DATABASE_URL;

// Distinctive namespace — never reuse (collision hazard). Org A touched only here.
const ORG_A = 'd3a15f00-0000-0000-0000-000000000001';
const ORG_B = 'd3a15f00-0000-0000-0000-000000000002';
const USER = 'd3a15f00-0000-0000-0000-000000000003';
const PROP_A1 = 'd3a15f00-0000-0000-0000-000000000004';
const PROP_A2 = 'd3a15f00-0000-0000-0000-000000000005';
const PROP_B1 = 'd3a15f00-0000-0000-0000-000000000006';
const DEAL_A_INTAKE = 'd3a15f00-0000-0000-0000-000000000007';
const DEAL_A_RECORDING = 'd3a15f00-0000-0000-0000-000000000008';
const DEAL_B_INTAKE = 'd3a15f00-0000-0000-0000-000000000009';

describe.skipIf(skip)('listDeals status filter (Neon integration)', () => {
  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(organizations)
      .values([
        { id: ORG_A, clerkOrgId: 'dealfilter_org_a', name: 'Deal Filter A', slug: 'dealfilter-a' },
        { id: ORG_B, clerkOrgId: 'dealfilter_org_b', name: 'Deal Filter B', slug: 'dealfilter-b' },
      ])
      .onConflictDoNothing();
    await db
      .insert(users)
      .values({ id: USER, clerkUserId: 'dealfilter_user', email: 'dealfilter@example.invalid' })
      .onConflictDoNothing();
    await db
      .insert(properties)
      .values(
        [PROP_A1, PROP_A2, PROP_B1].map((id, i) => ({
          id,
          streetAddress: `${200 + i} Filter Ave`,
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
          id: DEAL_A_INTAKE,
          organizationId: ORG_A,
          cemaType: 'refi_cema',
          status: 'intake',
          propertyId: PROP_A1,
          createdById: USER,
        },
        {
          id: DEAL_A_RECORDING,
          organizationId: ORG_A,
          cemaType: 'refi_cema',
          status: 'recording',
          propertyId: PROP_A2,
          createdById: USER,
        },
        {
          id: DEAL_B_INTAKE,
          organizationId: ORG_B,
          cemaType: 'refi_cema',
          status: 'intake',
          propertyId: PROP_B1,
          createdById: USER,
        },
      ])
      .onConflictDoNothing();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('filters to the requested status, scoped to the org', async () => {
    vi.mocked(getCurrentOrganizationId).mockResolvedValue('dealfilter_org_a');
    const ids = (await listDeals('intake')).map((d) => d.id);
    expect(ids).toContain(DEAL_A_INTAKE);
    expect(ids).not.toContain(DEAL_A_RECORDING); // other status excluded
    expect(ids).not.toContain(DEAL_B_INTAKE); // other org excluded (RLS)
  });

  it('returns all org deals when no status is passed', async () => {
    vi.mocked(getCurrentOrganizationId).mockResolvedValue('dealfilter_org_a');
    const ids = (await listDeals()).map((d) => d.id);
    expect(ids).toContain(DEAL_A_INTAKE);
    expect(ids).toContain(DEAL_A_RECORDING);
    expect(ids).not.toContain(DEAL_B_INTAKE);
  });
});
