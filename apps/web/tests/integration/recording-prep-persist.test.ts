import type { PlannedCoverSheet } from '@cema/agents-recording-prep';
import {
  auditEvents,
  deals,
  documentReviewQueue,
  documents,
  getDb,
  organizations,
  users,
} from '@cema/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  hasExistingRecordingPackage,
  persistCoverSheet,
  persistRecordingCoordinates,
} from '../../lib/agents/recording-prep/persist';

const skip = !process.env.DATABASE_URL;

// Distinctive `4ec04d00-…` ("record") UUID prefix + matching `recprep4` clerk
// ids/slugs/emails across the WHOLE namespace, so no unique field collides with a
// row already on the shared Neon dev branch. Sequential last-byte blocks (…00f8)
// collide silently under onConflictDoNothing — deal …00f8 already belongs to
// another suite's org, which surfaces as a baffling RLS 42501 on the documents
// insert. NEVER re-point these across runs (see the shared-dev-branch hazard memo).
const ORG_ID = '4ec04d00-0000-0000-0000-000000000001';
const OTHER_ORG_ID = '4ec04d00-0000-0000-0000-000000000002';
const USER_ID = '4ec04d00-0000-0000-0000-000000000003';
const DEAL_ID = '4ec04d00-0000-0000-0000-000000000004';

const countySheet: PlannedCoverSheet = {
  kind: 'county_cover_sheet',
  attorneyReviewRequired: true,
  title: 'County Clerk Recording Cover Sheet',
  fields: { dealId: DEAL_ID, venue: 'county', county: 'Nassau', total: 595 },
};
const acrisSheet: PlannedCoverSheet = {
  kind: 'acris_cover_pages',
  attorneyReviewRequired: false,
  title: 'ACRIS Recording & Endorsement Cover Pages',
  fields: { dealId: DEAL_ID, venue: 'acris', county: 'Kings', total: 240 },
};

describe.skipIf(skip)('Recording Prep persist (Neon integration)', () => {
  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(organizations)
      .values([
        {
          id: ORG_ID,
          clerkOrgId: 'recprep4_org',
          name: 'RecPrep4 Persist',
          slug: 'recprep4-org',
        },
        {
          id: OTHER_ORG_ID,
          clerkOrgId: 'recprep4_other',
          name: 'RecPrep4 Other',
          slug: 'recprep4-other',
        },
      ])
      .onConflictDoNothing();
    await db
      .insert(users)
      .values({
        id: USER_ID,
        clerkUserId: 'recprep4_user',
        email: 'recprep4-user@example.invalid',
      })
      .onConflictDoNothing();
    await db
      .insert(deals)
      .values({
        id: DEAL_ID,
        organizationId: ORG_ID,
        cemaType: 'refi_cema',
        status: 'recording',
        createdById: USER_ID,
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    const db = getDb();
    // Re-runnable: drop this suite's queue rows + cover-sheet documents (order
    // matters — the queue FKs documents). audit_events is append-only (immutable).
    await db.delete(documentReviewQueue).where(eq(documentReviewQueue.organizationId, ORG_ID));
    await db.delete(documents).where(eq(documents.dealId, DEAL_ID));
  });

  it('inserts a gate-required draft county_cover_sheet, enqueues it, and audits it (source=recording-prep)', async () => {
    await persistCoverSheet(ORG_ID, USER_ID, DEAL_ID, countySheet);

    const db = getDb();
    const [doc] = await db
      .select()
      .from(documents)
      .where(and(eq(documents.dealId, DEAL_ID), eq(documents.kind, 'county_cover_sheet')));
    expect(doc).toBeDefined();
    expect(doc!.attorneyReviewRequired).toBe(true);
    expect(doc!.status).toBe('draft');
    expect(doc!.blobUrl).toBeNull();

    const queue = await db
      .select()
      .from(documentReviewQueue)
      .where(eq(documentReviewQueue.documentId, doc!.id));
    expect(queue).toHaveLength(1);
    expect(queue[0]!.state).toBe('pending');
    expect(queue[0]!.submittedById).toBe(USER_ID);

    const events = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, 'document.submitted_for_review'),
          eq(auditEvents.entityId, doc!.id),
        ),
      );
    const matching = events.filter(
      (e) => (e.metadata as { queueId?: string } | null)?.queueId === queue[0]!.id,
    );
    expect(matching).toHaveLength(1);
    expect((matching[0]!.metadata as { source?: string }).source).toBe('recording-prep');
  });

  it('inserts a non-gated acris_cover_pages without enqueuing it', async () => {
    await persistCoverSheet(ORG_ID, USER_ID, DEAL_ID, acrisSheet);

    const db = getDb();
    const [doc] = await db
      .select()
      .from(documents)
      .where(and(eq(documents.dealId, DEAL_ID), eq(documents.kind, 'acris_cover_pages')));
    expect(doc).toBeDefined();
    expect(doc!.attorneyReviewRequired).toBe(false);

    const queue = await db
      .select()
      .from(documentReviewQueue)
      .where(eq(documentReviewQueue.documentId, doc!.id));
    expect(queue).toHaveLength(0);
  });

  it('persistRecordingCoordinates writes deals.metadata.recording (reel/page)', async () => {
    await persistRecordingCoordinates(
      ORG_ID,
      DEAL_ID,
      'county',
      { reelPage: 'R123-P45', crfn: null },
      '2026-06-02T00:00:00.000Z',
    );

    const db = getDb();
    const [deal] = await db.select().from(deals).where(eq(deals.id, DEAL_ID));
    const recording = (deal!.metadata as { recording?: Record<string, unknown> }).recording;
    expect(recording).toMatchObject({
      venue: 'county',
      reelPage: 'R123-P45',
      crfn: null,
      recordedAt: '2026-06-02T00:00:00.000Z',
    });
  });

  it('rejects coordinates carrying both reelPage and crfn (XOR invariant)', async () => {
    await expect(
      persistRecordingCoordinates(ORG_ID, DEAL_ID, 'county', { reelPage: 'x', crfn: 'y' }, 't'),
    ).rejects.toThrow();
  });

  it('hasExistingRecordingPackage: true same-org once a cover sheet exists, false cross-org (RLS)', async () => {
    expect(await hasExistingRecordingPackage(ORG_ID, DEAL_ID)).toBe(true);
    // RLS isolation: another org cannot see this deal's documents.
    expect(await hasExistingRecordingPackage(OTHER_ORG_ID, DEAL_ID)).toBe(false);
  });
});
