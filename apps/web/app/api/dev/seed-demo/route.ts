/**
 * DEV-ONLY: Idempotent demo-data seed route.
 *
 * GET /api/dev/seed-demo
 *
 * - Returns 404 in production.
 * - Resolves the Clerk session's org → seeds realistic demo deals, audit
 *   events, and chain-break queue rows so every dashboard loader returns
 *   populated results.
 * - Idempotent: prior demo rows (identified by the "DEMO ·" address prefix)
 *   are deleted before re-seeding.
 * - Redirects to /dashboard on success.
 *
 * How to trigger: while logged in and with an active org selected, open
 *   http://localhost:3000/api/dev/seed-demo
 * in your browser.
 */

import { getCurrentOrganizationId, getCurrentUser } from '@cema/auth';
import {
  auditEvents,
  chainBreakReviewQueue,
  dealStatusEnum,
  deals,
  existingLoans,
  getDb,
  newLoans,
  organizations,
  parties,
  properties,
  users,
} from '@cema/db';
import { and, eq, inArray, like, sql as sqlFrag } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import { withRls } from '@/lib/with-rls';

// ---------------------------------------------------------------------------
// Guard: dev-only
// ---------------------------------------------------------------------------
export async function GET(): Promise<Response> {
  if (process.env.NODE_ENV === 'production') {
    return new Response('Not Found', { status: 404 });
  }

  // ---------------------------------------------------------------------------
  // Resolve identity
  // ---------------------------------------------------------------------------
  let clerkOrgId: string;
  let clerkUser: Awaited<ReturnType<typeof getCurrentUser>>;
  try {
    clerkOrgId = await getCurrentOrganizationId();
    clerkUser = await getCurrentUser();
  } catch {
    return Response.json(
      {
        error:
          'Not authenticated or no active organization. Sign in and select an org, then visit this URL.',
      },
      { status: 401 },
    );
  }
  if (!clerkUser) {
    return Response.json({ error: 'No user session found.' }, { status: 401 });
  }

  const db = getDb();

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) {
    return Response.json(
      {
        error:
          'Organization not yet synced to the database. The Clerk webhook may still be processing — try again in a moment.',
      },
      { status: 400 },
    );
  }

  const user = await db.query.users.findFirst({
    where: eq(users.clerkUserId, clerkUser.id),
  });
  if (!user) {
    return Response.json(
      {
        error:
          'User not yet synced to the database. The Clerk webhook may still be processing — try again in a moment.',
      },
      { status: 400 },
    );
  }

  // ---------------------------------------------------------------------------
  // Seed inside withRls so RLS policies evaluate correctly
  // ---------------------------------------------------------------------------
  await withRls(org.id, async (tx) => {
    // -----------------------------------------------------------------------
    // 1. Delete previous demo rows (idempotency).
    //    Deals own everything via cascade or FK, so deleting deals cleans
    //    existingLoans / parties / chainBreakReviewQueue (cascade on deal_id).
    //    audit_events are append-only — we delete them explicitly by dealId
    //    before deleting the deals (they would FK-restrict otherwise via
    //    the entityId → deal UUID pattern; but audit_events.entityId has no
    //    FK constraint — it is a plain UUID column — so we can delete them
    //    first without a constraint violation).
    // -----------------------------------------------------------------------
    const demoProps = await tx
      .select({ id: properties.id })
      .from(properties)
      .where(like(properties.streetAddress, 'DEMO · %'));

    // Find demo deals via their demo properties.
    let demoDealIds: string[] = [];
    if (demoProps.length > 0) {
      const demoPropIds = demoProps.map((p) => p.id);
      const demoDeals = await tx
        .select({ id: deals.id })
        .from(deals)
        .where(and(eq(deals.organizationId, org.id), inArray(deals.propertyId, demoPropIds)));
      demoDealIds = demoDeals.map((d) => d.id);
    }

    // Also pick up any demo deals that may have been seeded without a property
    // (belt-and-suspenders: look for deals whose metadata marks them as demo).
    // Use a raw SQL fragment against the jsonb column so we avoid the
    // no-unsafe-member-access lint error that comes with a JS property access
    // on a typed jsonb column.
    const demoDealsByMeta = await tx
      .select({ id: deals.id })
      .from(deals)
      .where(and(eq(deals.organizationId, org.id), sqlFrag`${deals.metadata}->>'demo' = 'true'`));
    // Merge; avoid duplicates.
    for (const d of demoDealsByMeta) {
      if (!demoDealIds.includes(d.id)) demoDealIds.push(d.id);
    }

    if (demoDealIds.length > 0) {
      // Delete audit events whose entityId is a demo deal (no FK so safe to
      // delete before the deals rows).
      await tx
        .delete(auditEvents)
        .where(
          and(eq(auditEvents.organizationId, org.id), inArray(auditEvents.entityId, demoDealIds)),
        );

      // chainBreakReviewQueue has a FK on deal_id — delete before deals.
      await tx
        .delete(chainBreakReviewQueue)
        .where(inArray(chainBreakReviewQueue.dealId, demoDealIds));

      // parties cascade on deal delete, but delete explicitly to avoid any
      // future FK surprises.
      await tx.delete(parties).where(inArray(parties.dealId, demoDealIds));

      // existingLoans cascade on deal delete.
      await tx.delete(existingLoans).where(inArray(existingLoans.dealId, demoDealIds));

      // Collect newLoan ids before deleting deals (FK on deals.new_loan_id).
      const dealRows = await tx
        .select({ newLoanId: deals.newLoanId })
        .from(deals)
        .where(inArray(deals.id, demoDealIds));
      const newLoanIds = dealRows.map((d) => d.newLoanId).filter((id): id is string => id !== null);

      await tx.delete(deals).where(inArray(deals.id, demoDealIds));

      if (newLoanIds.length > 0) {
        await tx.delete(newLoans).where(inArray(newLoans.id, newLoanIds));
      }

      // Delete demo properties.
      await tx.delete(properties).where(like(properties.streetAddress, 'DEMO · %'));
    }

    // -----------------------------------------------------------------------
    // 2. Define the demo deal corpus.
    //    ~24 deals in the active lifecycle + 3 attorney_review + 3 authorization
    //    + 4 completed + 3 exception = 37 deals total.
    //    statuses come from dealStatusEnum.enumValues.
    // -----------------------------------------------------------------------
    const STATUSES = dealStatusEnum.enumValues;
    void STATUSES; // Referenced below explicitly.

    interface DealSpec {
      streetAddress: string;
      city: string;
      county: string;
      zipCode: string;
      propertyType: (typeof properties.$inferInsert)['propertyType'];
      cemaType: 'refi_cema' | 'purchase_cema';
      status: (typeof deals.$inferInsert)['status'];
      program: (typeof newLoans.$inferInsert)['program'];
      principal: string;
      loans: { upb: string; chainPosition: number }[];
      /** Days in the past for the most recent audit event on this deal. */
      ageDays: number;
    }

    const DEMO_DEALS: DealSpec[] = [
      // ---- intake (2) ----
      {
        streetAddress: 'DEMO · 45 Ocean Pkwy',
        city: 'Brooklyn',
        county: 'Kings',
        zipCode: '11218',
        propertyType: 'one_family',
        cemaType: 'refi_cema',
        status: 'intake',
        program: 'conventional_fannie',
        principal: '620000.00',
        loans: [{ upb: '481000.00', chainPosition: 0 }],
        ageDays: 0,
      },
      {
        streetAddress: 'DEMO · 812 Flatbush Ave',
        city: 'Brooklyn',
        county: 'Kings',
        zipCode: '11226',
        propertyType: 'condo',
        cemaType: 'purchase_cema',
        status: 'intake',
        program: 'conventional_freddie',
        principal: '540000.00',
        loans: [{ upb: '390000.00', chainPosition: 0 }],
        ageDays: 0,
      },
      // ---- eligibility (3) ----
      {
        streetAddress: 'DEMO · 29 Sutton Pl',
        city: 'New York',
        county: 'New York',
        zipCode: '10022',
        propertyType: 'condo',
        cemaType: 'refi_cema',
        status: 'eligibility',
        program: 'jumbo',
        principal: '1850000.00',
        loans: [{ upb: '1420000.00', chainPosition: 0 }],
        ageDays: 1,
      },
      {
        streetAddress: 'DEMO · 117 Jamaica Ave',
        city: 'Queens',
        county: 'Queens',
        zipCode: '11435',
        propertyType: 'two_family',
        cemaType: 'refi_cema',
        status: 'eligibility',
        program: 'conventional_fannie',
        principal: '710000.00',
        loans: [
          { upb: '533000.00', chainPosition: 0 },
          { upb: '120000.00', chainPosition: 1 },
        ],
        ageDays: 1,
      },
      {
        streetAddress: 'DEMO · 55 Church St',
        city: 'White Plains',
        county: 'Westchester',
        zipCode: '10601',
        propertyType: 'one_family',
        cemaType: 'purchase_cema',
        status: 'eligibility',
        program: 'conventional_fannie',
        principal: '780000.00',
        loans: [{ upb: '610000.00', chainPosition: 0 }],
        ageDays: 2,
      },
      // ---- authorization (3) ----
      {
        streetAddress: 'DEMO · 301 E 47th St',
        city: 'New York',
        county: 'New York',
        zipCode: '10017',
        propertyType: 'condo',
        cemaType: 'refi_cema',
        status: 'authorization',
        program: 'jumbo',
        principal: '2200000.00',
        loans: [{ upb: '1680000.00', chainPosition: 0 }],
        ageDays: 2,
      },
      {
        streetAddress: 'DEMO · 88 Bay Ridge Ave',
        city: 'Brooklyn',
        county: 'Kings',
        zipCode: '11209',
        propertyType: 'one_family',
        cemaType: 'refi_cema',
        status: 'authorization',
        program: 'conventional_freddie',
        principal: '860000.00',
        loans: [{ upb: '670000.00', chainPosition: 0 }],
        ageDays: 3,
      },
      {
        streetAddress: 'DEMO · 14 Franklin Ave',
        city: 'Yonkers',
        county: 'Westchester',
        zipCode: '10701',
        propertyType: 'two_family',
        cemaType: 'refi_cema',
        status: 'authorization',
        program: 'conventional_fannie',
        principal: '655000.00',
        loans: [{ upb: '490000.00', chainPosition: 0 }],
        ageDays: 3,
      },
      // ---- collateral_chase (4) ----
      {
        streetAddress: 'DEMO · 200 Riverside Dr',
        city: 'New York',
        county: 'New York',
        zipCode: '10025',
        propertyType: 'condo',
        cemaType: 'refi_cema',
        status: 'collateral_chase',
        program: 'jumbo',
        principal: '1550000.00',
        loans: [{ upb: '1190000.00', chainPosition: 0 }],
        ageDays: 4,
      },
      {
        streetAddress: 'DEMO · 63 Linden Blvd',
        city: 'Brooklyn',
        county: 'Kings',
        zipCode: '11203',
        propertyType: 'one_family',
        cemaType: 'refi_cema',
        status: 'collateral_chase',
        program: 'conventional_fannie',
        principal: '590000.00',
        loans: [
          { upb: '440000.00', chainPosition: 0 },
          { upb: '80000.00', chainPosition: 1 },
        ],
        ageDays: 4,
      },
      {
        streetAddress: 'DEMO · 425 Northern Blvd',
        city: 'Great Neck',
        county: 'Nassau',
        zipCode: '11021',
        propertyType: 'one_family',
        cemaType: 'refi_cema',
        status: 'collateral_chase',
        program: 'conventional_freddie',
        principal: '920000.00',
        loans: [{ upb: '710000.00', chainPosition: 0 }],
        ageDays: 5,
      },
      {
        streetAddress: 'DEMO · 7 Harbor View Ct',
        city: 'Port Washington',
        county: 'Nassau',
        zipCode: '11050',
        propertyType: 'pud',
        cemaType: 'purchase_cema',
        status: 'collateral_chase',
        program: 'jumbo',
        principal: '1380000.00',
        loans: [{ upb: '1040000.00', chainPosition: 0 }],
        ageDays: 5,
      },
      // ---- title_work (3) ----
      {
        streetAddress: 'DEMO · 19 Clinton Ave',
        city: 'Brooklyn',
        county: 'Kings',
        zipCode: '11205',
        propertyType: 'three_family',
        cemaType: 'refi_cema',
        status: 'title_work',
        program: 'conventional_fannie',
        principal: '1050000.00',
        loans: [{ upb: '820000.00', chainPosition: 0 }],
        ageDays: 5,
      },
      {
        streetAddress: 'DEMO · 552 W 112th St',
        city: 'New York',
        county: 'New York',
        zipCode: '10025',
        propertyType: 'condo',
        cemaType: 'refi_cema',
        status: 'title_work',
        program: 'jumbo',
        principal: '1700000.00',
        loans: [{ upb: '1280000.00', chainPosition: 0 }],
        ageDays: 6,
      },
      {
        streetAddress: 'DEMO · 35 Pinebrook Blvd',
        city: 'New Rochelle',
        county: 'Westchester',
        zipCode: '10804',
        propertyType: 'one_family',
        cemaType: 'refi_cema',
        status: 'title_work',
        program: 'conventional_freddie',
        principal: '840000.00',
        loans: [{ upb: '640000.00', chainPosition: 0 }],
        ageDays: 6,
      },
      // ---- doc_prep (3) ----
      {
        streetAddress: 'DEMO · 110 Skillman Ave',
        city: 'Queens',
        county: 'Queens',
        zipCode: '11101',
        propertyType: 'condo',
        cemaType: 'refi_cema',
        status: 'doc_prep',
        program: 'conventional_fannie',
        principal: '730000.00',
        loans: [{ upb: '555000.00', chainPosition: 0 }],
        ageDays: 6,
      },
      {
        streetAddress: 'DEMO · 2 Seagate Ter',
        city: 'Brooklyn',
        county: 'Kings',
        zipCode: '11224',
        propertyType: 'one_family',
        cemaType: 'purchase_cema',
        status: 'doc_prep',
        program: 'conventional_freddie',
        principal: '670000.00',
        loans: [{ upb: '510000.00', chainPosition: 0 }],
        ageDays: 6,
      },
      {
        streetAddress: 'DEMO · 456 Gramatan Ave',
        city: 'Mount Vernon',
        county: 'Westchester',
        zipCode: '10552',
        propertyType: 'two_family',
        cemaType: 'refi_cema',
        status: 'doc_prep',
        program: 'conventional_fannie',
        principal: '680000.00',
        loans: [{ upb: '510000.00', chainPosition: 0 }],
        ageDays: 7,
      },
      // ---- attorney_review (3) ----
      {
        streetAddress: 'DEMO · 88 Gold St',
        city: 'New York',
        county: 'New York',
        zipCode: '10038',
        propertyType: 'condo',
        cemaType: 'refi_cema',
        status: 'attorney_review',
        program: 'jumbo',
        principal: '1950000.00',
        loans: [{ upb: '1500000.00', chainPosition: 0 }],
        ageDays: 7,
      },
      {
        streetAddress: 'DEMO · 341 New Dorp Ln',
        city: 'Staten Island',
        county: 'Richmond',
        zipCode: '10306',
        propertyType: 'one_family',
        cemaType: 'refi_cema',
        status: 'attorney_review',
        program: 'conventional_fannie',
        principal: '580000.00',
        loans: [{ upb: '440000.00', chainPosition: 0 }],
        ageDays: 7,
      },
      {
        streetAddress: 'DEMO · 23 Lake Ave',
        city: 'Tuckahoe',
        county: 'Westchester',
        zipCode: '10707',
        propertyType: 'one_family',
        cemaType: 'refi_cema',
        status: 'attorney_review',
        program: 'conventional_freddie',
        principal: '760000.00',
        loans: [{ upb: '590000.00', chainPosition: 0 }],
        ageDays: 7,
      },
      // ---- closing (2) ----
      {
        streetAddress: 'DEMO · 77 Water St',
        city: 'New York',
        county: 'New York',
        zipCode: '10005',
        propertyType: 'condo',
        cemaType: 'refi_cema',
        status: 'closing',
        program: 'jumbo',
        principal: '2400000.00',
        loans: [{ upb: '1850000.00', chainPosition: 0 }],
        ageDays: 7,
      },
      {
        streetAddress: 'DEMO · 93 Quentin Rd',
        city: 'Brooklyn',
        county: 'Kings',
        zipCode: '11223',
        propertyType: 'one_family',
        cemaType: 'refi_cema',
        status: 'closing',
        program: 'conventional_fannie',
        principal: '875000.00',
        loans: [{ upb: '670000.00', chainPosition: 0 }],
        ageDays: 7,
      },
      // ---- recording (2) ----
      {
        streetAddress: 'DEMO · 16 Jay St',
        city: 'New York',
        county: 'New York',
        zipCode: '10013',
        propertyType: 'condo',
        cemaType: 'refi_cema',
        status: 'recording',
        program: 'jumbo',
        principal: '1620000.00',
        loans: [{ upb: '1250000.00', chainPosition: 0 }],
        ageDays: 7,
      },
      {
        streetAddress: 'DEMO · 5 Purdy Ave',
        city: 'Rye',
        county: 'Westchester',
        zipCode: '10580',
        propertyType: 'one_family',
        cemaType: 'refi_cema',
        status: 'recording',
        program: 'conventional_freddie',
        principal: '1100000.00',
        loans: [{ upb: '850000.00', chainPosition: 0 }],
        ageDays: 7,
      },
      // ---- completed (4) ----
      {
        streetAddress: 'DEMO · 240 Kent Ave',
        city: 'Brooklyn',
        county: 'Kings',
        zipCode: '11249',
        propertyType: 'condo',
        cemaType: 'refi_cema',
        status: 'completed',
        program: 'conventional_fannie',
        principal: '910000.00',
        loans: [{ upb: '695000.00', chainPosition: 0 }],
        ageDays: 7,
      },
      {
        streetAddress: 'DEMO · 108 W 70th St',
        city: 'New York',
        county: 'New York',
        zipCode: '10023',
        propertyType: 'condo',
        cemaType: 'refi_cema',
        status: 'completed',
        program: 'jumbo',
        principal: '3200000.00',
        loans: [{ upb: '2450000.00', chainPosition: 0 }],
        ageDays: 7,
      },
      {
        streetAddress: 'DEMO · 67 Spruce St',
        city: 'Yonkers',
        county: 'Westchester',
        zipCode: '10702',
        propertyType: 'two_family',
        cemaType: 'refi_cema',
        status: 'completed',
        program: 'conventional_freddie',
        principal: '560000.00',
        loans: [{ upb: '420000.00', chainPosition: 0 }],
        ageDays: 7,
      },
      {
        streetAddress: 'DEMO · 880 Gates Ave',
        city: 'Brooklyn',
        county: 'Kings',
        zipCode: '11221',
        propertyType: 'one_family',
        cemaType: 'purchase_cema',
        status: 'completed',
        program: 'conventional_fannie',
        principal: '720000.00',
        loans: [{ upb: '540000.00', chainPosition: 0 }],
        ageDays: 7,
      },
      // ---- exception (3) — drives the Exceptions metric ----
      {
        streetAddress: 'DEMO · 1 Metrotech Ctr',
        city: 'Brooklyn',
        county: 'Kings',
        zipCode: '11201',
        propertyType: 'condo',
        cemaType: 'refi_cema',
        status: 'exception',
        program: 'conventional_fannie',
        principal: '990000.00',
        loans: [{ upb: '760000.00', chainPosition: 0 }],
        ageDays: 3,
      },
      {
        streetAddress: 'DEMO · 55 Water St',
        city: 'New York',
        county: 'New York',
        zipCode: '10041',
        propertyType: 'condo',
        cemaType: 'refi_cema',
        status: 'exception',
        program: 'jumbo',
        principal: '1750000.00',
        loans: [{ upb: '1340000.00', chainPosition: 0 }],
        ageDays: 4,
      },
      {
        streetAddress: 'DEMO · 29 Richmond Ter',
        city: 'Staten Island',
        county: 'Richmond',
        zipCode: '10301',
        propertyType: 'one_family',
        cemaType: 'refi_cema',
        status: 'exception',
        program: 'conventional_freddie',
        principal: '630000.00',
        loans: [{ upb: '480000.00', chainPosition: 0 }],
        ageDays: 5,
      },
    ];

    // -----------------------------------------------------------------------
    // 3. Insert properties, newLoans, deals, existingLoans.
    // -----------------------------------------------------------------------
    const now = Date.now();
    const MS_PER_DAY = 86_400_000;

    const insertedDealIds: string[] = [];
    /** Indexes into DEMO_DEALS that should get chain-break rows (attorney_review status ones). */
    const chainBreakDealIdxs: number[] = [];

    for (let i = 0; i < DEMO_DEALS.length; i++) {
      const spec = DEMO_DEALS[i]!;

      const [prop] = await tx
        .insert(properties)
        .values({
          streetAddress: spec.streetAddress,
          city: spec.city,
          county: spec.county,
          zipCode: spec.zipCode,
          propertyType: spec.propertyType,
        })
        .returning({ id: properties.id });

      const [newLoan] = await tx
        .insert(newLoans)
        .values({
          organizationId: org.id,
          principal: spec.principal,
          program: spec.program,
        })
        .returning({ id: newLoans.id });

      // completedAt is required when status = 'completed' (DB CHECK).
      const completedAt =
        spec.status === 'completed' ? new Date(now - spec.ageDays * MS_PER_DAY) : null;

      const [deal] = await tx
        .insert(deals)
        .values({
          organizationId: org.id,
          cemaType: spec.cemaType,
          status: spec.status,
          propertyId: prop!.id,
          newLoanId: newLoan!.id,
          createdById: user.id,
          metadata: { demo: true },
          ...(completedAt ? { completedAt } : {}),
        })
        .returning({ id: deals.id });

      for (const loan of spec.loans) {
        await tx.insert(existingLoans).values({
          dealId: deal!.id,
          upb: loan.upb,
          chainPosition: loan.chainPosition,
        });
      }

      insertedDealIds.push(deal!.id);

      if (spec.status === 'attorney_review') {
        chainBreakDealIdxs.push(i);
      }
    }

    // -----------------------------------------------------------------------
    // 4. Insert audit_events (~120 total across all deals).
    //    Each deal gets a realistic sequence of agent actions keyed to its
    //    current status, spread across the last 7 days.
    // -----------------------------------------------------------------------

    /** Return a Date `daysAgo` days before now, with `offsetMs` jitter (ms). */
    function ts(daysAgo: number, offsetMs = 0): Date {
      return new Date(now - daysAgo * MS_PER_DAY + offsetMs);
    }

    interface AuditRow {
      organizationId: string;
      actorUserId: string;
      action: string;
      entityType: 'deal';
      entityId: string;
      metadata: Record<string, unknown>;
      occurredAt: Date;
    }

    const auditRows: AuditRow[] = [];

    for (let i = 0; i < DEMO_DEALS.length; i++) {
      const spec = DEMO_DEALS[i]!;
      const dealId = insertedDealIds[i]!;
      const base = spec.ageDays;
      const ctx = {
        organizationId: org.id,
        actorUserId: user.id,
        entityType: 'deal' as const,
        entityId: dealId,
      };

      // Every deal: deal.created + intake sequence
      auditRows.push({
        ...ctx,
        action: 'deal.created',
        metadata: { cemaType: spec.cemaType },
        occurredAt: ts(base, -9_000),
      });
      auditRows.push({
        ...ctx,
        action: 'deal.status_changed',
        metadata: { from: 'intake', to: 'eligibility' },
        occurredAt: ts(base, -8_000),
      });
      auditRows.push({
        ...ctx,
        action: 'intake.evaluated',
        metadata: { eligible: true },
        occurredAt: ts(base, -7_500),
      });
      auditRows.push({
        ...ctx,
        action: 'intake.deal_created',
        metadata: { cemaType: spec.cemaType },
        occurredAt: ts(base, -7_000),
      });

      if (spec.status === 'intake' || spec.status === 'eligibility') continue;

      // authorization+
      auditRows.push({
        ...ctx,
        action: 'deal.status_changed',
        metadata: { from: 'eligibility', to: 'authorization' },
        occurredAt: ts(base - 0.5, 0),
      });
      auditRows.push({
        ...ctx,
        action: 'internal_comm.evaluated',
        metadata: {},
        occurredAt: ts(base - 0.5, 1_000),
      });
      auditRows.push({
        ...ctx,
        action: 'internal_comm.notified',
        metadata: { status: 'authorization' },
        occurredAt: ts(base - 0.5, 2_000),
      });

      if (spec.status === 'authorization') continue;

      // collateral_chase+
      auditRows.push({
        ...ctx,
        action: 'deal.status_changed',
        metadata: { from: 'authorization', to: 'collateral_chase' },
        occurredAt: ts(base - 1, 0),
      });
      auditRows.push({
        ...ctx,
        action: 'outreach.planned',
        metadata: { touchCount: 1 },
        occurredAt: ts(base - 1, 1_000),
      });
      auditRows.push({
        ...ctx,
        action: 'outreach.touch_sent',
        metadata: { touch: 1 },
        occurredAt: ts(base - 1, 2_000),
      });
      // Second touch for some deals
      if (i % 2 === 0) {
        auditRows.push({
          ...ctx,
          action: 'outreach.touch_sent',
          metadata: { touch: 2 },
          occurredAt: ts(base - 1, 3_000),
        });
      }

      if (spec.status === 'collateral_chase') continue;

      // title_work+
      auditRows.push({
        ...ctx,
        action: 'deal.status_changed',
        metadata: { from: 'collateral_chase', to: 'title_work' },
        occurredAt: ts(base - 1.5, 0),
      });
      auditRows.push({
        ...ctx,
        action: 'idp.evaluated',
        metadata: { documentCount: 3 },
        occurredAt: ts(base - 1.5, 1_000),
      });
      auditRows.push({
        ...ctx,
        action: 'idp.classified',
        metadata: { documentCount: 3, unreadableCount: 0 },
        occurredAt: ts(base - 1.5, 2_000),
      });
      auditRows.push({
        ...ctx,
        action: 'chain.analyzed',
        metadata: { status: 'clean' },
        occurredAt: ts(base - 1.5, 3_000),
      });

      if (spec.status === 'title_work') continue;

      // doc_prep+
      auditRows.push({
        ...ctx,
        action: 'deal.status_changed',
        metadata: { from: 'title_work', to: 'doc_prep' },
        occurredAt: ts(base - 2, 0),
      });
      auditRows.push({
        ...ctx,
        action: 'docgen.evaluated',
        metadata: {},
        occurredAt: ts(base - 2, 1_000),
      });
      auditRows.push({
        ...ctx,
        action: 'docgen.generated',
        metadata: { count: 5, cemaType: spec.cemaType },
        occurredAt: ts(base - 2, 2_000),
      });

      if (spec.status === 'doc_prep') continue;

      // attorney_review+
      auditRows.push({
        ...ctx,
        action: 'deal.status_changed',
        metadata: { from: 'doc_prep', to: 'attorney_review' },
        occurredAt: ts(base - 2.5, 0),
      });
      auditRows.push({
        ...ctx,
        action: 'chain.analyzed',
        metadata: { status: 'broken', breakCount: 1 },
        occurredAt: ts(base - 2.5, 1_000),
      });
      auditRows.push({
        ...ctx,
        action: 'chain.break_routed',
        metadata: { kind: 'ambiguous_assignment' },
        occurredAt: ts(base - 2.5, 2_000),
      });

      if (spec.status === 'attorney_review') continue;

      // closing+
      auditRows.push({
        ...ctx,
        action: 'deal.status_changed',
        metadata: { from: 'attorney_review', to: 'closing' },
        occurredAt: ts(base - 3, 0),
      });
      auditRows.push({
        ...ctx,
        action: 'borrower_comm.evaluated',
        metadata: {},
        occurredAt: ts(base - 3, 1_000),
      });
      auditRows.push({
        ...ctx,
        action: 'borrower_comm.notified',
        metadata: { status: 'closing' },
        occurredAt: ts(base - 3, 2_000),
      });

      if (spec.status === 'closing') continue;

      // recording+
      auditRows.push({
        ...ctx,
        action: 'deal.status_changed',
        metadata: { from: 'closing', to: 'recording' },
        occurredAt: ts(base - 3.5, 0),
      });
      auditRows.push({
        ...ctx,
        action: 'recording.evaluated',
        metadata: {},
        occurredAt: ts(base - 3.5, 1_000),
      });
      auditRows.push({
        ...ctx,
        action: 'recording.prepared',
        metadata: { venue: 'acris' },
        occurredAt: ts(base - 3.5, 2_000),
      });

      if (spec.status === 'recording') continue;

      // completed
      if (spec.status === 'completed') {
        auditRows.push({
          ...ctx,
          action: 'deal.status_changed',
          metadata: { from: 'recording', to: 'completed' },
          occurredAt: ts(base - 4, 0),
        });
        auditRows.push({
          ...ctx,
          action: 'recording.completed',
          metadata: { crfn: '2024000012345' },
          occurredAt: ts(base - 4, 1_000),
        });
        auditRows.push({
          ...ctx,
          action: 'borrower_comm.notified',
          metadata: { status: 'completed' },
          occurredAt: ts(base - 4, 2_000),
        });
        continue;
      }

      // exception — add a dispatch-failed audit so getOrgExceptions picks it up
      if (spec.status === 'exception') {
        auditRows.push({
          ...ctx,
          action: 'deal.agent_dispatch_failed',
          metadata: { trigger: 'collateral_chase' },
          occurredAt: ts(base - 1, 0),
        });
        continue;
      }
    }

    // Bulk insert all audit rows (append-only, no conflict target needed).
    if (auditRows.length > 0) {
      // Insert in chunks of 50 to stay within param limits.
      const CHUNK = 50;
      for (let start = 0; start < auditRows.length; start += CHUNK) {
        await tx.insert(auditEvents).values(auditRows.slice(start, start + CHUNK));
      }
    }

    // -----------------------------------------------------------------------
    // 5. Insert chain_break_review_queue rows for the attorney_review deals
    //    (open = 'pending' state → drives the "chain_break" exception count).
    // -----------------------------------------------------------------------
    for (const idx of chainBreakDealIdxs) {
      const dealId = insertedDealIds[idx]!;
      await tx.insert(chainBreakReviewQueue).values({
        organizationId: org.id,
        dealId,
        breakHash: `demo${idx}abcdef01`,
        breakKind: 'ambiguous_assignment',
        reason: 'Assignment chain is ambiguous — two possible prior assignees found.',
        state: 'pending',
        submittedById: user.id,
      });
    }

    return {
      deals: DEMO_DEALS.length,
      statusCounts: Object.fromEntries(
        dealStatusEnum.enumValues.map((s) => [s, DEMO_DEALS.filter((d) => d.status === s).length]),
      ),
      auditEvents: auditRows.length,
      chainBreakRows: chainBreakDealIdxs.length,
    };
  });

  // Redirect to dashboard so the user immediately sees the seeded data.
  redirect('/dashboard');

  // TypeScript requires a return type even though redirect() never returns.
  return new Response(null, { status: 302 });
}
