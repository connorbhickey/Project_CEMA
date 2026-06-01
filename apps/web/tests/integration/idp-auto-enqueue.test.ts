import type { ClassifiedDoc, IdpAdapter } from '@cema/agents-collateral-idp';
import type { InstrumentRecord } from '@cema/collateral';
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

import { buildIdpDeps } from '../../lib/agents/collateral-idp/deps';

const skip = !process.env.DATABASE_URL;

// Distinct UUID block (…a8/…98/…e8/…d8/…d9) so this suite never collides with
// deal-review-surface (…a1/…d1/…d2) or attorney-review-flow (…a7/…d7).
const ORG_ID = '00000000-0000-0000-0000-0000000000a8';
const USER_ID = '00000000-0000-0000-0000-000000000098';
const DEAL_ID = '00000000-0000-0000-0000-0000000000e8';
const DOC_AOM = '00000000-0000-0000-0000-0000000000d8'; // gate-required (aom)
const DOC_MORT = '00000000-0000-0000-0000-0000000000d9'; // non-gate (mortgage)

// persistDocuments never touches the adapter (classify/extract already ran in
// the core); a no-op stub satisfies the IdpAdapter type.
const stubIdp: IdpAdapter = {
  extractDocuments: () => Promise.resolve([]),
};

function inst(
  documentId: string,
  instrumentKind: InstrumentRecord['instrumentKind'],
): InstrumentRecord {
  return {
    documentId,
    instrumentKind,
    assignor: null,
    assignee: null,
    executedAt: null,
    recordedAt: null,
    amount: null,
    recordingRef: { reelPage: null, crfn: `crfn-${documentId}` },
    county: null,
    references: null,
  };
}

function classified(
  documentId: string,
  kind: ClassifiedDoc['kind'],
  attorneyReviewRequired: boolean,
  instrumentKind: InstrumentRecord['instrumentKind'],
): ClassifiedDoc {
  return { documentId, kind, attorneyReviewRequired, instrument: inst(documentId, instrumentKind) };
}

async function queueRowsFor(documentId: string) {
  const db = getDb();
  return db
    .select()
    .from(documentReviewQueue)
    .where(eq(documentReviewQueue.documentId, documentId));
}

describe.skipIf(skip)('IDP auto-enqueue (Neon integration)', () => {
  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(organizations)
      .values({
        id: ORG_ID,
        clerkOrgId: 'org_idp_enqueue',
        name: 'IDP Enqueue',
        slug: 'idp-enqueue',
      })
      .onConflictDoNothing();
    await db
      .insert(users)
      .values({
        id: USER_ID,
        clerkUserId: 'user_idp_enqueue',
        email: 'idp-enqueue@example.invalid',
      })
      .onConflictDoNothing();
    await db
      .insert(deals)
      .values({
        id: DEAL_ID,
        organizationId: ORG_ID,
        cemaType: 'refi_cema',
        status: 'title_work',
        createdById: USER_ID,
      })
      .onConflictDoNothing();
    await db
      .insert(documents)
      .values([
        {
          id: DOC_AOM,
          dealId: DEAL_ID,
          kind: 'aom',
          status: 'draft',
          attorneyReviewRequired: true,
          version: 1,
        },
        {
          id: DOC_MORT,
          dealId: DEAL_ID,
          kind: 'mortgage',
          status: 'draft',
          attorneyReviewRequired: false,
          version: 1,
        },
      ])
      .onConflictDoNothing();
  });

  afterAll(async () => {
    const db = getDb();
    // Only queue rows are safely deletable (audit_events is append-only via an
    // immutability trigger). Stable UUIDs + onConflictDoNothing make the suite
    // re-runnable; deleting the queue rows resets the unique-index state so the
    // idempotency case starts from a known-empty queue on every run.
    await db.delete(documentReviewQueue).where(eq(documentReviewQueue.organizationId, ORG_ID));
  });

  it('enqueues gate-required docs (pending, submittedById=actor) and skips non-gate docs', async () => {
    const deps = buildIdpDeps({ organizationId: ORG_ID, actorUserId: USER_ID, idp: stubIdp });

    await deps.persistDocuments(DEAL_ID, [
      classified(DOC_AOM, 'aom', true, 'aom'),
      classified(DOC_MORT, 'mortgage', false, 'mortgage'),
    ]);

    const aomRows = await queueRowsFor(DOC_AOM);
    expect(aomRows).toHaveLength(1);
    expect(aomRows[0]!.state).toBe('pending');
    expect(aomRows[0]!.submittedById).toBe(USER_ID);
    expect(aomRows[0]!.documentVersion).toBe(1);
    expect(aomRows[0]!.organizationId).toBe(ORG_ID);

    // Non-gate docs must never enter the attorney review queue.
    const mortRows = await queueRowsFor(DOC_MORT);
    expect(mortRows).toHaveLength(0);
  });

  it('emits a document.submitted_for_review audit keyed to the new queue row', async () => {
    const [row] = await queueRowsFor(DOC_AOM);
    expect(row).toBeDefined();

    const db = getDb();
    const events = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, 'document.submitted_for_review'),
          eq(auditEvents.entityId, DOC_AOM),
        ),
      );
    // The audit references the freshly-created queue row id (regenerated each
    // run because afterAll deletes queue rows), so exactly one matches this run.
    const matching = events.filter(
      (e) => (e.metadata as { queueId?: string } | null)?.queueId === row!.id,
    );
    expect(matching).toHaveLength(1);
    expect((matching[0]!.metadata as { source?: string }).source).toBe('collateral-idp');
  });

  it('is idempotent — re-running persistDocuments does not duplicate the queue row', async () => {
    const deps = buildIdpDeps({ organizationId: ORG_ID, actorUserId: USER_ID, idp: stubIdp });

    // First run already happened in the test above; run twice more.
    await deps.persistDocuments(DEAL_ID, [classified(DOC_AOM, 'aom', true, 'aom')]);
    await deps.persistDocuments(DEAL_ID, [classified(DOC_AOM, 'aom', true, 'aom')]);

    const aomRows = await queueRowsFor(DOC_AOM);
    expect(aomRows).toHaveLength(1);
  });
});
