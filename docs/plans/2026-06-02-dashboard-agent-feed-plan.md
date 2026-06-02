# Dashboard Agent Activity Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make `/dashboard` an org-wide agent activity feed. **Design spec (full code):** `docs/plans/2026-06-02-dashboard-agent-feed.md`.

**Architecture:** pure `toOrgActivityItem` (reuses `describeAuditEvent`) + RLS loader `getOrgAgentActivity` (auditEvents⋈deals⋈properties) + async-RSC dashboard page. apps/web only, 0 migrations.

---

## Task 1: Pure `toOrgActivityItem` (TDD)

**Files:** Create `apps/web/lib/agent-activity/org-activity-item.ts` + `.test.ts`.

- [ ] **Step 1: Failing test** — `org-activity-item.test.ts`

```ts
import { describe, expect, it } from 'vitest';

import { toOrgActivityItem } from './org-activity-item';

const ROW = {
  id: 'ae-1',
  action: 'docgen.generated',
  occurredAt: new Date('2026-06-01T10:00:00Z'),
  metadata: { count: 8 },
  dealId: 'deal-1',
  cemaType: 'refi_cema',
  status: 'doc_prep',
  streetAddress: '123 Main St',
  city: 'Brooklyn',
};

describe('toOrgActivityItem', () => {
  it('delegates label/detail to describeAuditEvent', () => {
    const item = toOrgActivityItem(ROW);
    expect(item.label).toBe('CEMA documents generated');
    expect(item.detail).toBe('8 documents');
    expect(item.dealId).toBe('deal-1');
  });

  it('builds a PII-safe context (cemaType · status · address)', () => {
    expect(toOrgActivityItem(ROW).context).toBe('Refi CEMA · doc_prep · 123 Main St, Brooklyn');
  });

  it('omits the address segment when absent', () => {
    const item = toOrgActivityItem({ ...ROW, streetAddress: null, city: null });
    expect(item.context).toBe('Refi CEMA · doc_prep');
  });

  it('maps purchase_cema label', () => {
    expect(toOrgActivityItem({ ...ROW, cemaType: 'purchase_cema' }).context).toContain(
      'Purchase CEMA',
    );
  });

  it('context never contains borrower metadata (PII-safe)', () => {
    const item = toOrgActivityItem({ ...ROW, metadata: { count: 8, borrowerName: 'Jane Doe' } });
    expect(item.context).not.toContain('Jane Doe');
    expect(item.detail).not.toContain('Jane Doe');
  });
});
```

- [ ] **Step 2: Run → FAIL.** **Step 3: Implement** `org-activity-item.ts` — copy `OrgAgentActivityRow`/`OrgActivityItem`/`toOrgActivityItem` from design §2 (imports `describeAuditEvent` from `./describe-audit-event`). **Step 4: Run → PASS (5).** **Step 5: Commit**

```bash
git add apps/web/lib/agent-activity/org-activity-item.ts apps/web/lib/agent-activity/org-activity-item.test.ts
git commit -S -m "feat(dashboard): pure toOrgActivityItem view-model mapper"
```

---

## Task 2: RLS loader `getOrgAgentActivity`

**Files:** Create `apps/web/lib/queries/org-agent-activity.ts`.

- [ ] **Step 1: Implement** — copy from design §2 (RLS via clerk-org→`withRls`; `auditEvents` innerJoin `deals` on `entityId=deals.id`, leftJoin `properties` on `deals.propertyId`, where `entityType='deal'`, `desc(occurredAt)`, limit 50; map nullable address). Reuse `OrgAgentActivityRow` from `../agent-activity/org-activity-item`.
- [ ] **Step 2: Typecheck** (`pnpm --filter web typecheck`). **Step 3: Commit** (with Task 3).

---

## Task 3: Dashboard page (stub → async RSC feed)

**Files:** Modify `apps/web/app/(app)/dashboard/page.tsx`.

- [ ] **Step 1: Replace the stub** with an async RSC that loads `getOrgAgentActivity()`, maps via `toOrgActivityItem`, and renders the timeline `<ol>` (mirror `/deals/[id]/agent-activity/page.tsx`) — each `<li>` wraps a `<Link href={\`/deals/${item.dealId}\`}>`(bare inline template href — NO`as Route`cast; the`/deals/[id]`route already exists). Show`label`, `detail`, `context`(muted),`formatDistanceToNow(occurredAt)`. Empty state: "Agent activity will appear here as deals move through the pipeline." Keep an `<h1>Dashboard</h1>`.
- [ ] **Step 2: Typecheck + lint** (`pnpm --filter web typecheck && pnpm --filter web lint`). **Step 3: Commit**

```bash
git add apps/web/lib/queries/org-agent-activity.ts "apps/web/app/(app)/dashboard/page.tsx"
git commit -S -m "feat(dashboard): org-wide agent activity feed on the dashboard"
```

---

## Task 4: Neon-gated loader integration (skip-green)

**Files:** Create `apps/web/tests/integration/org-agent-activity.test.ts`.

- [ ] **Step 1: Write it** — `describe.skipIf(!process.env.DATABASE_URL)`. Mock `@cema/auth` `getCurrentOrganizationId` (real `@cema/db`/`withRls`). Seed 2 orgs + user + a deal (with a property) + deal-scoped audit events (+ 1 document-scoped, excluded), unique UUID block `…d1`–`…d8` + clerk ids/slugs `org_agent_feed_*` (see [[neon-integration-test-parallel-flake]]; `audit_events` append-only → no afterAll delete, stable ids + onConflictDoNothing). Assert: `getOrgAgentActivity()` (org mock = seeded org) returns the deal-scoped events newest-first with joined `dealId`/`cemaType`/`status`/address, excludes the document-scoped; cross-org mock → `[]`. Model on `deal-agent-activity.test.ts`.
- [ ] **Step 2: Run serially** (`pnpm --filter web exec vitest run tests/integration/org-agent-activity --no-file-parallelism`) → PASS; CI skips-green.
- [ ] **Step 3: Commit**

```bash
git add apps/web/tests/integration/org-agent-activity.test.ts
git commit -S -m "test(dashboard): Neon-gated org-agent-activity loader integration (skip-green)"
```

---

## Task 5: Full verification

- [ ] `pnpm format:check` (only `.well-known` artifacts may warn); `pnpm --filter web lint` (0 errors); `pnpm typecheck`; `pnpm --filter web test org-activity-item` (5) + the unit suite. Integration skips in CI / passes serially. Commit any `pnpm format` fixups.

---

## Self-Review (author checklist — completed)

**Spec coverage:** pure mapper (§2 → Task 1), loader (§2 → Task 2), page (§2 → Task 3), PII (§3 — whitelisted context, tested Task 1), integration (§4 → Task 4). **Type consistency:** `OrgAgentActivityRow` defined in `org-activity-item.ts` + imported by the loader; `toOrgActivityItem` / `getOrgAgentActivity` signatures match design. No `as Route` cast (inline href to existing `/deals/[id]`). ✓
