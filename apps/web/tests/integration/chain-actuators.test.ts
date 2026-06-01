import type { RouteDecision } from '@cema/agents-chain-of-title';
import { auditEvents, deals, getDb, organizations, users } from '@cema/db';
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
  documentId: null,
  reason:
    'A gap in the recorded assignment sequence was detected; re-chase the servicer for the missing assignment.',
};

const attorneyDecision: RouteDecision = {
  dealId: DEAL_ID,
  kind: 'attorney_review',
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

  it('openAttorneyReview writes a PII-safe chain.break_routed audit (with documentId)', async () => {
    const deps = buildChainDeps({ organizationId: ORG_ID, actorUserId: USER_ID });

    await deps.openAttorneyReview(attorneyDecision);

    const hash = breakHash(attorneyDecision);
    const rows = await breakRoutedAuditsFor(DEAL_ID);
    const matching = rows.filter((e) => (e.metadata as { breakHash?: string }).breakHash === hash);
    expect(matching.length).toBeGreaterThanOrEqual(1);

    const row = matching[0]!;
    expect(row.entityId).toBe(DEAL_ID);
    expect(row.metadata).toEqual({
      source: 'chain-of-title',
      kind: 'attorney_review',
      documentId: ATTY_DOC_ID,
      reason: attorneyDecision.reason,
      breakHash: hash,
    });
  });
});
