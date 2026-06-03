# Funnel Drill-down Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make dashboard pipeline-funnel stages clickable → the `/deals` list filtered by `?status=`.

**Architecture:** A canonical node-testable `deal-status` helper (labels + searchParam validation) feeds a `?status=` filter on the existing `/deals` list; the funnel stages become `Link`s. No schema, no migration.

**Tech Stack:** Next.js 16 RSC + async `searchParams`, Drizzle (`and`/`eq`), `withRls`, Vitest.

---

## File structure

| File                                                         | Responsibility                                                                           |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `apps/web/lib/deals/deal-status.ts` (new)                    | canonical `DEAL_STATUS_LABELS`, `dealStatusLabel`, `parseDealStatusFilter`, `DealStatus` |
| `apps/web/lib/deals/deal-status.test.ts` (new)               | unit + drift-guard tests                                                                 |
| `apps/web/lib/dashboard/pipeline-summary.ts` (modify)        | re-point to `dealStatusLabel`                                                            |
| `apps/web/lib/actions/list-deals.ts` (modify)                | optional `status?` filter                                                                |
| `apps/web/tests/integration/list-deals-filter.test.ts` (new) | Neon-gated filter + RLS test                                                             |
| `apps/web/app/(app)/deals/page.tsx` (modify)                 | read `?status=`, filter, header                                                          |
| `apps/web/components/pipeline-funnel.tsx` (modify)           | non-zero stages link to `/deals?status=`                                                 |

---

### Task 1: Canonical `deal-status` helper

**Files:**

- Create: `apps/web/lib/deals/deal-status.ts`
- Test: `apps/web/lib/deals/deal-status.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/lib/deals/deal-status.test.ts
import { dealStatusEnum } from '@cema/db';
import { describe, expect, it } from 'vitest';

import { DEAL_STATUS_LABELS, dealStatusLabel, parseDealStatusFilter } from './deal-status';

describe('dealStatusLabel', () => {
  it('returns the Title-Case label for a known status', () => {
    expect(dealStatusLabel('collateral_chase')).toBe('Collateral Chase');
  });
  it('falls back to the raw value for an unknown status', () => {
    expect(dealStatusLabel('mystery')).toBe('mystery');
  });
});

describe('parseDealStatusFilter', () => {
  it('accepts a valid status', () => {
    expect(parseDealStatusFilter('intake')).toBe('intake');
  });
  it('rejects an unknown status', () => {
    expect(parseDealStatusFilter('foo')).toBeNull();
  });
  it('rejects undefined and empty', () => {
    expect(parseDealStatusFilter(undefined)).toBeNull();
    expect(parseDealStatusFilter('')).toBeNull();
  });
});

describe('DEAL_STATUS_LABELS drift guard', () => {
  it('covers exactly the deal_status enum', () => {
    expect(Object.keys(DEAL_STATUS_LABELS).sort()).toEqual([...dealStatusEnum.enumValues].sort());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cmd /c "pnpm --filter web exec vitest run lib/deals/deal-status.test.ts"`
Expected: FAIL — cannot find module `./deal-status`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/web/lib/deals/deal-status.ts

/**
 * Canonical deal_status display labels (Title Case) + searchParam validation.
 * Single source of truth for status labels across the dashboard funnel and the
 * /deals filter. The drift-guard test asserts these keys stay in lockstep with
 * the deal_status pg enum (so a future status can't silently lose a label).
 */
export const DEAL_STATUS_LABELS = {
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
} as const;

export type DealStatus = keyof typeof DEAL_STATUS_LABELS;

/** Display label for a status, or the raw value if unknown. */
export function dealStatusLabel(status: string): string {
  return (DEAL_STATUS_LABELS as Record<string, string>)[status] ?? status;
}

/**
 * Validate an untrusted `?status=` searchParam against the known statuses.
 * Returns the status if valid, else null (→ show all) — the boundary guard that
 * keeps the deals query total (no `WHERE status = '<garbage>'`).
 */
export function parseDealStatusFilter(raw: string | undefined | null): DealStatus | null {
  return raw != null && raw in DEAL_STATUS_LABELS ? (raw as DealStatus) : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cmd /c "pnpm --filter web exec vitest run lib/deals/deal-status.test.ts"`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/deals/deal-status.ts apps/web/lib/deals/deal-status.test.ts
git commit -S -m "feat(deals): canonical deal-status labels + searchParam validation"
```

---

### Task 2: Re-point `pipeline-summary` to the shared label

**Files:**

- Modify: `apps/web/lib/dashboard/pipeline-summary.ts`

- [ ] **Step 1: Replace the local label map with the shared helper**

In `apps/web/lib/dashboard/pipeline-summary.ts`, add the import at the top (after the file's opening comment / with other imports — this file currently has no imports, so add it as the first line):

```ts
import { dealStatusLabel } from '@/lib/deals/deal-status';
```

Delete the local `STATUS_LABELS` constant and the `labelFor` function entirely, and replace the two `labelFor(status)` call sites (in the `stages` and `offRamps` maps) with `dealStatusLabel(status)`.

- [ ] **Step 2: Run the pipeline-summary tests (must stay green — labels are identical)**

Run: `cmd /c "pnpm --filter web exec vitest run lib/dashboard/pipeline-summary.test.ts"`
Expected: PASS (4 tests) — the Title-Case labels are byte-identical, so nothing changes.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/dashboard/pipeline-summary.ts
git commit -S -m "refactor(dashboard): use shared dealStatusLabel in pipeline-summary"
```

---

### Task 3: `list-deals` status filter + Neon integration test

**Files:**

- Modify: `apps/web/lib/actions/list-deals.ts`
- Create: `apps/web/tests/integration/list-deals-filter.test.ts`

- [ ] **Step 1: Confirm the integration namespace is unused**

Run: `cmd /c "git grep -n d3a15f00 -- apps/web/tests || echo UNUSED"` and
`cmd /c "git grep -n dealfilter_ -- apps/web/tests || echo UNUSED"`
Expected: both print `UNUSED`.

- [ ] **Step 2: Write the failing integration test**

```ts
// apps/web/tests/integration/list-deals-filter.test.ts
import { deals, getDb, organizations, properties, users } from '@cema/db';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@cema/auth', () => ({ getCurrentOrganizationId: vi.fn() }));

import { getCurrentOrganizationId } from '@cema/auth';

import { listDeals } from '../../lib/actions/list-deals';

const skip = !process.env.DATABASE_URL;

// Distinctive namespace — never reuse (collision hazard). Org A touched only here.
const ORG_A = 'd3a15f00-0000-0000-0000-000000000001';
const ORG_B = 'd3a15f00-0000-0000-0000-000000000002';
const USER = 'd3a15f00-0000-0000-0000-000000000003';
const PROP_A1 = 'd3a15f00-0000-0000-0000-000000000004';
const PROP_A2 = 'd3a15f00-0000-0000-0000-000000000005';
const PROP_B1 = 'd3a15f00-0000-0000-0000-000000000006';
const DEAL_A_INTAKE = 'd3a15f00-0000-0000-0000-000000000007';
const DEAL_A_RECORDING = 'd3a15f00-0000-0000-0000-000000000008';
const DEAL_B_INTAKE = 'd3a15f00-0000-0000-0000-000000000009';

describe.skipIf(skip)('listDeals status filter (Neon integration)', () => {
  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(organizations)
      .values([
        { id: ORG_A, clerkOrgId: 'dealfilter_org_a', name: 'Deal Filter A', slug: 'dealfilter-a' },
        { id: ORG_B, clerkOrgId: 'dealfilter_org_b', name: 'Deal Filter B', slug: 'dealfilter-b' },
      ])
      .onConflictDoNothing();
    await db
      .insert(users)
      .values({ id: USER, clerkUserId: 'dealfilter_user', email: 'dealfilter@example.invalid' })
      .onConflictDoNothing();
    await db
      .insert(properties)
      .values(
        [PROP_A1, PROP_A2, PROP_B1].map((id, i) => ({
          id,
          streetAddress: `${200 + i} Filter Ave`,
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
          id: DEAL_A_INTAKE,
          organizationId: ORG_A,
          cemaType: 'refi_cema',
          status: 'intake',
          propertyId: PROP_A1,
          createdById: USER,
        },
        {
          id: DEAL_A_RECORDING,
          organizationId: ORG_A,
          cemaType: 'refi_cema',
          status: 'recording',
          propertyId: PROP_A2,
          createdById: USER,
        },
        {
          id: DEAL_B_INTAKE,
          organizationId: ORG_B,
          cemaType: 'refi_cema',
          status: 'intake',
          propertyId: PROP_B1,
          createdById: USER,
        },
      ])
      .onConflictDoNothing();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('filters to the requested status, scoped to the org', async () => {
    vi.mocked(getCurrentOrganizationId).mockResolvedValue('dealfilter_org_a');
    const ids = (await listDeals('intake')).map((d) => d.id);
    expect(ids).toContain(DEAL_A_INTAKE);
    expect(ids).not.toContain(DEAL_A_RECORDING); // other status excluded
    expect(ids).not.toContain(DEAL_B_INTAKE); // other org excluded (RLS)
  });

  it('returns all org deals when no status is passed', async () => {
    vi.mocked(getCurrentOrganizationId).mockResolvedValue('dealfilter_org_a');
    const ids = (await listDeals()).map((d) => d.id);
    expect(ids).toContain(DEAL_A_INTAKE);
    expect(ids).toContain(DEAL_A_RECORDING);
    expect(ids).not.toContain(DEAL_B_INTAKE);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cmd /c "pnpm --filter web exec vitest run --config vitest.neon.config.ts tests/integration/list-deals-filter.test.ts"`
Expected: FAIL — `listDeals('intake')` is a type error / arg ignored (the param doesn't exist yet). (Without `DATABASE_URL` it skips — then rely on Step 5 typecheck for RED evidence.)

- [ ] **Step 4: Add the status filter to `list-deals.ts`**

Replace the file with:

```ts
// apps/web/lib/actions/list-deals.ts
import { getCurrentOrganizationId } from '@cema/auth';
import { deals, getDb, organizations } from '@cema/db';
import { and, desc, eq } from 'drizzle-orm';

import { type DealStatus } from '@/lib/deals/deal-status';
import { withRls } from '@/lib/with-rls';

export type Deal = typeof deals.$inferSelect;

export async function listDeals(status?: DealStatus): Promise<Deal[]> {
  const clerkOrgId = await getCurrentOrganizationId();
  const db = getDb();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) return [];
  return withRls(org.id, async (tx) =>
    tx.query.deals.findMany({
      where: status
        ? and(eq(deals.organizationId, org.id), eq(deals.status, status))
        : eq(deals.organizationId, org.id),
      orderBy: [desc(deals.createdAt)],
      limit: 50,
    }),
  );
}
```

- [ ] **Step 5: Verify GREEN (integration + typecheck)**

Run: `cmd /c "pnpm --filter web exec vitest run --config vitest.neon.config.ts tests/integration/list-deals-filter.test.ts"`
Expected: 2 cases PASS (or skip-green without `DATABASE_URL`).
Run: `cmd /c "pnpm typecheck"`
Expected: PASS (confirms `eq(deals.status, status)` typechecks with `DealStatus`).

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/actions/list-deals.ts apps/web/tests/integration/list-deals-filter.test.ts
git commit -S -m "feat(deals): optional status filter on listDeals"
```

---

### Task 4: `/deals` page — read `?status=`, filter, header

**Files:**

- Modify: `apps/web/app/(app)/deals/page.tsx`

- [ ] **Step 1: Replace the page**

```tsx
// apps/web/app/(app)/deals/page.tsx
import { Button } from '@cema/ui';
import type { Route } from 'next';
import Link from 'next/link';

import { DealCard } from '@/components/deal-card';
import { listDeals } from '@/lib/actions/list-deals';
import { dealStatusLabel, parseDealStatusFilter } from '@/lib/deals/deal-status';

const NEW_DEAL_HREF = '/deals/new' as Route<'/deals/new'>;
const ALL_DEALS_HREF = '/deals' as Route<'/deals'>;

interface PageProps {
  searchParams: Promise<{ status?: string }>;
}

export default async function Page({ searchParams }: PageProps) {
  const { status: rawStatus } = await searchParams;
  const status = parseDealStatusFilter(rawStatus);
  const deals = await listDeals(status ?? undefined);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Deals</h1>
        <Link href={NEW_DEAL_HREF}>
          <Button>New deal</Button>
        </Link>
      </div>

      {status && (
        <p className="text-muted-foreground mb-4 flex items-center gap-2 text-sm">
          <span>
            Showing <span className="text-foreground font-medium">{dealStatusLabel(status)}</span> ·{' '}
            {deals.length} {deals.length === 1 ? 'deal' : 'deals'}
          </span>
          <Link href={ALL_DEALS_HREF} className="underline">
            All deals
          </Link>
        </p>
      )}

      {deals.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {status
            ? `No deals in ${dealStatusLabel(status)}.`
            : 'No deals yet. Click "New deal" to create your first.'}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {deals.map((deal) => (
            <DealCard key={deal.id} deal={deal} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cmd /c "pnpm typecheck"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/(app)/deals/page.tsx"
git commit -S -m "feat(deals): filter the deals list by ?status= searchParam"
```

---

### Task 5: Make funnel stages clickable

**Files:**

- Modify: `apps/web/components/pipeline-funnel.tsx`

- [ ] **Step 1: Wrap non-zero stages in a Link**

Replace the file with:

```tsx
// apps/web/components/pipeline-funnel.tsx
import Link from 'next/link';

import { type PipelineStage, type PipelineSummary } from '@/lib/dashboard/pipeline-summary';

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

// A non-zero stage links to the deals list filtered to its status; a zero stage
// is inert (nothing to drill into).
function StageBox({ stage }: { stage: PipelineStage }) {
  const box = <Stage label={stage.label} count={stage.count} muted={stage.count === 0} />;
  if (stage.count === 0) return box;
  return (
    <Link
      href={{ pathname: '/deals', query: { status: stage.status } }}
      className="rounded-md transition-opacity hover:opacity-80"
    >
      {box}
    </Link>
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
          <StageBox key={s.status} stage={s} />
        ))}
        <div className="bg-border mx-1 w-px self-stretch" aria-hidden />
        {summary.offRamps.map((s) => (
          <StageBox key={s.status} stage={s} />
        ))}
      </div>
      <p className="text-muted-foreground mt-2 text-xs">
        {summary.activeTotal} active · {summary.total} total
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck (confirms the UrlObject href is type-safe under typed routes)**

Run: `cmd /c "pnpm typecheck"`
Expected: PASS. If it errors on the `href` object, fall back to
`href={`/deals?status=${stage.status}` as Route}` (import `type { Route } from 'next'`).

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/pipeline-funnel.tsx
git commit -S -m "feat(dashboard): link funnel stages to the filtered deals list"
```

---

### Task 6: Full verification

- [ ] **Step 1: Typecheck**

Run: `cmd /c "pnpm typecheck"` → PASS.

- [ ] **Step 2: Lint**

Run: `cmd /c "pnpm --filter web lint"` → 0 errors (confirm new files add no warnings).

- [ ] **Step 3: Prettier check**

Run: `cmd /c "pnpm prettier --check \"apps/web/lib/deals/**\" \"apps/web/lib/dashboard/pipeline-summary.ts\" \"apps/web/lib/actions/list-deals.ts\" \"apps/web/components/pipeline-funnel.tsx\" \"apps/web/app/(app)/deals/page.tsx\" \"apps/web/tests/integration/list-deals-filter.test.ts\" \"docs/plans/2026-06-02-funnel-drilldown*.md\""`
Expected: "All matched files use Prettier code style!" (else `--write` + re-commit).

- [ ] **Step 4: Full unit suite**

Run: `cmd /c "pnpm --filter web test"`
Expected: PASS; +6 new tests (deal-status); the prior 331 still green; pipeline-summary still 4.

- [ ] **Step 5: Neon integration suite (serial)**

Run: `cmd /c "pnpm --filter web test:integration"`
Expected: the 2 new `list-deals-filter` cases PASS (or skip-green without `DATABASE_URL`); the rest still pass.

- [ ] **Step 6: Build**

Run: `cmd /c "pnpm --filter web build"`
Expected: PASS; `/deals` + `/dashboard` present.

---

## Self-review

- **Spec coverage:** clickable non-zero stages (Task 5) ✓; `/deals` `?status=` filter (Tasks 3,4) ✓;
  filter header + clear link (Task 4) ✓; canonical label + validation (Task 1) ✓; DRY re-point (Task 2) ✓;
  drift guard (Task 1) ✓; RLS-scoped filter integration (Task 3) ✓; 0 migrations ✓.
- **Type consistency:** `DealStatus` defined in `deal-status.ts`, consumed by `list-deals.ts` + the page;
  `parseDealStatusFilter` returns `DealStatus | null`, page passes `status ?? undefined` to `listDeals`;
  `PipelineStage` imported by the funnel from `pipeline-summary.ts`.
- **No placeholders:** complete code + exact commands in every step.
- **Hazards honored:** distinctive integration namespace, never deletes orgs/users, typed-routes href
  resolved at build (UrlObject + cast fallback), typecheck run separately from tests.
