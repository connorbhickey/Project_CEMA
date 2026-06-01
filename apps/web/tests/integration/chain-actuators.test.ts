import type { RouteDecision } from '@cema/agents-chain-of-title';
import {
  auditEvents,
  chainBreakReviewQueue,
  deals,
  documents,
  getDb,
  organizations,
  users,
} from '@cema/db';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { breakHash } from '../../lib/agents/chain-of-title/break-hash';
import { buildChainDeps } from '../../lib/agents/chain-of-title/deps';

const skip = !process.env.DATABASE_URL;

// Distinct UUID block (…ac/…9c/…ec/…dc) so this suite never collides with
// idp-auto-enqueue (…a8/…98/…e8/…d8/…d9), deal-review-surface (…a1/…d1/…d2),
// or attorney-review-flow (…a7/…d7).
const ORG_ID = '00000000-0000-0000-0000-0000000000ac';
const USER_ID = '00000000-0000-0000-0000-00000000009c';
const DEAL_ID = '00000000-0000-0000-0000-0000000000ec';
const ATTY_DOC_ID = '00000000-0000-0000-0000-0000000000dc';

// A re_chase break is a gap in the assignment sequence -- it has no document
// (documentId: null); an attorney_review break attaches to a specific document.
// Both reasons are the static PII-free templates route() emits (route.ts) -- no
// party names ever reach a RouteDecision.reason.
const reChaseDecision: RouteDecision = {
  dealId: DEAL_ID,
  kind: 're_chase',
  breakKind: 'missing_assignment',
  documentId: null,
  reason:
    'A gap in the recorded assignment sequence was detected; re-chase the servicer for the missing assignment.',
};

const attorneyDecision: RouteDecision = {
  dealId: DEAL_ID,
  kind: 'attorney_review',
  breakKind: 'lost_note',
  documentId: ATTY_DOC_ID,
  reason:
    'A promissory note has no anchoring mortgage; attorney review required (possible lost-note affidavit).',
};

async function breakRoutedAuditsFor(dealId: string) {
  const db = getDb();
  return db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.action, 'chain.break_routed'), eq(auditEvents.entityId, dealId)));
}

describe.skipIf(skip)('Chain-of-Title route actuators (Neon integration)', () => {
  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(organizations)
      .values({
        id: ORG_ID,
        clerkOrgId: 'org_chain_actuators',
        name: 'Chain Actuators',
        slug: 'chain-actuators',
      })
      .onConflictDoNothing();
    await db
      .insert(users)
      .values({
        id: USER_ID,
        clerkUserId: 'user_chain_actuators',
        email: 'chain-actuators@example.invalid',
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
    // The attorney_review break attaches to a real document — chain_break_review_queue
    // .document_id FKs documents.id. In production this id is always an IDP-persisted
    // document; here we seed it so the enqueue's FK is satisfied.
    await db
      .insert(documents)
      .values({
        id: ATTY_DOC_ID,
        dealId: DEAL_ID,
        kind: 'note',
        status: 'draft',
        attorneyReviewRequired: false,
        version: 1,
      })
      .onConflictDoNothing();
  });

  // audit_events is append-only (immutability trigger) and breakHash is
  // deterministic, so re-runs accumulate identical rows -- assert "at least one
  // row with exactly this PII-safe metadata exists", not an exact count.
  it('routeReChase writes a PII-safe chain.break_routed audit (null documentId)', async () => {
    const deps = buildChainDeps({ organizationId: ORG_ID, actorUserId: USER_ID });

    await deps.routeReChase(reChaseDecision);

    const hash = breakHash(reChaseDecision);
    const rows = await breakRoutedAuditsFor(DEAL_ID);
    const matching = rows.filter((e) => (e.metadata as { breakHash?: string }).breakHash === hash);
    expect(matching.length).toBeGreaterThanOrEqual(1);

    const row = matching[0]!;
    expect(row.organizationId).toBe(ORG_ID);
    expect(row.actorUserId).toBe(USER_ID);
    expect(row.entityType).toBe('deal');
    expect(row.entityId).toBe(DEAL_ID);
    expect(row.metadata).toEqual({
      source: 'chain-of-title',
      kind: 're_chase',
      documentId: null,
      reason: reChaseDecision.reason,
      breakHash: hash,
    });
    // PII-safety: metadata carries only these literal/id fields -- never a party
    // name (assignor/assignee) or a ChainBreak.detail.
    expect(Object.keys(row.metadata).sort()).toEqual([
      'breakHash',
      'documentId',
      'kind',
      'reason',
      'source',
    ]);
  });

  it('openAttorneyReview enqueues a chain_break_review_queue row (Tier 2)', async () => {
    const deps = buildChainDeps({ organizationId: ORG_ID, actorUserId: USER_ID });
    const db = getDb();
    const hash = breakHash(attorneyDecision);

    await deps.openAttorneyReview(attorneyDecision);

    const rows = await db
      .select()
      .from(chainBreakReviewQueue)
      .where(
        and(eq(chainBreakReviewQueue.dealId, DEAL_ID), eq(chainBreakReviewQueue.breakHash, hash)),
      );
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.state).toBe('pending');
    expect(row.breakKind).toBe('lost_note');
    expect(row.documentId).toBe(ATTY_DOC_ID);
    expect(row.reason).toBe(attorneyDecision.reason);
    expect(row.submittedById).toBe(USER_ID);
    expect(row.organizationId).toBe(ORG_ID);
    expect(row.reviewerId).toBeNull();
    expect(row.decidedAt).toBeNull();
    expect(row.resolutionNote).toBeNull();
  });

  it('openAttorneyReview audits with a queueId only on a real insert (idempotent replay)', async () => {
    const deps = buildChainDeps({ organizationId: ORG_ID, actorUserId: USER_ID });
    const db = getDb();
    const hash = breakHash(attorneyDecision);

    // Ensure the row exists (onConflictDoNothing makes this idempotent across
    // runs) and capture its id.
    await deps.openAttorneyReview(attorneyDecision);
    const [row] = await db
      .select()
      .from(chainBreakReviewQueue)
      .where(
        and(eq(chainBreakReviewQueue.dealId, DEAL_ID), eq(chainBreakReviewQueue.breakHash, hash)),
      );
    expect(row).toBeDefined();

    const auditsForHash = async () =>
      (await breakRoutedAuditsFor(DEAL_ID)).filter(
        (e) => (e.metadata as { breakHash?: string }).breakHash === hash,
      );

    // Replay: the row already exists -> onConflictDoNothing -> no insert -> no
    // new audit. The count must not grow (idempotent). NOTE: audit_events is
    // append-only, so older Tier-1 audits (no queueId) may also match this hash;
    // we therefore identify "our" audit by queueId rather than by position.
    const before = await auditsForHash();
    await deps.openAttorneyReview(attorneyDecision);
    const after = await auditsForHash();
    expect(after.length).toBe(before.length);

    // The real-insert audit (whenever it fired) carries the queueId + PII-safe
    // metadata, and nothing else.
    const tagged = after.find((e) => (e.metadata as { queueId?: string }).queueId === row!.id);
    expect(tagged).toBeDefined();
    expect(tagged!.metadata).toEqual({
      source: 'chain-of-title',
      kind: 'attorney_review',
      documentId: ATTY_DOC_ID,
      reason: attorneyDecision.reason,
      breakHash: hash,
      queueId: row!.id,
    });
  });
});
