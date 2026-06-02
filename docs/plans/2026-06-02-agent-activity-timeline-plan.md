# Agent Activity Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deal tab `/deals/[id]/agent-activity` rendering the deal-scoped `audit_events` trail (the 8 agents' work) as a human-labeled timeline.

**Architecture:** Pure `describeAuditEvent` (action → label + PII-safe detail) + RLS loader `getDealAgentActivity` + an RSC page (mirrors `/activity`) + a deal nav link. apps/web only, 0 migrations.

**Tech Stack:** TypeScript, Vitest, Drizzle (`auditEvents` read), `date-fns`, Next.js RSC.

**Design spec:** `docs/plans/2026-06-02-agent-activity-timeline.md`

---

## Task 1: Pure core — `describeAuditEvent` (TDD)

**Files:** Create `apps/web/lib/agent-activity/describe-audit-event.ts`; Test `apps/web/lib/agent-activity/describe-audit-event.test.ts`.

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from 'vitest';

import { describeAuditEvent } from './describe-audit-event';

describe('describeAuditEvent', () => {
  it('maps known agent actions to human labels', () => {
    expect(describeAuditEvent('docgen.generated', { count: 8 }).label).toBe(
      'CEMA documents generated',
    );
    expect(describeAuditEvent('borrower_comm.notified', {}).label).toBe('Borrower emailed');
    expect(describeAuditEvent('chain.analyzed', {}).label).toBe('Chain-of-title analyzed');
  });

  it('builds a PII-safe detail from whitelisted fields only', () => {
    expect(
      describeAuditEvent('deal.status_changed', { from: 'doc_prep', to: 'attorney_review' }).detail,
    ).toBe('doc_prep → attorney_review');
    expect(describeAuditEvent('docgen.generated', { count: 8 }).detail).toBe('8 documents');
    expect(describeAuditEvent('internal_comm.notified', { channel: 'pipeline' }).detail).toBe(
      'via pipeline',
    );
  });

  it('never renders non-whitelisted metadata (defense in depth)', () => {
    const d = describeAuditEvent('deal.status_changed', {
      from: 'doc_prep',
      to: 'attorney_review',
      borrowerName: 'Jane Doe',
    });
    expect(d.detail).toBe('doc_prep → attorney_review');
    expect(d.detail).not.toContain('Jane Doe');
  });

  it('humanizes unknown actions with no detail', () => {
    const d = describeAuditEvent('some.future_action', { x: 1 });
    expect(d.label).toBe('Some future action');
    expect(d.detail).toBeNull();
  });

  it('returns a null detail when whitelisted fields are absent/wrong-typed', () => {
    expect(describeAuditEvent('deal.status_changed', {}).detail).toBeNull();
    expect(describeAuditEvent('docgen.generated', { count: 'eight' }).detail).toBeNull();
  });
});
```

- [ ] **Step 2: Run → FAIL** (`pnpm --filter web test describe-audit-event`).

- [ ] **Step 3: Implement `describe-audit-event.ts`** — copy the implementation from design §3 (the `LABEL_BY_ACTION` map, the `DETAIL_BY_ACTION` whitelisted builders, `humanize`, and `describeAuditEvent`).

- [ ] **Step 4: Run → PASS (5).** **Step 5: Commit**

```bash
git add apps/web/lib/agent-activity/describe-audit-event.ts apps/web/lib/agent-activity/describe-audit-event.test.ts
git commit -S -m "feat(agent-activity): pure describeAuditEvent (label + PII-safe detail)"
```

---

## Task 2: RLS loader — `getDealAgentActivity`

**Files:** Create `apps/web/lib/queries/deal-agent-activity.ts`.

- [ ] **Step 1: Implement the loader** (mirror `getDealDocumentsReview`'s org-resolution + `withRls`)

```ts
import { getCurrentOrganizationId } from '@cema/auth';
import { auditEvents, getDb, organizations } from '@cema/db';
import { and, desc, eq } from 'drizzle-orm';

import { withRls } from '../with-rls';

export interface DealAgentActivityEvent {
  readonly id: string;
  readonly action: string;
  readonly occurredAt: Date;
  readonly metadata: Record<string, unknown>;
}

const LIMIT = 200;

/**
 * RLS-scoped: the deal's agent + lifecycle audit trail (entityType='deal'),
 * newest first. Tenancy flows audit_events.organizationId via withRls; the
 * deal filter is entityId. Returns [] if the org is unresolved.
 */
export async function getDealAgentActivity(dealId: string): Promise<DealAgentActivityEvent[]> {
  const clerkOrgId = await getCurrentOrganizationId();
  const db = getDb();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) return [];

  return withRls(org.id, async (tx) => {
    const rows = await tx
      .select({
        id: auditEvents.id,
        action: auditEvents.action,
        occurredAt: auditEvents.occurredAt,
        metadata: auditEvents.metadata,
      })
      .from(auditEvents)
      .where(and(eq(auditEvents.entityType, 'deal'), eq(auditEvents.entityId, dealId)))
      .orderBy(desc(auditEvents.occurredAt))
      .limit(LIMIT);
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      occurredAt: r.occurredAt,
      metadata: (r.metadata ?? {}) as Record<string, unknown>,
    }));
  });
}
```

- [ ] **Step 2: Typecheck** (`pnpm --filter web typecheck`) — confirm the `auditEvents` columns/types resolve. (Confirm `auditEvents.id`, `.action`, `.occurredAt`, `.entityType`, `.entityId`, `.metadata` exist when implementing; adjust select keys to the real column names if needed.)

- [ ] **Step 3: Commit** (with Task 3 — the loader is exercised by the page + the Task 4 integration test).

---

## Task 3: Page + nav link

**Files:** Create `apps/web/app/(app)/deals/[id]/agent-activity/page.tsx`; Modify `apps/web/app/(app)/deals/[id]/page.tsx`.

- [ ] **Step 1: Create the page** (mirror the `/activity` page markup)

```tsx
import { formatDistanceToNow } from 'date-fns';

import { describeAuditEvent } from '@/lib/agent-activity/describe-audit-event';
import { getDealAgentActivity } from '@/lib/queries/deal-agent-activity';

export default async function DealAgentActivityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const events = await getDealAgentActivity(id);

  return (
    <div className="p-6">
      <h2 className="mb-4 text-lg font-semibold">Agent activity</h2>
      {events.length === 0 ? (
        <p className="text-muted-foreground text-sm">No agent activity yet.</p>
      ) : (
        <ol className="border-border relative space-y-6 border-l">
          {events.map((event) => {
            const { label, detail } = describeAuditEvent(event.action, event.metadata);
            return (
              <li key={event.id} className="ml-4">
                <span className="border-background bg-muted absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border" />
                <p className="text-foreground text-sm font-medium">{label}</p>
                {detail && (
                  <p className="text-muted-foreground max-w-md truncate text-sm">{detail}</p>
                )}
                <time className="text-muted-foreground text-xs">
                  {formatDistanceToNow(event.occurredAt, { addSuffix: true })}
                </time>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add the nav link** in `deals/[id]/page.tsx` — alongside the existing Documents `<Link>`, add:

```tsx
<Link href={`/deals/${id}/agent-activity`} className="text-blue-600 hover:underline">
  Agent activity
</Link>
```

(Match the surrounding markup — if the links are in a list/flex container, follow that structure. The `href` is a static template string; if Next.js typed routes require it, cast `as Route` like the existing links — check how the Documents link is typed.)

- [ ] **Step 3: Typecheck + lint** (`pnpm --filter web typecheck && pnpm --filter web lint`). **Step 4: Commit**

```bash
git add apps/web/lib/queries/deal-agent-activity.ts apps/web/app/(app)/deals/[id]/agent-activity/page.tsx apps/web/app/(app)/deals/[id]/page.tsx
git commit -S -m "feat(agent-activity): RLS loader + timeline page + deal nav link"
```

---

## Task 4: Neon-gated loader integration (skip-green)

**Files:** Create `apps/web/tests/integration/deal-agent-activity.test.ts`.

- [ ] **Step 1: Write the integration test** — `describe.skipIf(!process.env.DATABASE_URL)`. Seed (owner `getDb()`) an org + a second org + user + deal, all under a unique stable UUID namespace (block `…b1`–`…b6`, clerk ids/slugs `agent_activity_*`; see [[neon-integration-test-parallel-flake]]). Insert `auditEvents` rows: two deal-scoped (`entityType:'deal'`, `entityId:DEAL_ID`, e.g. `deal.status_changed` + `docgen.generated`) + one non-deal-scoped (`entityType:'document'`) to prove the filter. Then:
  - `getDealAgentActivity` cannot self-resolve the org (no Clerk session in the test) — so call the **inner query directly** OR (preferred) assert via a thin exported helper. Simplest: test the loader by mocking `getCurrentOrganizationId` to return the seeded org's `clerkOrgId` (`vi.mock('@cema/auth', ...)`), then `getDealAgentActivity(DEAL_ID)` returns exactly the 2 deal-scoped rows, newest first, and excludes the document-scoped row.
  - RLS: mock `getCurrentOrganizationId` to the OTHER org's clerk id → `getDealAgentActivity(DEAL_ID)` returns `[]` (cross-org isolation).

  (Model the seeding on `apps/web/tests/integration/doc-gen-persist.test.ts`. `audit_events` is append-only — do NOT delete in afterAll; stable UUIDs + `onConflictDoNothing` make it re-runnable. Use distinct `id`s per audit row so re-runs are idempotent.)

- [ ] **Step 2: Run serially** (`pnpm --filter web exec vitest run tests/integration/deal-agent-activity --no-file-parallelism`) → PASS; CI skips-green.

- [ ] **Step 3: Commit**

```bash
git add apps/web/tests/integration/deal-agent-activity.test.ts
git commit -S -m "test(agent-activity): Neon-gated loader deal-scoping + RLS integration (skip-green)"
```

---

## Task 5: Full verification

- [ ] **Step 1:** `pnpm format:check` (only `.well-known/workflow/*` artifacts may warn); `pnpm --filter web lint` (0 errors); `pnpm typecheck`; `pnpm --filter web test` (describe-audit-event 5 + the suite; integration skips or, run serially, passes). If a full-parallel web run flakes on a Neon integration test, re-run the integration serially to confirm it's the shared-branch race.

- [ ] **Step 2:** Commit any `pnpm format` fixups.

---

## Self-Review (author checklist — completed)

**1. Spec coverage:** pure describeAuditEvent (§3 → Task 1), RLS loader (§4 → Task 2), page + nav (§5 → Task 3), PII rendering (§6 — whitelisted detail, tested in Task 1), integration (§7 → Task 4), testing (§7 → all). ✓

**2. Placeholder scan:** the Task-2/3 NOTEs ("confirm `auditEvents` column names"; "match nav markup + typed-route cast") are explicit verify-against-existing-code directives, not vague TODOs; all code blocks are complete. ✓

**3. Type consistency:** `describeAuditEvent(action, metadata) → { label, detail }`, `getDealAgentActivity(dealId) → DealAgentActivityEvent[]` with `{ id, action, occurredAt, metadata }` — consistent across Tasks 1–4. Loader uses `../with-rls`; page uses the `@/` alias (RSC). ✓
