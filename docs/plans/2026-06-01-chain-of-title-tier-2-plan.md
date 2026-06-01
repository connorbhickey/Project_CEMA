# Chain-of-Title Tier 2 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans (inline) or
> superpowers:subagent-driven-development to implement task-by-task. Steps use checkbox
> (`- [ ]`) syntax. Spec: `docs/plans/2026-06-01-chain-of-title-tier-2.md`.

**Goal:** Make the Chain-of-Title agent's `attorney_review` findings durable and actionable via a
dedicated review queue + deal-scoped attorney UI.

**Architecture:** A new `chain_break_review_queue` table (attorney_review items only, keyed
`(deal_id, break_hash)`); a sibling review state machine in `@cema/attorney`; the existing
`openAttorneyReview` actuator becomes an idempotent enqueue (mirroring the IDP auto-enqueue);
deal-scoped claim/release/resolve/dismiss actions on the Slice 3 surface. `re_chase` is unchanged
(the pipeline already hands off to Outreach — §4.2 of the spec).

**Tech Stack:** Drizzle + Neon Postgres (RLS), Next.js 16 Server Actions / RSC, Vitest, `@cema/compliance` audit.

---

## Task 1: DB schema — enum + `chain_break_review_queue` table + migration `0031`

**Files:**

- Modify: `packages/db/src/schema/enums.ts` (add enum)
- Create: `packages/db/src/schema/chain-break-review-queue.ts`
- Modify: `packages/db/src/schema/index.ts` (add export)
- Generate: `packages/db/migrations/0031_*.sql` (via `pnpm db:generate`), then hand-append RLS

- [ ] **Step 1: Add the enum** to `enums.ts` (after `documentReviewStateEnum`):

```ts
export const chainBreakReviewStateEnum = pgEnum('chain_break_review_state', [
  'pending',
  'claimed',
  'resolved',
  'dismissed',
]);
```

- [ ] **Step 2: Create the schema file** `chain-break-review-queue.ts`:

```ts
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { deals } from './deals';
import { documents } from './documents';
import { chainBreakReviewStateEnum } from './enums';
import { organizations, users } from './tenants';

// ---------------------------------------------------------------------------
// chain_break_review_queue — Chain-of-Title Tier 2 attorney review queue.
//
// One row per attorney-routed chain break (lost_note, ambiguous_assignment,
// unrecorded_instrument). re_chase breaks are NOT stored here — they hand off
// to the Servicer Outreach Agent via the collateral pipeline.
//
// State machine (packages/attorney/src/chain-break-state.ts):
//   pending → claimed → resolved | dismissed   (claimed → pending releases)
//
// One row per (deal_id, break_hash) — idempotent enqueue from the
// openAttorneyReview actuator. break_hash is the deterministic PII-safe id from
// apps/web/lib/agents/chain-of-title/break-hash.ts.
// ---------------------------------------------------------------------------
export const chainBreakReviewQueue = pgTable(
  'chain_break_review_queue',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    dealId: uuid('deal_id')
      .notNull()
      .references(() => deals.id, { onDelete: 'restrict' }),
    breakHash: text('break_hash').notNull(),
    breakKind: text('break_kind').notNull(),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'restrict' }),
    reason: text('reason').notNull(),
    state: chainBreakReviewStateEnum('state').notNull().default('pending'),
    submittedById: uuid('submitted_by_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).defaultNow().notNull(),
    reviewerId: uuid('reviewer_id').references(() => users.id, { onDelete: 'set null' }),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    resolutionNote: text('resolution_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [
    uniqueIndex('chain_break_review_queue_deal_break_uidx').on(t.dealId, t.breakHash),
    index('chain_break_review_queue_org_state_idx').on(t.organizationId, t.state),
    index('chain_break_review_queue_reviewer_idx').on(t.reviewerId),
    check(
      'chain_break_review_queue_decided_at_requires_terminal',
      sql`(${t.decidedAt} IS NULL) OR (${t.state} IN ('resolved', 'dismissed'))`,
    ),
    check(
      'chain_break_review_queue_resolution_note_requires_terminal',
      sql`(${t.resolutionNote} IS NULL) OR (${t.state} IN ('resolved', 'dismissed'))`,
    ),
    check(
      'chain_break_review_queue_break_kind_is_attorney_routed',
      sql`${t.breakKind} IN ('lost_note', 'ambiguous_assignment', 'unrecorded_instrument')`,
    ),
  ],
);
```

- [ ] **Step 3: Export** — add `export * from './chain-break-review-queue';` to `index.ts` (after the `document-review-queue` line).

- [ ] **Step 4: Generate migration** — `cmd /c "pnpm db:generate"`. Expect a new `packages/db/migrations/0031_*.sql` creating the enum, table, indexes, checks.

- [ ] **Step 5: Hand-append the RLS policy** to the generated `0031_*.sql` (Drizzle doesn't gen our dynamic policy — mirror `0028_rls_m5.sql`):

```sql
ALTER TABLE chain_break_review_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY chain_break_review_queue_org_isolation ON chain_break_review_queue
  USING (organization_id::text = current_setting('app.current_organization_id', true));
```

- [ ] **Step 6: Typecheck** — `cmd /c "pnpm --filter @cema/db typecheck"`. Expected: PASS.

- [ ] **Step 7: Commit** — `git add packages/db && git commit -S -m "feat(m14): chain_break_review_queue schema + migration 0031"`.

> Neon-gated migration up/down test runs in Task 5's integration pass (needs `DATABASE_URL`).

---

## Task 2: Chain-break review state machine (`@cema/attorney`)

**Files:**

- Create: `packages/attorney/src/chain-break-state.ts`
- Create: `packages/attorney/src/chain-break-state.test.ts`
- Modify: `packages/attorney/src/index.ts` (export)

- [ ] **Step 1: Write the failing test** `chain-break-state.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  canTransitionChainBreak,
  isTerminalChainBreak,
  validChainBreakTransitions,
} from './chain-break-state';

describe('chain-break review state machine', () => {
  it('allows pending → claimed', () => {
    expect(canTransitionChainBreak('pending', 'claimed')).toBe(true);
  });
  it('allows claimed → pending | resolved | dismissed', () => {
    expect(canTransitionChainBreak('claimed', 'pending')).toBe(true);
    expect(canTransitionChainBreak('claimed', 'resolved')).toBe(true);
    expect(canTransitionChainBreak('claimed', 'dismissed')).toBe(true);
  });
  it('forbids pending → resolved (must claim first)', () => {
    expect(canTransitionChainBreak('pending', 'resolved')).toBe(false);
  });
  it('forbids any transition out of terminal states', () => {
    expect(validChainBreakTransitions('resolved')).toEqual([]);
    expect(validChainBreakTransitions('dismissed')).toEqual([]);
  });
  it('classifies terminal states', () => {
    expect(isTerminalChainBreak('resolved')).toBe(true);
    expect(isTerminalChainBreak('dismissed')).toBe(true);
    expect(isTerminalChainBreak('pending')).toBe(false);
    expect(isTerminalChainBreak('claimed')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `cmd /c "pnpm --filter @cema/attorney test"`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `chain-break-state.ts` (mirror `state.ts`):

```ts
// Chain-of-Title Tier 2 review queue state machine. Sibling to state.ts (the
// document-review machine) — kept separate so the gate-critical document path
// is untouched. resolved = defect remedied; dismissed = not a real defect.
export type ChainBreakReviewState = 'pending' | 'claimed' | 'resolved' | 'dismissed';

const TRANSITIONS: Record<ChainBreakReviewState, ChainBreakReviewState[]> = {
  pending: ['claimed'],
  claimed: ['pending', 'resolved', 'dismissed'],
  resolved: [],
  dismissed: [],
};

export function canTransitionChainBreak(
  from: ChainBreakReviewState,
  to: ChainBreakReviewState,
): boolean {
  return TRANSITIONS[from].includes(to);
}

export function validChainBreakTransitions(from: ChainBreakReviewState): ChainBreakReviewState[] {
  return [...TRANSITIONS[from]];
}

export function isTerminalChainBreak(state: ChainBreakReviewState): boolean {
  return state === 'resolved' || state === 'dismissed';
}
```

- [ ] **Step 4: Export** — add to `packages/attorney/src/index.ts`: `export * from './chain-break-state';`

- [ ] **Step 5: Run tests, verify pass** — `cmd /c "pnpm --filter @cema/attorney test"`. Expected: PASS.

- [ ] **Step 6: Commit** — `git add packages/attorney && git commit -S -m "feat(m14): chain-break review state machine"`.

---

## Task 3: Pure audit-metadata helper (the "note never audited" invariant)

**Files:**

- Create: `apps/web/lib/agents/chain-of-title/chain-break-audit.ts`
- Create: `apps/web/lib/agents/chain-of-title/chain-break-audit.test.ts`

- [ ] **Step 1: Write the failing test**:

```ts
import { describe, expect, it } from 'vitest';

import { chainBreakAuditMetadata } from './chain-break-audit';

describe('chainBreakAuditMetadata', () => {
  const row = {
    breakHash: 'abcd1234',
    breakKind: 'lost_note',
    reviewerId: 'user-1',
  };

  it('includes PII-safe fields only', () => {
    expect(chainBreakAuditMetadata(row, 'pending', 'claimed')).toEqual({
      source: 'chain-of-title',
      breakHash: 'abcd1234',
      breakKind: 'lost_note',
      fromState: 'pending',
      toState: 'claimed',
    });
  });

  it('never includes a resolution note even if present on input', () => {
    const withNote = { ...row, resolutionNote: 'Smith v. Jones — original note located in vault' };
    const meta = chainBreakAuditMetadata(withNote, 'claimed', 'resolved');
    expect(Object.values(meta).join(' ')).not.toContain('Smith');
    expect(meta).not.toHaveProperty('resolutionNote');
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `cmd /c "pnpm --filter web test chain-break-audit"`. Expected: FAIL.

- [ ] **Step 3: Implement** `chain-break-audit.ts`:

```ts
import type { ChainBreakReviewState } from '@cema/attorney';

/**
 * PII-safe audit metadata for a chain-break review transition. Pure + node-
 * testable (no Server-Action mocking). The resolution_note is attorney free-text
 * that MAY contain party names (hard rule #3) — it is DELIBERATELY excluded here
 * and must never reach an audit event or an OTel span attribute.
 */
export function chainBreakAuditMetadata(
  row: { breakHash: string; breakKind: string },
  fromState: ChainBreakReviewState,
  toState: ChainBreakReviewState,
): {
  source: 'chain-of-title';
  breakHash: string;
  breakKind: string;
  fromState: string;
  toState: string;
} {
  return {
    source: 'chain-of-title',
    breakHash: row.breakHash,
    breakKind: row.breakKind,
    fromState,
    toState,
  };
}
```

- [ ] **Step 4: Run tests, verify pass** — Expected: PASS.

- [ ] **Step 5: Commit** — `git add apps/web/lib/agents/chain-of-title/chain-break-audit.* && git commit -S -m "feat(m14): PII-safe chain-break audit metadata helper"`.

---

## Task 4: Pure merge core (live findings ∪ persisted rows)

**Files:**

- Create: `apps/web/lib/agents/chain-of-title/merge-chain-review.ts`
- Create: `apps/web/lib/agents/chain-of-title/merge-chain-review.test.ts`

Defines the view-model type `ChainReviewItem` and `mergeChainReview`. Uses `breakHash` (existing) and
a minimal `ChainBreakReviewRow` shape (the persisted-row fields the UI needs).

- [ ] **Step 1: Write the failing test**:

```ts
import type { RouteDecision } from '@cema/agents-chain-of-title';
import { describe, expect, it } from 'vitest';

import { breakHash } from './break-hash';
import { mergeChainReview, type ChainBreakReviewRow } from './merge-chain-review';

const decision = (documentId: string | null, reason: string): RouteDecision => ({
  dealId: 'deal-1',
  kind: 'attorney_review',
  documentId,
  reason,
});

const row = (over: Partial<ChainBreakReviewRow> & { breakHash: string }): ChainBreakReviewRow => ({
  id: 'q1',
  breakHash: over.breakHash,
  breakKind: 'lost_note',
  state: 'pending',
  reviewerId: null,
  ...over,
});

describe('mergeChainReview', () => {
  it('joins a live attorney_review finding to its persisted row by breakHash', () => {
    const d = decision('doc-1', 'Orphaned note with no recorded anchor.');
    const r = row({ breakHash: breakHash(d) });
    const result = mergeChainReview([d], [r]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].review?.id).toBe('q1');
    expect(result.orphans).toHaveLength(0);
  });

  it('reports a live finding with no row as review:null', () => {
    const d = decision('doc-1', 'x');
    const result = mergeChainReview([d], []);
    expect(result.items[0].review).toBeNull();
  });

  it('reports an open row with no live finding as an orphan', () => {
    const stale = row({ breakHash: 'deadbeef' });
    const result = mergeChainReview([], [stale]);
    expect(result.items).toHaveLength(0);
    expect(result.orphans).toHaveLength(1);
    expect(result.orphans[0].id).toBe('q1');
  });

  it('does not treat a terminal row as an orphan', () => {
    const stale = row({ breakHash: 'deadbeef', state: 'dismissed' });
    const result = mergeChainReview([], [stale]);
    expect(result.orphans).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — Expected: FAIL.

- [ ] **Step 3: Implement** `merge-chain-review.ts`:

```ts
import type { RouteDecision } from '@cema/agents-chain-of-title';
import type { ChainBreakReviewState } from '@cema/attorney';

import { breakHash } from './break-hash';

export interface ChainBreakReviewRow {
  id: string;
  breakHash: string;
  breakKind: string;
  state: ChainBreakReviewState;
  reviewerId: string | null;
}

export interface ChainReviewItem {
  decision: RouteDecision;
  breakHash: string;
  review: ChainBreakReviewRow | null;
}

export interface ChainReviewMerge {
  items: ChainReviewItem[];
  orphans: ChainBreakReviewRow[];
}

/**
 * Joins live attorney_review findings (recomputed each request) to persisted
 * queue rows by breakHash. Open rows whose break is absent from the live
 * recompute are "orphans" (previously flagged, no longer detected) — surfaced
 * for manual dismissal, NEVER auto-resolved (the agent's "never auto-bless"
 * property, applied in reverse). Terminal rows are not orphans.
 */
export function mergeChainReview(
  attorneyRoutes: readonly RouteDecision[],
  rows: readonly ChainBreakReviewRow[],
): ChainReviewMerge {
  const rowByHash = new Map(rows.map((r) => [r.breakHash, r]));
  const liveHashes = new Set<string>();

  const items = attorneyRoutes.map((decision) => {
    const hash = breakHash(decision);
    liveHashes.add(hash);
    return { decision, breakHash: hash, review: rowByHash.get(hash) ?? null };
  });

  const orphans = rows.filter(
    (r) => !liveHashes.has(r.breakHash) && r.state !== 'resolved' && r.state !== 'dismissed',
  );

  return { items, orphans };
}
```

- [ ] **Step 4: Run tests, verify pass** — Expected: PASS.

- [ ] **Step 5: Commit** — `git add apps/web/lib/agents/chain-of-title/merge-chain-review.* && git commit -S -m "feat(m14): pure chain-review merge core"`.

---

## Task 5: Enqueue actuator + loader (DB integration)

**Files:**

- Modify: `apps/web/lib/agents/chain-of-title/deps.ts` (`openAttorneyReview` → enqueue)
- Create: `apps/web/lib/queries/deal-chain-break-reviews.ts` (loader)
- Modify/Create: `apps/web/tests/integration/chain-actuators.test.ts` (update Tier 1 expectations) + a loader integration case

- [ ] **Step 1: Rewrite `openAttorneyReview` in `deps.ts`.** Replace the shared `recordBreakRouted` use for `openAttorneyReview` with an idempotent enqueue (keep `routeReChase` = the existing `recordBreakRouted`). Add imports `chainBreakReviewQueue` (from `@cema/db`) and the existing `breakHash`. New body:

```ts
openAttorneyReview: (decision: RouteDecision): Promise<void> =>
  withRls(organizationId, async (tx) => {
    const [queued] = await tx
      .insert(chainBreakReviewQueue)
      .values({
        organizationId,
        dealId: decision.dealId,
        breakHash: breakHash(decision),
        breakKind: decision.kind === 'attorney_review' ? '' : decision.kind, // replaced below
        documentId: decision.documentId,
        reason: decision.reason,
        submittedById: actorUserId,
        state: 'pending',
      })
      .onConflictDoNothing({
        target: [chainBreakReviewQueue.dealId, chainBreakReviewQueue.breakHash],
      })
      .returning({ id: chainBreakReviewQueue.id });

    if (queued) {
      await emitAuditEvent(tx, {
        organizationId,
        actorUserId,
        action: 'chain.break_routed',
        entityType: 'deal',
        entityId: decision.dealId,
        metadata: {
          source: 'chain-of-title',
          kind: decision.kind,
          documentId: decision.documentId,
          reason: decision.reason,
          breakHash: breakHash(decision),
          queueId: queued.id,
        },
      });
    }
  }),
```

> **break_kind source:** `RouteDecision` carries `kind: RouteKind` ('attorney_review'), NOT the
> underlying `BreakKind`. The queue's `break_kind` CHECK requires a `BreakKind`. Resolve in Step 1a.

- [ ] **Step 1a: Thread `breakKind` onto `RouteDecision`.** The cleanest fix: add a readonly
      `breakKind: BreakKind | null` to `RouteDecision` in `packages/agents/chain-of-title/src/types.ts`
      and populate it in `route()` (it already maps each `ChainBreak` → `RouteDecision`; the `ChainBreak.kind`
      is in scope). `advisory_pass` gets `null`. Update the `route` unit tests + `break-hash.ts` material
      (keep breakHash stable: do NOT add breakKind to the hash material — breakKind is derivable from the
      route, so the hash stays backward-identical). Then `openAttorneyReview` uses `decision.breakKind!`
      (non-null for attorney_review routes; guard with a throw if null for safety).

  ```ts
  // types.ts — RouteDecision
  export interface RouteDecision {
    readonly dealId: string;
    readonly kind: RouteKind;
    readonly breakKind: BreakKind | null; // the underlying break (null for advisory_pass)
    readonly documentId: string | null;
    readonly reason: string;
  }
  ```

  In `route()`, each break maps to `{ dealId, kind: ROUTE_BY_BREAK[b.kind], breakKind: b.kind, documentId: b.documentId, reason: REASON_BY_BREAK[b.kind] }`; the clean `advisory_pass` gets `breakKind: null`.

- [ ] **Step 2: Create the loader** `deal-chain-break-reviews.ts` (mirror `deal-chain-findings.ts` RLS pattern):

```ts
import { getCurrentOrganizationId } from '@cema/auth';
import { chainBreakReviewQueue, getDb, organizations } from '@cema/db';
import { eq } from 'drizzle-orm';

import { withRls } from '@/lib/with-rls';

import type { ChainBreakReviewRow } from '@/lib/agents/chain-of-title/merge-chain-review';

export async function getDealChainBreakReviews(dealId: string): Promise<ChainBreakReviewRow[]> {
  const clerkOrgId = await getCurrentOrganizationId();
  const db = getDb();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) return [];

  return withRls(org.id, async (tx) => {
    const rows = await tx
      .select({
        id: chainBreakReviewQueue.id,
        breakHash: chainBreakReviewQueue.breakHash,
        breakKind: chainBreakReviewQueue.breakKind,
        state: chainBreakReviewQueue.state,
        reviewerId: chainBreakReviewQueue.reviewerId,
      })
      .from(chainBreakReviewQueue)
      .where(eq(chainBreakReviewQueue.dealId, dealId));
    return rows;
  });
}
```

- [ ] **Step 3: Update `chain-actuators.test.ts`** — the Tier 1 test asserted both seams write an
      audit-only `chain.break_routed`. Update the `openAttorneyReview` cases to assert: (a) a
      `chain_break_review_queue` row is inserted with `state='pending'`, correct `break_hash`/`break_kind`;
      (b) the `chain.break_routed` audit fires once on first call and NOT on a replay (idempotent);
      (c) `routeReChase` still writes the audit (unchanged). Gate on `DATABASE_URL` (skip-green), per the
      existing file's harness.

- [ ] **Step 4: Run package + (if `DATABASE_URL`) integration** — `cmd /c "pnpm --filter @cema/agents-chain-of-title test"` (route tests) and `cmd /c "pnpm --filter web test chain"`. Expected: PASS / skip-green.

- [ ] **Step 5: Commit** — `git add -A && git commit -S -m "feat(m14): attorney_review enqueue actuator + chain-break-reviews loader"`.

---

## Task 6: Transition Server Action

**Files:**

- Create: `apps/web/lib/actions/transition-chain-break-review.ts`
- Create: `apps/web/lib/actions/chain-break-errors.ts` (error class — outside `'use server'`)

- [ ] **Step 1: Create the error class** `chain-break-errors.ts`:

```ts
export class ChainBreakReviewError extends Error {}
```

- [ ] **Step 2: Implement the action** (mirror `claim-review.ts`):

```ts
'use server';

import {
  canTransitionChainBreak,
  isTerminalChainBreak,
  type ChainBreakReviewState,
} from '@cema/attorney';
import { getCurrentOrganizationId, getCurrentUser } from '@cema/auth';
import { emitAuditEvent } from '@cema/compliance';
import { chainBreakReviewQueue, getDb, organizations, users } from '@cema/db';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { chainBreakAuditMetadata } from '../agents/chain-of-title/chain-break-audit';
import { withRls } from '../with-rls';

import { ChainBreakReviewError } from './chain-break-errors';

const ACTION_BY_STATE: Record<'claimed' | 'pending' | 'resolved' | 'dismissed', string> = {
  claimed: 'chain_break.claimed',
  pending: 'chain_break.released',
  resolved: 'chain_break.resolved',
  dismissed: 'chain_break.dismissed',
};

export async function transitionChainBreakReview(
  queueId: string,
  toState: ChainBreakReviewState,
  note?: string,
): Promise<{ queueId: string; state: ChainBreakReviewState }> {
  const clerkOrgId = await getCurrentOrganizationId();
  const clerkUser = await getCurrentUser();
  if (!clerkUser) throw new ChainBreakReviewError('Not authenticated');

  const db = getDb();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) throw new ChainBreakReviewError('Organization not found');
  const user = await db.query.users.findFirst({ where: eq(users.clerkUserId, clerkUser.id) });
  if (!user) throw new ChainBreakReviewError('User not synced yet');

  const { row, fromState, dealId } = await withRls(org.id, async (tx) => {
    const [existing] = await tx
      .select()
      .from(chainBreakReviewQueue)
      .where(eq(chainBreakReviewQueue.id, queueId))
      .limit(1);
    if (!existing) throw new ChainBreakReviewError(`Queue row ${queueId} not found`);
    if (!canTransitionChainBreak(existing.state, toState)) {
      throw new ChainBreakReviewError(
        `Cannot move chain break from ${existing.state} to ${toState}`,
      );
    }

    const terminal = isTerminalChainBreak(toState);
    await tx
      .update(chainBreakReviewQueue)
      .set({
        state: toState,
        reviewerId:
          toState === 'claimed' ? user.id : toState === 'pending' ? null : existing.reviewerId,
        claimedAt:
          toState === 'claimed' ? new Date() : toState === 'pending' ? null : existing.claimedAt,
        decidedAt: terminal ? new Date() : null,
        resolutionNote: terminal ? (note ?? null) : null,
        updatedAt: new Date(),
      })
      .where(eq(chainBreakReviewQueue.id, queueId));

    return { row: existing, fromState: existing.state, dealId: existing.dealId };
  });

  await emitAuditEvent(db, {
    organizationId: org.id,
    actorUserId: user.id,
    action: ACTION_BY_STATE[toState],
    entityType: 'deal',
    entityId: dealId,
    metadata: { queueId: row.id, ...chainBreakAuditMetadata(row, fromState, toState) },
  });

  revalidatePath(`/deals/${dealId}/documents`);
  return { queueId: row.id, state: toState };
}
```

- [ ] **Step 3: Typecheck** — `cmd /c "pnpm --filter web typecheck"`. Expected: PASS.

- [ ] **Step 4: Commit** — `git add apps/web/lib/actions/transition-chain-break-review.ts apps/web/lib/actions/chain-break-errors.ts && git commit -S -m "feat(m14): transitionChainBreakReview server action"`.

---

## Task 7: Deal-scoped UI island + page wiring

**Files:**

- Create: `apps/web/components/deal-chain-break-review-actions.tsx`
- Modify: `apps/web/app/(app)/deals/[id]/documents/page.tsx`

- [ ] **Step 1: Create the island** `deal-chain-break-review-actions.tsx` — a `'use client'` component
      (mirror `deal-document-review-actions.tsx` + `review-detail-panel.tsx`): props
      `{ queueId: string | null; state: ChainBreakReviewState | null; reviewerIsCurrentUser?: boolean }`.
      Use `validChainBreakTransitions(state)` (from `@cema/attorney`) to render the valid action buttons
      for the current state; each button calls `transitionChainBreakReview(queueId, target, note?)` inside
      `useTransition`. When `queueId === null` (unenqueued live finding — should be rare since the actuator
      auto-enqueues), render a muted "pending enqueue" note. Resolve/dismiss buttons may surface an
      optional note `<input>`; pass it through. Match the Tailwind classes already used in the document island.

- [ ] **Step 2: Wire the page** `page.tsx`:
  - import `getDealChainBreakReviews`, `mergeChainReview`, `DealChainBreakReviewActions`.
  - in the `Promise.all`, add `getDealChainBreakReviews(id)`.
  - replace the `attorneyReview` derivation with:
    ```ts
    const breakReviews = await getDealChainBreakReviews(id); // or include in Promise.all
    const merged = mergeChainReview(
      findings.routes.filter((r) => r.kind === 'attorney_review'),
      breakReviews,
    );
    ```
  - render the "Attorney review" group from `merged.items` (each: `r.decision.reason`, optional
    `documentId`, a state badge from `item.review?.state ?? '—'`, and `<DealChainBreakReviewActions
queueId={item.review?.id ?? null} state={item.review?.state ?? null} />`).
  - render an "No longer detected" group from `merged.orphans` (each with a dismiss action) only when
    `merged.orphans.length > 0`.
  - `re_chase` group stays exactly as-is (informational).

- [ ] **Step 3: Lint + typecheck + build** — `cmd /c "pnpm --filter web typecheck && pnpm --filter web lint"`. Expected: PASS.

- [ ] **Step 4: Commit** — `git add apps/web && git commit -S -m "feat(m14): deal-scoped chain-break review UI"`.

---

## Task 8: Compliance, docs, verification, PR

- [ ] **Step 1: Compliance check** — invoke `legal:compliance-check` over the diff (touches the
      attorney-review audit trail + a new PII-bearing column). Confirm: `resolution_note` never logged/
      audited/spanned; `reason` is the static template; gate (hard rule #2) reinforced.
- [ ] **Step 2: Full verification** — `cmd /c "pnpm typecheck && pnpm lint && pnpm test && pnpm build"`.
      Expected: all PASS (the `idp-auto-enqueue` parallel-flake is the known exception — verify it passes
      in isolation per the memory note).
- [ ] **Step 3: ADR** — write `docs/adr/0018-phase-1-month-14-chain-of-title-tier-2.md` (decisions:
      dedicated table; attorney_review-only queue; re_chase unchanged per caller-graph; never-auto-bless
      orphans; PII-fenced note). List carry-overs (cross-deal inbox; stale auto-reconciliation; re_chase
      audit once-per-break; durable activation; `kg_edges`).
- [ ] **Step 4: CLAUDE.md** — update §2 (Phase line + Next step) + the changelog row.
- [ ] **Step 5: Commit docs** — `git commit -S -m "docs(m14): ADR 0018 + CLAUDE.md close-out for Chain-of-Title Tier 2"`.
- [ ] **Step 6: Push + PR** — use `commit-commands:commit-push-pr` (or `gh pr create`), then
      `gh pr merge <n> --auto --squash --delete-branch`. Verify required checks; if BLOCKED with green
      checks + 0 approvals, it's the signatures/conversation gate — resolve, never `--admin`.

---

## Self-review (plan vs. spec)

- **Spec coverage:** §2 table → Task 1; §3 state machine → Task 2; §4.1 enqueue → Task 5; §4.2 (re_chase
  unchanged) → no task (correct); §5 read path (loader + merge + never-auto-bless) → Tasks 4 + 5; §6
  action + PII fence → Tasks 3 + 6; §7 UI → Task 7; §8 tests → distributed; §9 compliance → Task 8. ✓
- **New finding (Task 1a):** `RouteDecision` lacks the underlying `BreakKind` needed for the queue's
  `break_kind` column + CHECK. Resolved by threading `breakKind` onto `RouteDecision` in `route()`
  (kept out of the breakHash material so the hash stays stable). This touches the agent package — a
  small, well-contained type addition with its own test update.
- **Type consistency:** `ChainBreakReviewState` (attorney pkg) used in merge core, action, UI;
  `ChainBreakReviewRow` (merge core) used by the loader + UI; `breakHash` reused everywhere. ✓
- **Placeholder scan:** none. ✓
