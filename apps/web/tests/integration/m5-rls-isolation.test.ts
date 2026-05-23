// apps/web/tests/integration/m5-rls-isolation.test.ts
/**
 * RLS multi-tenant isolation for M5 tables.
 *
 * Two tables × {Org A sees own (positive control), Org B does NOT see Org A row}.
 * 3 assertions total (1 negative per table + 1 positive control).
 */

import {
  auditEventReads,
  deals,
  documentReviewQueue,
  documents,
  getDb,
  organizations,
  users,
} from '@cema/db';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withRls } from '../../lib/with-rls';

const ORG_A_ID = '00000000-0000-0000-0000-0000000000a8';
const ORG_B_ID = '00000000-0000-0000-0000-0000000000b8';
const USER_ID = '00000000-0000-0000-0000-000000000098';
const DEAL_ID = '00000000-0000-0000-0000-0000000000e8';
const DOC_ID = '00000000-0000-0000-0000-0000000000d8';

const skip = !process.env.DATABASE_URL;

let queueRowId: string;
let auditRowId: string;

describe.skipIf(skip)('RLS — M5 tables cross-org isolation', () => {
  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(organizations)
      .values([
        { id: ORG_A_ID, clerkOrgId: 'org_m5_rls_a', name: 'Org A (M5)', slug: 'm5-rls-org-a' },
        { id: ORG_B_ID, clerkOrgId: 'org_m5_rls_b', name: 'Org B (M5)', slug: 'm5-rls-org-b' },
      ])
      .onConflictDoNothing();
    await db
      .insert(users)
      .values({ id: USER_ID, clerkUserId: 'user_m5_rls', email: 'm5-rls@example.invalid' })
      .onConflictDoNothing();
    await db
      .insert(deals)
      .values({
        id: DEAL_ID,
        organizationId: ORG_A_ID,
        cemaType: 'refi_cema',
        status: 'doc_prep',
        createdById: USER_ID,
      })
      .onConflictDoNothing();
    await db
      .insert(documents)
      .values({
        id: DOC_ID,
        dealId: DEAL_ID,
        kind: 'cema_3172',
        status: 'draft',
        attorneyReviewRequired: true,
        version: 1,
      })
      .onConflictDoNothing();

    const [queueRow] = await db
      .insert(documentReviewQueue)
      .values({
        organizationId: ORG_A_ID,
        documentId: DOC_ID,
        documentVersion: 1,
        submittedById: USER_ID,
        state: 'pending',
      })
      .returning();
    queueRowId = queueRow!.id;

    const [auditRow] = await db
      .insert(auditEventReads)
      .values({
        organizationId: ORG_A_ID,
        actorUserId: USER_ID,
        entityType: 'communication',
        entityId: '00000000-0000-0000-0000-000000000099',
        purpose: 'view_detail',
      })
      .returning();
    auditRowId = auditRow!.id;
  });

  afterAll(async () => {
    const db = getDb();
    await db.delete(auditEventReads).where(eq(auditEventReads.id, auditRowId));
    await db.delete(documentReviewQueue).where(eq(documentReviewQueue.id, queueRowId));
    await db.delete(documents).where(eq(documents.id, DOC_ID));
    await db.delete(deals).where(eq(deals.id, DEAL_ID));
    await db.delete(users).where(eq(users.id, USER_ID));
    await db.delete(organizations).where(inArray(organizations.id, [ORG_A_ID, ORG_B_ID]));
  });

  it('Org B cannot SELECT Org A document_review_queue rows', async () => {
    const rows = await withRls(ORG_B_ID, (tx) =>
      tx
        .select({ id: documentReviewQueue.id })
        .from(documentReviewQueue)
        .where(eq(documentReviewQueue.id, queueRowId)),
    );
    expect(rows).toHaveLength(0);
  });

  it('Org B cannot SELECT Org A audit_event_reads rows', async () => {
    const rows = await withRls(ORG_B_ID, (tx) =>
      tx
        .select({ id: auditEventReads.id })
        .from(auditEventReads)
        .where(eq(auditEventReads.id, auditRowId)),
    );
    expect(rows).toHaveLength(0);
  });

  it('Org A sees its own document_review_queue row (positive control)', async () => {
    const rows = await withRls(ORG_A_ID, (tx) =>
      tx
        .select({ id: documentReviewQueue.id })
        .from(documentReviewQueue)
        .where(eq(documentReviewQueue.id, queueRowId)),
    );
    expect(rows).toHaveLength(1);
  });
});
