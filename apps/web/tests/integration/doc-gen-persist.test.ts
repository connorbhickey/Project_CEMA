import type { PlannedDocument } from '@cema/agents-doc-gen';
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

import { hasExistingPackage, persistGeneratedDocument } from '../../lib/agents/doc-gen/persist';

const skip = !process.env.DATABASE_URL;

// Distinct UUID block (…c1/c2/c3/c4/c5) + unique clerk ids/slugs so this suite
// never collides with other Neon integration suites (see the shared-dev-branch
// parallel-flake note — run serially to verify).
const ORG_ID = '00000000-0000-0000-0000-0000000000c1';
const OTHER_ORG_ID = '00000000-0000-0000-0000-0000000000c2';
const USER_ID = '00000000-0000-0000-0000-0000000000c3';
const DEAL_ID = '00000000-0000-0000-0000-0000000000c4';
const DEAL_EMPTY_ID = '00000000-0000-0000-0000-0000000000c5';

const cema3172: PlannedDocument = {
  kind: 'cema_3172',
  attorneyReviewRequired: true,
  title: 'CEMA (NY Form 3172)',
  fields: { dealId: DEAL_ID, county: 'Kings', gap: 200000 },
};

describe.skipIf(skip)('Doc-Gen persist (Neon integration)', () => {
  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(organizations)
      .values([
        {
          id: ORG_ID,
          clerkOrgId: 'org_docgen_persist',
          name: 'DocGen Persist',
          slug: 'docgen-persist',
        },
        {
          id: OTHER_ORG_ID,
          clerkOrgId: 'org_docgen_other',
          name: 'DocGen Other',
          slug: 'docgen-other',
        },
      ])
      .onConflictDoNothing();
    await db
      .insert(users)
      .values({
        id: USER_ID,
        clerkUserId: 'user_docgen_persist',
        email: 'docgen-persist@example.invalid',
      })
      .onConflictDoNothing();
    await db
      .insert(deals)
      .values([
        {
          id: DEAL_ID,
          organizationId: ORG_ID,
          cemaType: 'refi_cema',
          status: 'doc_prep',
          createdById: USER_ID,
        },
        {
          id: DEAL_EMPTY_ID,
          organizationId: ORG_ID,
          cemaType: 'refi_cema',
          status: 'doc_prep',
          createdById: USER_ID,
        },
      ])
      .onConflictDoNothing();
  });

  afterAll(async () => {
    const db = getDb();
    // Re-runnable: drop this suite's queue rows + generated documents (order
    // matters — the queue FKs documents). audit_events is append-only (immutable).
    await db.delete(documentReviewQueue).where(eq(documentReviewQueue.organizationId, ORG_ID));
    await db.delete(documents).where(eq(documents.dealId, DEAL_ID));
  });

  it('inserts a gate-required draft document, enqueues it, and audits it (source=doc-gen)', async () => {
    await persistGeneratedDocument(ORG_ID, USER_ID, DEAL_ID, cema3172);

    const db = getDb();
    const [doc] = await db
      .select()
      .from(documents)
      .where(and(eq(documents.dealId, DEAL_ID), eq(documents.kind, 'cema_3172')));
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
    expect((matching[0]!.metadata as { source?: string }).source).toBe('doc-gen');
  });

  it('hasExistingPackage: true once a cema_3172 exists, false for an empty deal, false cross-org (RLS)', async () => {
    expect(await hasExistingPackage(ORG_ID, DEAL_ID)).toBe(true); // case 1 inserted the anchor
    expect(await hasExistingPackage(ORG_ID, DEAL_EMPTY_ID)).toBe(false);
    // RLS isolation: another org cannot see this deal's documents.
    expect(await hasExistingPackage(OTHER_ORG_ID, DEAL_ID)).toBe(false);
  });
});
