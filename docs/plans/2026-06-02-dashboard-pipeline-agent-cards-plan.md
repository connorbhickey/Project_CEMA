# Dashboard Pipeline Funnel + Agent Stat Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deals-by-status pipeline funnel and per-agent all-time stat cards to `/dashboard`, above the existing activity feed.

**Architecture:** Two RLS-scoped `GROUP BY` loaders feed two pure, node-testable aggregators; the dashboard RSC composes them with two render-only components. No schema, no migration, no agent changes — read-side aggregation over existing `deals` + `audit_events`.

**Tech Stack:** Next.js 16 RSC, Drizzle (`GROUP BY` + `count(*)::int`), `withRls`, Vitest, `@cema/ui` Card.

---

## File structure

| File                                                            | Responsibility                                    |
| --------------------------------------------------------------- | ------------------------------------------------- |
| `apps/web/lib/dashboard/agents.ts` (new)                        | `AGENTS` registry + Exception/Lifecycle constants |
| `apps/web/lib/dashboard/agent-activity-summary.ts` (new)        | `summarizeAgentActivity` pure fn + types          |
| `apps/web/lib/dashboard/agent-activity-summary.test.ts` (new)   | unit tests                                        |
| `apps/web/lib/dashboard/pipeline-summary.ts` (new)              | `summarizePipeline` pure fn + types               |
| `apps/web/lib/dashboard/pipeline-summary.test.ts` (new)         | unit tests                                        |
| `apps/web/lib/queries/deals-by-status.ts` (new)                 | `getDealsByStatus` loader                         |
| `apps/web/lib/queries/agent-action-counts.ts` (new)             | `getAgentActionCounts` loader                     |
| `apps/web/components/pipeline-funnel.tsx` (new)                 | render-only funnel                                |
| `apps/web/components/agent-stat-cards.tsx` (new)                | render-only card grid                             |
| `apps/web/tests/integration/dashboard-aggregates.test.ts` (new) | Neon-gated org-isolation test                     |
| `apps/web/app/(app)/dashboard/page.tsx` (modify)                | compose loaders + aggregators + components        |

---

### Task 1: Agent registry + `summarizeAgentActivity`

**Files:**

- Create: `apps/web/lib/dashboard/agents.ts`
- Create: `apps/web/lib/dashboard/agent-activity-summary.ts`
- Test: `apps/web/lib/dashboard/agent-activity-summary.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/lib/dashboard/agent-activity-summary.test.ts
import { describe, expect, it } from 'vitest';

import { summarizeAgentActivity } from './agent-activity-summary';

describe('summarizeAgentActivity', () => {
  it('folds prefixed actions into the right agent card and sums them', () => {
    const cards = summarizeAgentActivity(
      [
        { action: 'idp.evaluated', count: 3 },
        { action: 'idp.documents_classified', count: 2 },
        { action: 'intake.evaluated', count: 4 },
      ],
      0,
    );
    expect(cards.find((c) => c.key === 'idp')).toMatchObject({ count: 5, unit: 'actions' });
    expect(cards.find((c) => c.key === 'intake')).toMatchObject({ count: 4, unit: 'actions' });
  });

  it('rolls deal.* and unmapped actions into the Lifecycle bucket', () => {
    const cards = summarizeAgentActivity(
      [
        { action: 'deal.created', count: 2 },
        { action: 'deal.status_changed', count: 5 },
        { action: 'deal.agent_dispatch_failed', count: 1 },
        { action: 'something.unmapped', count: 7 },
      ],
      0,
    );
    expect(cards.find((c) => c.key === 'lifecycle')).toMatchObject({ count: 15, unit: 'actions' });
  });

  it('places Exception Triage with the open-exception count and "open" unit', () => {
    const cards = summarizeAgentActivity([], 4);
    expect(cards.find((c) => c.key === 'exception')).toMatchObject({
      label: 'Exception Triage',
      count: 4,
      unit: 'open',
    });
  });

  it('returns a stable 10-card set (8 agents + exception + lifecycle), zeros included', () => {
    const cards = summarizeAgentActivity([], 0);
    expect(cards.map((c) => c.key)).toEqual([
      'intake',
      'outreach',
      'idp',
      'chain',
      'docgen',
      'recording',
      'internal_comm',
      'borrower_comm',
      'exception',
      'lifecycle',
    ]);
    expect(cards.every((c) => c.count === 0)).toBe(true);
  });

  it('does not cross-map similar prefixes (internal_comm vs intake)', () => {
    const cards = summarizeAgentActivity([{ action: 'internal_comm.notified', count: 3 }], 0);
    expect(cards.find((c) => c.key === 'intake')?.count).toBe(0);
    expect(cards.find((c) => c.key === 'internal_comm')?.count).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cmd /c "pnpm --filter web exec vitest run lib/dashboard/agent-activity-summary.test.ts"`
Expected: FAIL — cannot find module `./agent-activity-summary`.

- [ ] **Step 3: Write the registry**

```ts
// apps/web/lib/dashboard/agents.ts

/**
 * The Layer-3 / Phase-2 agent fleet, in pipeline order. Single source of truth
 * for the dashboard stat cards. Each agent's deal-scoped audit actions share a
 * dotted prefix (e.g. 'idp.'), which summarizeAgentActivity folds counts into.
 *
 * Exception Triage is intentionally absent here: it is a pull/derive agent that
 * emits no audit actions of its own (get-org-exceptions.ts only reads others'
 * audits), so its card count comes from open exceptions, not this prefix fold.
 */
export interface AgentDescriptor {
  readonly key: string;
  readonly label: string;
  readonly prefix: string;
}

export const AGENTS: readonly AgentDescriptor[] = [
  { key: 'intake', label: 'Intake', prefix: 'intake.' },
  { key: 'outreach', label: 'Servicer Outreach', prefix: 'outreach.' },
  { key: 'idp', label: 'Collateral IDP', prefix: 'idp.' },
  { key: 'chain', label: 'Chain of Title', prefix: 'chain.' },
  { key: 'docgen', label: 'Doc Generation', prefix: 'docgen.' },
  { key: 'recording', label: 'Recording Prep', prefix: 'recording.' },
  { key: 'internal_comm', label: 'Internal Comms', prefix: 'internal_comm.' },
  { key: 'borrower_comm', label: 'Borrower Comms', prefix: 'borrower_comm.' },
];

/** Exception Triage — counted from open exceptions, not audit actions. */
export const EXCEPTION_TRIAGE_AGENT = { key: 'exception', label: 'Exception Triage' } as const;

/** The Lifecycle bucket — deal-scoped non-agent events (deal.*) + any unmapped action. */
export const LIFECYCLE_BUCKET = { key: 'lifecycle', label: 'Lifecycle & Status' } as const;
```

- [ ] **Step 4: Write the summarizer**

```ts
// apps/web/lib/dashboard/agent-activity-summary.ts
import { AGENTS, EXCEPTION_TRIAGE_AGENT, LIFECYCLE_BUCKET } from './agents';

/** A row from getAgentActionCounts: one deal-scoped audit action + its all-time count. */
export interface AgentActionCount {
  readonly action: string;
  readonly count: number;
}

/** One agent stat card. `unit` distinguishes Exception Triage's "open" count from
 *  the all-time action counts so the UI can label them correctly. */
export interface AgentStatCard {
  readonly key: string;
  readonly label: string;
  readonly count: number;
  readonly unit: 'actions' | 'open';
}

/**
 * Pure: fold all-time deal-scoped audit-action counts into the agent fleet's
 * stat cards, in a stable pipeline order. Each agent's count is the sum of its
 * prefixed actions; deal.* and any unmapped action roll up into the Lifecycle
 * bucket. Exception Triage is appended with its open-exception count (a distinct
 * unit), since it emits no audit actions of its own.
 */
export function summarizeAgentActivity(
  counts: readonly AgentActionCount[],
  openExceptionCount: number,
): AgentStatCard[] {
  const byAgent = new Map<string, number>(AGENTS.map((a) => [a.key, 0]));
  let lifecycle = 0;

  for (const { action, count } of counts) {
    const agent = AGENTS.find((a) => action.startsWith(a.prefix));
    if (agent) {
      byAgent.set(agent.key, (byAgent.get(agent.key) ?? 0) + count);
    } else {
      lifecycle += count;
    }
  }

  const agentCards: AgentStatCard[] = AGENTS.map((a) => ({
    key: a.key,
    label: a.label,
    count: byAgent.get(a.key) ?? 0,
    unit: 'actions',
  }));

  return [
    ...agentCards,
    {
      key: EXCEPTION_TRIAGE_AGENT.key,
      label: EXCEPTION_TRIAGE_AGENT.label,
      count: openExceptionCount,
      unit: 'open',
    },
    { key: LIFECYCLE_BUCKET.key, label: LIFECYCLE_BUCKET.label, count: lifecycle, unit: 'actions' },
  ];
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cmd /c "pnpm --filter web exec vitest run lib/dashboard/agent-activity-summary.test.ts"`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/dashboard/agents.ts apps/web/lib/dashboard/agent-activity-summary.ts apps/web/lib/dashboard/agent-activity-summary.test.ts
git commit -S -m "feat(dashboard): summarizeAgentActivity + agent registry"
```

---

### Task 2: `summarizePipeline`

**Files:**

- Create: `apps/web/lib/dashboard/pipeline-summary.ts`
- Test: `apps/web/lib/dashboard/pipeline-summary.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/lib/dashboard/pipeline-summary.test.ts
import { describe, expect, it } from 'vitest';

import { summarizePipeline } from './pipeline-summary';

describe('summarizePipeline', () => {
  it('orders active stages canonically and zero-fills missing statuses', () => {
    const s = summarizePipeline([
      { status: 'recording', count: 1 },
      { status: 'intake', count: 2 },
    ]);
    expect(s.stages.map((x) => x.status)).toEqual([
      'intake',
      'eligibility',
      'authorization',
      'collateral_chase',
      'title_work',
      'doc_prep',
      'attorney_review',
      'closing',
      'recording',
    ]);
    expect(s.stages.find((x) => x.status === 'intake')?.count).toBe(2);
    expect(s.stages.find((x) => x.status === 'eligibility')?.count).toBe(0);
  });

  it('separates off-ramps and computes activeTotal vs total', () => {
    const s = summarizePipeline([
      { status: 'intake', count: 2 },
      { status: 'closing', count: 1 },
      { status: 'completed', count: 5 },
      { status: 'cancelled', count: 3 },
      { status: 'exception', count: 1 },
    ]);
    expect(s.activeTotal).toBe(3);
    expect(s.total).toBe(12);
    expect(s.offRamps.map((x) => x.status)).toEqual(['completed', 'exception', 'cancelled']);
    expect(s.offRamps.find((x) => x.status === 'completed')?.count).toBe(5);
  });

  it('counts unknown statuses in total but not in the funnel', () => {
    const s = summarizePipeline([
      { status: 'intake', count: 1 },
      { status: 'mystery', count: 9 },
    ]);
    expect(s.activeTotal).toBe(1);
    expect(s.total).toBe(10);
    expect(s.stages.some((x) => x.status === 'mystery')).toBe(false);
    expect(s.offRamps.some((x) => x.status === 'mystery')).toBe(false);
  });

  it('handles empty input as an all-zero funnel', () => {
    const s = summarizePipeline([]);
    expect(s.total).toBe(0);
    expect(s.activeTotal).toBe(0);
    expect(s.stages).toHaveLength(9);
    expect(s.offRamps).toHaveLength(3);
    expect(s.stages.every((x) => x.count === 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cmd /c "pnpm --filter web exec vitest run lib/dashboard/pipeline-summary.test.ts"`
Expected: FAIL — cannot find module `./pipeline-summary`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/web/lib/dashboard/pipeline-summary.ts

/** A row from getDealsByStatus: one deal_status + how many deals are in it. */
export interface DealStatusCount {
  readonly status: string;
  readonly count: number;
}

export interface PipelineStage {
  readonly status: string;
  readonly label: string;
  readonly count: number;
}

export interface PipelineSummary {
  readonly stages: PipelineStage[]; // active lifecycle, in order, zeros filled
  readonly offRamps: PipelineStage[]; // completed / exception / cancelled
  readonly activeTotal: number; // sum of active stages (deals in flight)
  readonly total: number; // all deals incl. off-ramps + any unknown status
}

// Active lifecycle order (the funnel). Off-ramps handled separately.
const ACTIVE_STATUSES = [
  'intake',
  'eligibility',
  'authorization',
  'collateral_chase',
  'title_work',
  'doc_prep',
  'attorney_review',
  'closing',
  'recording',
] as const;
const OFF_RAMP_STATUSES = ['completed', 'exception', 'cancelled'] as const;

const STATUS_LABELS: Record<string, string> = {
  intake: 'Intake',
  eligibility: 'Eligibility',
  authorization: 'Authorization',
  collateral_chase: 'Collateral Chase',
  title_work: 'Title Work',
  doc_prep: 'Doc Prep',
  attorney_review: 'Attorney Review',
  closing: 'Closing',
  recording: 'Recording',
  completed: 'Completed',
  exception: 'Exception',
  cancelled: 'Cancelled',
};

function labelFor(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

/**
 * Pure: turn deals-by-status counts into an ordered pipeline funnel. Active
 * lifecycle stages come first (canonical order, zero-filled for empty statuses),
 * then the off-ramps. Any unknown status is excluded from the funnel but still
 * counted in `total` so the headline never under-reports.
 */
export function summarizePipeline(counts: readonly DealStatusCount[]): PipelineSummary {
  const byStatus = new Map<string, number>();
  for (const { status, count } of counts) {
    byStatus.set(status, (byStatus.get(status) ?? 0) + count);
  }

  const stages = ACTIVE_STATUSES.map((status) => ({
    status,
    label: labelFor(status),
    count: byStatus.get(status) ?? 0,
  }));
  const offRamps = OFF_RAMP_STATUSES.map((status) => ({
    status,
    label: labelFor(status),
    count: byStatus.get(status) ?? 0,
  }));

  const activeTotal = stages.reduce((n, s) => n + s.count, 0);
  const total = [...byStatus.values()].reduce((n, c) => n + c, 0);

  return { stages, offRamps, activeTotal, total };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cmd /c "pnpm --filter web exec vitest run lib/dashboard/pipeline-summary.test.ts"`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/dashboard/pipeline-summary.ts apps/web/lib/dashboard/pipeline-summary.test.ts
git commit -S -m "feat(dashboard): summarizePipeline funnel aggregator"
```

---

### Task 3: The two RLS loaders

No unit test (they need a DB); covered by the Neon-gated integration test in Task 4 and by typecheck here.

**Files:**

- Create: `apps/web/lib/queries/deals-by-status.ts`
- Create: `apps/web/lib/queries/agent-action-counts.ts`

- [ ] **Step 1: Write `getDealsByStatus`**

```ts
// apps/web/lib/queries/deals-by-status.ts
import { getCurrentOrganizationId } from '@cema/auth';
import { deals, getDb, organizations } from '@cema/db';
import { eq, sql } from 'drizzle-orm';

import { type DealStatusCount } from '../dashboard/pipeline-summary';
import { withRls } from '../with-rls';

/**
 * RLS-scoped: count deals grouped by status for the current org (all-time).
 * deals carries org RLS, and we also filter explicitly by org id (mirrors
 * getOrgExceptions). Returns [] if the org is unresolved.
 */
export async function getDealsByStatus(): Promise<DealStatusCount[]> {
  const clerkOrgId = await getCurrentOrganizationId();
  const db = getDb();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) return [];

  return withRls(org.id, async (tx) => {
    const rows = await tx
      .select({ status: deals.status, count: sql<number>`count(*)::int` })
      .from(deals)
      .where(eq(deals.organizationId, org.id))
      .groupBy(deals.status);
    return rows.map((r) => ({ status: r.status, count: r.count }));
  });
}
```

- [ ] **Step 2: Write `getAgentActionCounts`**

```ts
// apps/web/lib/queries/agent-action-counts.ts
import { getCurrentOrganizationId } from '@cema/auth';
import { auditEvents, getDb, organizations } from '@cema/db';
import { and, eq, sql } from 'drizzle-orm';

import { type AgentActionCount } from '../dashboard/agent-activity-summary';
import { withRls } from '../with-rls';

/**
 * RLS-scoped: count deal-scoped audit actions grouped by action for the current
 * org (all-time). Mirrors the dashboard feed's entityType='deal' filter, so the
 * counts cover the agent + deal-lifecycle actions and exclude document-scoped
 * events. Returns [] if the org is unresolved.
 */
export async function getAgentActionCounts(): Promise<AgentActionCount[]> {
  const clerkOrgId = await getCurrentOrganizationId();
  const db = getDb();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) return [];

  return withRls(org.id, async (tx) => {
    const rows = await tx
      .select({ action: auditEvents.action, count: sql<number>`count(*)::int` })
      .from(auditEvents)
      .where(and(eq(auditEvents.organizationId, org.id), eq(auditEvents.entityType, 'deal')))
      .groupBy(auditEvents.action);
    return rows.map((r) => ({ action: r.action, count: r.count }));
  });
}
```

- [ ] **Step 3: Typecheck**

Run: `cmd /c "pnpm typecheck"`
Expected: PASS (no errors).

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/queries/deals-by-status.ts apps/web/lib/queries/agent-action-counts.ts
git commit -S -m "feat(dashboard): getDealsByStatus + getAgentActionCounts RLS loaders"
```

---

### Task 4: Neon-gated org-isolation integration test

Verifies both loaders are org-isolated and `getAgentActionCounts` excludes
document-scoped events. **Distinctive namespace** (`da5b0a00-…` ids, `dashagg_*`
clerk ids/slugs/emails) per the shared-dev-branch collision hazard; **never deletes
orgs/users** (audit is append-only, FK-protected). Skip-green in CI (no `DATABASE_URL`).

**Files:**

- Create: `apps/web/tests/integration/dashboard-aggregates.test.ts`

- [ ] **Step 1: Confirm the namespace is unused on the shared branch**

Run: `cmd /c "git grep -n da5b0a00 -- apps/web/tests || echo UNUSED"` and
`cmd /c "git grep -n dashagg_ -- apps/web/tests || echo UNUSED"`
Expected: both print `UNUSED` (if either matches, pick a different distinctive prefix).

- [ ] **Step 2: Write the integration test**

```ts
// apps/web/tests/integration/dashboard-aggregates.test.ts
import { auditEvents, deals, getDb, organizations, properties, users } from '@cema/db';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Only @cema/auth is mocked (org resolution); @cema/db + withRls hit real Neon.
vi.mock('@cema/auth', () => ({ getCurrentOrganizationId: vi.fn() }));

import { getCurrentOrganizationId } from '@cema/auth';

import { getAgentActionCounts } from '../../lib/queries/agent-action-counts';
import { getDealsByStatus } from '../../lib/queries/deals-by-status';

const skip = !process.env.DATABASE_URL;

// Distinctive namespace — never reuse across runs (see neon-integration-test
// collision hazard). Org A is touched ONLY by this suite, so its aggregates are
// deterministic under onConflictDoNothing + stable ids.
const ORG_A = 'da5b0a00-0000-0000-0000-000000000001';
const ORG_B = 'da5b0a00-0000-0000-0000-000000000002';
const USER = 'da5b0a00-0000-0000-0000-000000000003';
const PROP_A1 = 'da5b0a00-0000-0000-0000-000000000004';
const PROP_A2 = 'da5b0a00-0000-0000-0000-000000000005';
const PROP_B1 = 'da5b0a00-0000-0000-0000-000000000006';
const DEAL_A1 = 'da5b0a00-0000-0000-0000-000000000007'; // intake
const DEAL_A2 = 'da5b0a00-0000-0000-0000-000000000008'; // recording
const DEAL_B1 = 'da5b0a00-0000-0000-0000-000000000009'; // closing
const AE_A_DOCGEN1 = 'da5b0a00-0000-0000-0000-00000000000a';
const AE_A_DOCGEN2 = 'da5b0a00-0000-0000-0000-00000000000b';
const AE_A_IDP = 'da5b0a00-0000-0000-0000-00000000000c';
const AE_A_DOC = 'da5b0a00-0000-0000-0000-00000000000d'; // document-scoped (excluded)
const AE_B_INTAKE = 'da5b0a00-0000-0000-0000-00000000000e';
const DOC_ENTITY = 'da5b0a00-0000-0000-0000-00000000000f'; // entityId for the doc-scoped audit

describe.skipIf(skip)('dashboard aggregates (Neon integration)', () => {
  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(organizations)
      .values([
        { id: ORG_A, clerkOrgId: 'dashagg_org_a', name: 'Dash Agg A', slug: 'dashagg-a' },
        { id: ORG_B, clerkOrgId: 'dashagg_org_b', name: 'Dash Agg B', slug: 'dashagg-b' },
      ])
      .onConflictDoNothing();
    await db
      .insert(users)
      .values({ id: USER, clerkUserId: 'dashagg_user', email: 'dashagg@example.invalid' })
      .onConflictDoNothing();
    await db
      .insert(properties)
      .values(
        [PROP_A1, PROP_A2, PROP_B1].map((id, i) => ({
          id,
          streetAddress: `${100 + i} Dash St`,
          city: 'Brooklyn',
          county: 'Kings',
          zipCode: '11201',
          propertyType: 'one_family' as const,
        })),
      )
      .onConflictDoNothing();
    await db
      .insert(deals)
      .values([
        {
          id: DEAL_A1,
          organizationId: ORG_A,
          cemaType: 'refi_cema',
          status: 'intake',
          propertyId: PROP_A1,
          createdById: USER,
        },
        {
          id: DEAL_A2,
          organizationId: ORG_A,
          cemaType: 'refi_cema',
          status: 'recording',
          propertyId: PROP_A2,
          createdById: USER,
        },
        {
          id: DEAL_B1,
          organizationId: ORG_B,
          cemaType: 'refi_cema',
          status: 'closing',
          propertyId: PROP_B1,
          createdById: USER,
        },
      ])
      .onConflictDoNothing();
    // audit_events is append-only — stable ids + onConflictDoNothing make this re-runnable.
    await db
      .insert(auditEvents)
      .values([
        {
          id: AE_A_DOCGEN1,
          organizationId: ORG_A,
          actorUserId: USER,
          action: 'docgen.evaluated',
          entityType: 'deal',
          entityId: DEAL_A1,
          metadata: { count: 7 },
          occurredAt: new Date('2026-06-01T10:00:00Z'),
        },
        {
          id: AE_A_DOCGEN2,
          organizationId: ORG_A,
          actorUserId: USER,
          action: 'docgen.evaluated',
          entityType: 'deal',
          entityId: DEAL_A2,
          metadata: { count: 7 },
          occurredAt: new Date('2026-06-01T10:05:00Z'),
        },
        {
          id: AE_A_IDP,
          organizationId: ORG_A,
          actorUserId: USER,
          action: 'idp.evaluated',
          entityType: 'deal',
          entityId: DEAL_A1,
          metadata: {},
          occurredAt: new Date('2026-06-01T10:10:00Z'),
        },
        {
          id: AE_A_DOC,
          organizationId: ORG_A,
          actorUserId: USER,
          action: 'document.submitted_for_review',
          entityType: 'document',
          entityId: DOC_ENTITY,
          metadata: { source: 'doc-gen' },
          occurredAt: new Date('2026-06-01T10:15:00Z'),
        },
        {
          id: AE_B_INTAKE,
          organizationId: ORG_B,
          actorUserId: USER,
          action: 'intake.evaluated',
          entityType: 'deal',
          entityId: DEAL_B1,
          metadata: {},
          occurredAt: new Date('2026-06-01T10:20:00Z'),
        },
      ])
      .onConflictDoNothing();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('counts deals by status, isolated to the org (getDealsByStatus)', async () => {
    vi.mocked(getCurrentOrganizationId).mockResolvedValue('dashagg_org_a');
    const map = new Map((await getDealsByStatus()).map((c) => [c.status, c.count]));
    expect(map.get('intake')).toBe(1);
    expect(map.get('recording')).toBe(1);
    expect(map.has('closing')).toBe(false); // Org B's deal — isolated
  });

  it('counts deal-scoped audit actions, excluding document-scoped, isolated (getAgentActionCounts)', async () => {
    vi.mocked(getCurrentOrganizationId).mockResolvedValue('dashagg_org_a');
    const map = new Map((await getAgentActionCounts()).map((c) => [c.action, c.count]));
    expect(map.get('docgen.evaluated')).toBe(2);
    expect(map.get('idp.evaluated')).toBe(1);
    expect(map.has('document.submitted_for_review')).toBe(false); // document-scoped excluded
    expect(map.has('intake.evaluated')).toBe(false); // Org B's — isolated
  });

  it('isolates the other org (RLS): Org B sees only its own aggregates', async () => {
    vi.mocked(getCurrentOrganizationId).mockResolvedValue('dashagg_org_b');
    const statusMap = new Map((await getDealsByStatus()).map((c) => [c.status, c.count]));
    expect(statusMap.get('closing')).toBe(1);
    expect(statusMap.has('intake')).toBe(false);
    const actionMap = new Map((await getAgentActionCounts()).map((c) => [c.action, c.count]));
    expect(actionMap.get('intake.evaluated')).toBe(1);
    expect(actionMap.has('docgen.evaluated')).toBe(false);
  });
});
```

- [ ] **Step 3: Run the integration suite (serial)**

Run: `cmd /c "pnpm --filter web test:integration"`
Expected (with `DATABASE_URL` in `.env.local`): the 3 new cases PASS; without it they skip-green.

- [ ] **Step 4: Commit**

```bash
git add apps/web/tests/integration/dashboard-aggregates.test.ts
git commit -S -m "test(dashboard): Neon-gated org-isolation for the aggregate loaders"
```

---

### Task 5: Render-only components

Presentational server components — no client state, no unit tests (logic is in the
pure aggregators). Reuse the `Card` primitive.

**Files:**

- Create: `apps/web/components/pipeline-funnel.tsx`
- Create: `apps/web/components/agent-stat-cards.tsx`

- [ ] **Step 1: Write the funnel**

```tsx
// apps/web/components/pipeline-funnel.tsx
import { type PipelineSummary } from '@/lib/dashboard/pipeline-summary';

function Stage({ label, count, muted }: { label: string; count: number; muted: boolean }) {
  return (
    <div
      className={`min-w-20 rounded-md border px-3 py-2 text-center ${muted ? 'opacity-50' : ''}`}
    >
      <div className="text-foreground text-xl font-semibold tabular-nums">{count}</div>
      <div className="text-muted-foreground text-xs">{label}</div>
    </div>
  );
}

export function PipelineFunnel({ summary }: { summary: PipelineSummary }) {
  if (summary.total === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Deals will appear here as they enter the pipeline.
      </p>
    );
  }
  return (
    <div>
      <div className="flex flex-wrap items-stretch gap-2">
        {summary.stages.map((s) => (
          <Stage key={s.status} label={s.label} count={s.count} muted={s.count === 0} />
        ))}
        <div className="bg-border mx-1 w-px self-stretch" aria-hidden />
        {summary.offRamps.map((s) => (
          <Stage key={s.status} label={s.label} count={s.count} muted={s.count === 0} />
        ))}
      </div>
      <p className="text-muted-foreground mt-2 text-xs">
        {summary.activeTotal} active · {summary.total} total
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Write the card grid**

```tsx
// apps/web/components/agent-stat-cards.tsx
import { Card } from '@cema/ui';

import { type AgentStatCard } from '@/lib/dashboard/agent-activity-summary';

export function AgentStatCards({ cards }: { cards: AgentStatCard[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {cards.map((c) => (
        <Card key={c.key} className="p-4">
          <div className="text-foreground text-2xl font-semibold tabular-nums">{c.count}</div>
          <div className="text-foreground text-sm font-medium">{c.label}</div>
          <div className="text-muted-foreground text-xs">
            {c.unit === 'open' ? 'open' : 'actions'}
          </div>
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `cmd /c "pnpm typecheck"`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/pipeline-funnel.tsx apps/web/components/agent-stat-cards.tsx
git commit -S -m "feat(dashboard): pipeline funnel + agent stat-card components"
```

---

### Task 6: Wire the dashboard page

**Files:**

- Modify: `apps/web/app/(app)/dashboard/page.tsx`

- [ ] **Step 1: Replace the page with the composed version**

```tsx
// apps/web/app/(app)/dashboard/page.tsx
import { formatDistanceToNow } from 'date-fns';
import Link from 'next/link';

import { AgentStatCards } from '@/components/agent-stat-cards';
import { PipelineFunnel } from '@/components/pipeline-funnel';
import { toOrgActivityItem } from '@/lib/agent-activity/org-activity-item';
import { getOrgExceptions } from '@/lib/agents/exception-triage/get-org-exceptions';
import { summarizeAgentActivity } from '@/lib/dashboard/agent-activity-summary';
import { summarizePipeline } from '@/lib/dashboard/pipeline-summary';
import { getAgentActionCounts } from '@/lib/queries/agent-action-counts';
import { getDealsByStatus } from '@/lib/queries/deals-by-status';
import { getOrgAgentActivity } from '@/lib/queries/org-agent-activity';

export default async function DashboardPage() {
  const [statusCounts, actionCounts, exceptions, rows] = await Promise.all([
    getDealsByStatus(),
    getAgentActionCounts(),
    getOrgExceptions(),
    getOrgAgentActivity(),
  ]);

  const pipeline = summarizePipeline(statusCounts);
  const openExceptionCount = exceptions.reduce((n, d) => n + d.exceptions.length, 0);
  const agentCards = summarizeAgentActivity(actionCounts, openExceptionCount);
  const items = rows.map(toOrgActivityItem);

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      <section>
        <h2 className="text-muted-foreground mb-3 text-sm font-medium">Pipeline</h2>
        <PipelineFunnel summary={pipeline} />
      </section>

      <section>
        <h2 className="text-muted-foreground mb-3 text-sm font-medium">Agent activity</h2>
        <AgentStatCards cards={agentCards} />
      </section>

      <section>
        <h2 className="text-muted-foreground mb-4 text-sm font-medium">Recent agent activity</h2>
        {items.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Agent activity will appear here as deals move through the pipeline.
          </p>
        ) : (
          <ol className="border-border relative space-y-6 border-l">
            {items.map((item) => (
              <li key={item.id} className="ml-4">
                <span className="border-background bg-muted absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border" />
                <Link href={`/deals/${item.dealId}`} className="hover:underline">
                  <p className="text-foreground text-sm font-medium">{item.label}</p>
                </Link>
                {item.detail && (
                  <p className="text-muted-foreground max-w-md truncate text-sm">{item.detail}</p>
                )}
                <p className="text-muted-foreground text-xs">{item.context}</p>
                <time className="text-muted-foreground text-xs">
                  {formatDistanceToNow(item.occurredAt, { addSuffix: true })}
                </time>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cmd /c "pnpm typecheck"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/(app)/dashboard/page.tsx"
git commit -S -m "feat(dashboard): compose pipeline funnel + agent cards above the feed"
```

---

### Task 7: Full verification

- [ ] **Step 1: Typecheck (separate from tests — esbuild is transpile-only)**

Run: `cmd /c "pnpm typecheck"`
Expected: PASS.

- [ ] **Step 2: Lint (legacy eslint config; web filter)**

Run: `cmd /c "pnpm --filter web lint"`
Expected: PASS (no errors).

- [ ] **Step 3: Prettier check (lint-staged runs eslint --fix after prettier, so verify formatting explicitly)**

Run: `cmd /c "pnpm prettier --check \"apps/web/lib/dashboard/**\" \"apps/web/lib/queries/deals-by-status.ts\" \"apps/web/lib/queries/agent-action-counts.ts\" \"apps/web/components/pipeline-funnel.tsx\" \"apps/web/components/agent-stat-cards.tsx\" \"apps/web/app/(app)/dashboard/page.tsx\" \"apps/web/tests/integration/dashboard-aggregates.test.ts\" \"docs/plans/2026-06-02-dashboard-pipeline-agent-cards*.md\""`
Expected: "All matched files use Prettier code style!" (if not, run the same with `--write` and re-commit).

- [ ] **Step 4: Full unit suite (default — excludes Neon integration + e2e)**

Run: `cmd /c "pnpm --filter web test"`
Expected: PASS; +9 new tests (5 agent-summary + 4 pipeline-summary); the prior 322 still green.

- [ ] **Step 5: Neon integration suite (serial; skip-green without DATABASE_URL)**

Run: `cmd /c "pnpm --filter web test:integration"`
Expected: the 3 new `dashboard-aggregates` cases PASS (or skip-green in CI).

- [ ] **Step 6: Build (catches RSC/Next issues unit tests miss)**

Run: `cmd /c "pnpm --filter web build"`
Expected: PASS.

---

## Self-review

- **Spec coverage:** pipeline funnel (Tasks 2,5,6) ✓; per-agent all-time cards (Tasks 1,5,6) ✓; Exception-Triage open count (Task 1 + page Task 6) ✓; Lifecycle bucket (Task 1) ✓; org-isolation (Task 4) ✓; PII-safe counts-only (all) ✓; 0 migrations ✓.
- **Type consistency:** `AgentActionCount` defined in `agent-activity-summary.ts`, imported by `agent-action-counts.ts`; `DealStatusCount` defined in `pipeline-summary.ts`, imported by `deals-by-status.ts`; `AgentStatCard` / `PipelineSummary` consumed by the components and page — all names match.
- **No placeholders:** every step has complete code + exact commands.
- **Hazards honored:** distinctive integration namespace, never deletes orgs/users, `entityType='deal'` mirrors the feed, typecheck run separately from tests.
