# Dashboard Agent Activity Feed — Design Spec

> **Status:** Approved (Connor, 2026-06-02) — implementation pending.
> **Goal:** Make the stub `/dashboard` the agent-layer hero: an org-wide feed of recent agent
> actions across all deals, each linking to its deal with light context. Demoable "watch the AI work
> your pipeline" view. No new package, 0 migrations (reads existing `audit_events`).

---

## 1. Goal & scope

The per-deal Agent Activity timeline (PR #123) surfaces one deal's audit trail; this surfaces the
**whole org's** recent agent activity on the landing page. Reuses the `describeAuditEvent` label/
PII map + the `getOrgExceptions` org-loader pattern.

**In scope:**

- An RLS-scoped loader `getOrgAgentActivity()` over `audit_events` (`entityType='deal'`, org-scoped),
  joined to `deals` (link + cemaType + status) and `properties` (address), newest first, limit 50.
- A pure `toOrgActivityItem(row)` mapping a loader row → a view model (`describeAuditEvent` label/
  detail + a PII-safe deal-context string). Node-testable.
- An async RSC `/dashboard` rendering the feed; each row links to `/deals/[id]`. Empty state.

**Out of scope (deferred — carry-overs):** per-agent counts / stat cards; filters; pagination;
real-time updates; a deals-by-status pipeline summary.

## 2. Architecture

### Loader — `apps/web/lib/queries/org-agent-activity.ts`

```ts
export interface OrgAgentActivityRow {
  readonly id: string;
  readonly action: string;
  readonly occurredAt: Date;
  readonly metadata: Record<string, unknown>;
  readonly dealId: string;
  readonly cemaType: string;
  readonly status: string;
  readonly streetAddress: string | null;
  readonly city: string | null;
}

export async function getOrgAgentActivity(): Promise<OrgAgentActivityRow[]>;
```

RLS-scoped (clerk org → `withRls`, the `getOrgExceptions` pattern). Query: `auditEvents`
`innerJoin deals on auditEvents.entityId = deals.id`, `leftJoin properties on deals.propertyId`,
`where eq(auditEvents.entityType, 'deal')`, `orderBy desc(occurredAt)`, `limit 50`. Both
`auditEvents` + `deals` carry org RLS, so the join is org-isolated. Returns `[]` if org unresolved.

### Pure helper — `apps/web/lib/agent-activity/org-activity-item.ts`

```ts
export interface OrgActivityItem {
  readonly id: string;
  readonly dealId: string;
  readonly label: string;
  readonly detail: string | null;
  readonly context: string;
  readonly occurredAt: Date;
}

export function toOrgActivityItem(row: OrgAgentActivityRow): OrgActivityItem {
  const { label, detail } = describeAuditEvent(row.action, row.metadata);
  const cemaLabel = row.cemaType === 'refi_cema' ? 'Refi CEMA' : 'Purchase CEMA';
  const address = [row.streetAddress, row.city].filter(Boolean).join(', ');
  const context = [cemaLabel, row.status, address].filter((s) => s && s.length > 0).join(' · ');
  return { id: row.id, dealId: row.dealId, label, detail, context, occurredAt: row.occurredAt };
}
```

Delegates label/detail to the existing `describeAuditEvent`; builds a PII-safe `context`
(`Refi CEMA · doc_prep · 123 Main St, Brooklyn`) from enum/token/address fields only (no borrower
name → no name+address PII combo, hard rule #3).

### Page — `apps/web/app/(app)/dashboard/page.tsx` (async RSC)

Loads `getOrgAgentActivity()` → maps via `toOrgActivityItem` → renders a timeline `<ol>` (mirroring
the per-deal page) where each row is a `<Link href={\`/deals/${item.dealId}\`}>`showing the agent
label, detail, deal context, and`formatDistanceToNow(occurredAt)`. Empty state: "Agent activity
will appear here as deals move through the pipeline." Keeps a brief page heading.

## 3. Compliance / PII (hard rule #3)

`describeAuditEvent` renders only label + whitelisted detail; the deal context is cemaType + status +
property address — **never a borrower name**, so no name+address combo. Org-scoped via RLS.

## 4. Testing

- **`org-activity-item.test.ts`** (pure, CI-runnable): `describeAuditEvent` delegation (label/detail);
  context formatting with + without an address; cemaType label mapping; PII-free (hostile metadata +
  no borrower name in context).
- **`org-agent-activity.test.ts`** (Neon-gated, skip-green): seed two orgs + deals + deal-scoped
  audit events (+ a document-scoped one, excluded) → loader returns this org's deal-events newest
  first with the joined deal/address context; cross-org RLS isolation.

Target: ~6 tests. **0 migrations, no new package.**

## 5. File structure

```text
apps/web/lib/agent-activity/
  org-activity-item.ts
  org-activity-item.test.ts
apps/web/lib/queries/
  org-agent-activity.ts
apps/web/app/(app)/dashboard/page.tsx          # stub -> async RSC feed
apps/web/tests/integration/
  org-agent-activity.test.ts                    # Neon-gated, skip-green
```
