# Dashboard Drill-Down + Composable Date-Range Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dashboard per-agent stat cards clickable drill-downs into the agent-filtered feed (Exception Triage → `/exceptions`), and add a composable `?since=` time-window filter (24h / 7d / 30d / All) to both activity feeds.

**Architecture:** Three new pure, node-testable modules (`since-filter`, `activity-href`, `stat-card-link`) carry all the logic; the RSC pages + the stat-cards component are thin wiring over them. The two activity loaders gain a `since?: Date` param (a conditions-array refactor). The `?agent=` and `?since=` filters **compose** — every chip/card href is built through `activityHref`/`activityParams` so the two params always travel together.

**Tech Stack:** Next.js 16 App Router (RSC), Drizzle (`and`/`gte`/`like`), TypeScript (strict), Vitest, Tailwind. Reuses the existing `AgentFilterChips` (render-only, `href: string` cast `as Route` once) + `AGENT_FILTERS` (#137) + the funnel drill-down pattern (#135).

---

## File Structure

**New (pure, node-testable):**

- `apps/web/lib/agent-activity/since-filter.ts` — `SINCE_FILTERS`, `parseSinceFilter`, `sinceCutoffMs`. The time-window vocabulary + boundary guard. Mirrors `agent-filter.ts`.
- `apps/web/lib/agent-activity/activity-href.ts` — `activityParams({agent, since})` + `activityHref(base, {agent, since})`. The compose helper (preserves both params).
- `apps/web/lib/dashboard/stat-card-link.ts` — `statCardLink(key)` → where a clicked card drills to.

**Modify:**

- `apps/web/lib/queries/org-agent-activity.ts` — add `since?: Date` (conditions array + `gte(occurredAt, since)`).
- `apps/web/lib/queries/deal-agent-activity.ts` — same.
- `apps/web/components/agent-stat-cards.tsx` — clickable cards + active-ring; new `activeAgent`/`activeSince` props.
- `apps/web/app/(app)/dashboard/page.tsx` — parse `?since=`, cutoff, since-chip row, compose hrefs, pass props to cards, `id="recent-activity"`.
- `apps/web/app/(app)/deals/[id]/agent-activity/page.tsx` — parse `?since=`, cutoff, since-chip row, compose hrefs.

**Tests (extend, Neon-gated):**

- `apps/web/tests/integration/org-agent-activity.test.ts` — a `since`-filter case.
- `apps/web/tests/integration/deal-agent-activity.test.ts` — a `since`-filter case.

**Branch:** `feat/dashboard-drilldown-date-filter`. Sign every commit (`git commit -S`).

---

## Task 1: `since-filter.ts` (the time-window vocabulary)

**Files:**

- Create: `apps/web/lib/agent-activity/since-filter.ts`
- Test: `apps/web/lib/agent-activity/since-filter.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import { SINCE_FILTERS, parseSinceFilter, sinceCutoffMs } from './since-filter';

describe('since-filter', () => {
  it('exposes All + three windows, All first with a null cutoff', () => {
    expect(SINCE_FILTERS.map((f) => f.key)).toEqual(['all', '24h', '7d', '30d']);
    expect(SINCE_FILTERS[0]).toMatchObject({ key: 'all', cutoffMs: null });
  });

  it('parses a real window to its key', () => {
    expect(parseSinceFilter('7d')).toBe('7d');
    expect(parseSinceFilter('24h')).toBe('24h');
  });

  it('treats all / unknown / absent as no filter (null)', () => {
    expect(parseSinceFilter('all')).toBeNull(); // All time == no time filter
    expect(parseSinceFilter('nonsense')).toBeNull();
    expect(parseSinceFilter(undefined)).toBeNull();
    expect(parseSinceFilter(null)).toBeNull();
  });

  it('maps a key to its lookback duration in ms', () => {
    expect(sinceCutoffMs('24h')).toBe(24 * 60 * 60 * 1000);
    expect(sinceCutoffMs('7d')).toBe(7 * 24 * 60 * 60 * 1000);
    expect(sinceCutoffMs('30d')).toBe(30 * 24 * 60 * 60 * 1000);
    expect(sinceCutoffMs('all')).toBeNull();
    expect(sinceCutoffMs('nope')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter web exec vitest run lib/agent-activity/since-filter.test.ts`
Expected: FAIL — `Cannot find module './since-filter'`.

- [ ] **Step 3: Write the implementation**

```ts
/** One time-window filter for the activity feeds. `cutoffMs` is the lookback
 *  duration in milliseconds, or null for "all time" (no filter). */
export interface SinceFilter {
  readonly key: string;
  readonly label: string;
  readonly cutoffMs: number | null;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const SINCE_FILTERS: readonly SinceFilter[] = [
  { key: 'all', label: 'All time', cutoffMs: null },
  { key: '24h', label: '24h', cutoffMs: 24 * HOUR },
  { key: '7d', label: '7d', cutoffMs: 7 * DAY },
  { key: '30d', label: '30d', cutoffMs: 30 * DAY },
];

/** Validate an untrusted `?since=` searchParam. Returns the key only for a real
 *  time window; 'all' / unknown / absent → null (no time filter). */
export function parseSinceFilter(raw: string | undefined | null): string | null {
  if (raw == null) return null;
  const f = SINCE_FILTERS.find((x) => x.key === raw);
  return f && f.cutoffMs !== null ? f.key : null;
}

/** The lookback duration (ms) for a key, or null (all-time / unknown). The RSC
 *  turns this into `new Date(Date.now() - ms)` — Date.now() stays out of here so
 *  this module is deterministic + node-testable. */
export function sinceCutoffMs(key: string): number | null {
  return SINCE_FILTERS.find((f) => f.key === key)?.cutoffMs ?? null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter web exec vitest run lib/agent-activity/since-filter.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/agent-activity/since-filter.ts apps/web/lib/agent-activity/since-filter.test.ts
git commit -S -m "feat(dashboard): add since-filter time-window vocabulary"
```

---

## Task 2: `activity-href.ts` (the compose helper)

**Files:**

- Create: `apps/web/lib/agent-activity/activity-href.ts`
- Test: `apps/web/lib/agent-activity/activity-href.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import { activityHref, activityParams } from './activity-href';

describe('activity-href', () => {
  it('activityParams keeps only the active params', () => {
    expect(activityParams({ agent: 'idp', since: '7d' })).toEqual({ agent: 'idp', since: '7d' });
    expect(activityParams({ agent: 'idp', since: null })).toEqual({ agent: 'idp' });
    expect(activityParams({ agent: null, since: '7d' })).toEqual({ since: '7d' });
    expect(activityParams({})).toEqual({});
  });

  it('builds a composed href, agent before since, stable order', () => {
    expect(activityHref('/dashboard', { agent: 'idp', since: '7d' })).toBe(
      '/dashboard?agent=idp&since=7d',
    );
  });

  it('preserves one param when the other is cleared', () => {
    expect(activityHref('/dashboard', { agent: 'idp' })).toBe('/dashboard?agent=idp');
    expect(activityHref('/dashboard', { since: '24h' })).toBe('/dashboard?since=24h');
  });

  it('returns the bare base path when nothing is active', () => {
    expect(activityHref('/dashboard', {})).toBe('/dashboard');
    expect(activityHref('/deals/abc/agent-activity', { agent: null, since: null })).toBe(
      '/deals/abc/agent-activity',
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter web exec vitest run lib/agent-activity/activity-href.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
/** The active (non-default) activity-feed filter params. Omits null/undefined so
 *  the agent + since filters can be composed into one href and travel together.
 *  Used directly as a Next `UrlObject` query (the stat cards) and serialized for
 *  the chip hrefs (activityHref). */
export function activityParams(opts: {
  agent?: string | null;
  since?: string | null;
}): Record<string, string> {
  const params: Record<string, string> = {};
  if (opts.agent) params.agent = opts.agent;
  if (opts.since) params.since = opts.since;
  return params;
}

/** A ready href string for a filter chip: base path + the composed query (or the
 *  bare base when no filter is active). Param order is stable (agent, then since);
 *  values are safe enum tokens, so no encoding is needed. */
export function activityHref(
  base: string,
  opts: { agent?: string | null; since?: string | null },
): string {
  const query = Object.entries(activityParams(opts))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  return query ? `${base}?${query}` : base;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter web exec vitest run lib/agent-activity/activity-href.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/agent-activity/activity-href.ts apps/web/lib/agent-activity/activity-href.test.ts
git commit -S -m "feat(dashboard): add activity-href compose helper for agent+since filters"
```

---

## Task 3: `stat-card-link.ts` (card → drill-down target)

**Files:**

- Create: `apps/web/lib/dashboard/stat-card-link.ts`
- Test: `apps/web/lib/dashboard/stat-card-link.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import { statCardLink } from './stat-card-link';

describe('statCardLink', () => {
  it('routes an audit-emitting agent card to its feed filter', () => {
    expect(statCardLink('idp')).toEqual({ kind: 'agent', agentKey: 'idp' });
    expect(statCardLink('borrower_comm')).toEqual({ kind: 'agent', agentKey: 'borrower_comm' });
  });

  it('routes the Lifecycle card to its feed filter', () => {
    expect(statCardLink('lifecycle')).toEqual({ kind: 'agent', agentKey: 'lifecycle' });
  });

  it('routes the Exception Triage card to the /exceptions inbox', () => {
    // 'exception' is NOT an audit-action filter (it counts open exceptions).
    expect(statCardLink('exception')).toEqual({ kind: 'exceptions' });
  });

  it('returns null for an unknown card key', () => {
    expect(statCardLink('mystery')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter web exec vitest run lib/dashboard/stat-card-link.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
import { AGENT_FILTERS } from '@/lib/agent-activity/agent-filter';
import { EXCEPTION_TRIAGE_AGENT } from '@/lib/dashboard/agents';

/** Where a clicked dashboard stat card drills to:
 *  - an agent (or Lifecycle) card filters the feed (?agent=<key>);
 *  - the Exception Triage card opens the /exceptions inbox (it has no audit
 *    actions to filter to — its count is open exceptions);
 *  - anything else is not clickable. */
export type StatCardLink = { kind: 'agent'; agentKey: string } | { kind: 'exceptions' } | null;

export function statCardLink(key: string): StatCardLink {
  if (AGENT_FILTERS.some((f) => f.key === key)) return { kind: 'agent', agentKey: key };
  if (key === EXCEPTION_TRIAGE_AGENT.key) return { kind: 'exceptions' };
  return null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter web exec vitest run lib/dashboard/stat-card-link.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/dashboard/stat-card-link.ts apps/web/lib/dashboard/stat-card-link.test.ts
git commit -S -m "feat(dashboard): add stat-card-link drill-down router"
```

---

## Task 4: loaders gain `since?: Date`

**Files:**

- Modify: `apps/web/lib/queries/org-agent-activity.ts`
- Modify: `apps/web/lib/queries/deal-agent-activity.ts`
- Test (extend): `apps/web/tests/integration/org-agent-activity.test.ts`, `apps/web/tests/integration/deal-agent-activity.test.ts`

> The unit logic of these loaders is exercised only by the Neon-gated integration suite (skip-green in CI). The CI gate for this task is `pnpm typecheck`. Verify behavior locally with `pnpm --filter web test:integration` if `DATABASE_URL` is set.

- [ ] **Step 1: Refactor `org-agent-activity.ts` to a conditions array + `since`**

Change the import line `import { and, desc, eq, like } from 'drizzle-orm';` to add `gte`:

```ts
import { and, desc, eq, gte, like } from 'drizzle-orm';
```

Change the signature + `where` (replace the `const pattern = …` through the `.where(…)` call):

```ts
export async function getOrgAgentActivity(
  agentKey?: string,
  since?: Date,
): Promise<OrgAgentActivityRow[]> {
  const clerkOrgId = await getCurrentOrganizationId();
  const db = getDb();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) return [];

  const pattern = agentKey ? agentLikePattern(agentKey) : null;

  return withRls(org.id, async (tx) => {
    const conditions = [eq(auditEvents.entityType, 'deal')];
    if (pattern) conditions.push(like(auditEvents.action, pattern));
    if (since) conditions.push(gte(auditEvents.occurredAt, since));

    const rows = await tx
      .select({
        id: auditEvents.id,
        action: auditEvents.action,
        occurredAt: auditEvents.occurredAt,
        metadata: auditEvents.metadata,
        dealId: deals.id,
        cemaType: deals.cemaType,
        status: deals.status,
        streetAddress: properties.streetAddress,
        city: properties.city,
      })
      .from(auditEvents)
      .innerJoin(deals, eq(auditEvents.entityId, deals.id))
      .leftJoin(properties, eq(deals.propertyId, properties.id))
      .where(and(...conditions))
      .orderBy(desc(auditEvents.occurredAt))
      .limit(LIMIT);

    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      occurredAt: r.occurredAt,
      metadata: r.metadata ?? {},
      dealId: r.dealId,
      cemaType: r.cemaType,
      status: r.status,
      streetAddress: r.streetAddress,
      city: r.city,
    }));
  });
}
```

- [ ] **Step 2: Refactor `deal-agent-activity.ts` to a conditions array + `since`**

Change `import { and, desc, eq, like } from 'drizzle-orm';` → `import { and, desc, eq, gte, like } from 'drizzle-orm';`

Replace the signature + `where`:

```ts
export async function getDealAgentActivity(
  dealId: string,
  agentKey?: string,
  since?: Date,
): Promise<DealAgentActivityEvent[]> {
  const clerkOrgId = await getCurrentOrganizationId();
  const db = getDb();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) return [];

  const pattern = agentKey ? agentLikePattern(agentKey) : null;

  return withRls(org.id, async (tx) => {
    const conditions = [eq(auditEvents.entityType, 'deal'), eq(auditEvents.entityId, dealId)];
    if (pattern) conditions.push(like(auditEvents.action, pattern));
    if (since) conditions.push(gte(auditEvents.occurredAt, since));

    const rows = await tx
      .select({
        id: auditEvents.id,
        action: auditEvents.action,
        occurredAt: auditEvents.occurredAt,
        metadata: auditEvents.metadata,
      })
      .from(auditEvents)
      .where(and(...conditions))
      .orderBy(desc(auditEvents.occurredAt))
      .limit(LIMIT);

    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      occurredAt: r.occurredAt,
      metadata: r.metadata ?? {},
    }));
  });
}
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm --filter web typecheck`
Expected: PASS. (If `conditions` infers too narrowly, annotate `const conditions: SQL[] = [...]` and add `type SQL` to the drizzle-orm import — but `eq/like/gte` all return `SQL`, so inference should hold.)

- [ ] **Step 4: Extend the integration tests with a `since` case**

First **read** `apps/web/tests/integration/org-agent-activity.test.ts` and `apps/web/tests/integration/deal-agent-activity.test.ts` to match their existing seed/namespace pattern (distinctive id + clerk namespace; never DELETE orgs/users — see [[neon-integration-test-parallel-flake]] / CLAUDE.md §19). Add one case per file following that pattern:

- Seed two `audit_events` for the same deal with `occurredAt` far apart — e.g. one at `new Date('2020-01-01')` (old) and one at `new Date()` (recent).
- Call the loader with `since = new Date('2021-01-01')` (a cutoff between them).
- Assert only the recent event returns; assert that without `since` both return.

Example assertion shape (adapt seed to the file's namespace):

```ts
it('since filters by occurredAt', async () => {
  // (seed an OLD + a RECENT audit_event for the suite's deal, per the file's pattern)
  const recentOnly = await getOrgAgentActivity(undefined, new Date('2021-01-01'));
  expect(recentOnly.some((r) => r.id === RECENT_EVENT_ID)).toBe(true);
  expect(recentOnly.some((r) => r.id === OLD_EVENT_ID)).toBe(false);
});
```

- [ ] **Step 5: (If `DATABASE_URL` set) run the integration suite**

Run: `pnpm --filter web test:integration`
Expected: PASS serially (skip-green without `DATABASE_URL`).

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/queries/org-agent-activity.ts apps/web/lib/queries/deal-agent-activity.ts apps/web/tests/integration/org-agent-activity.test.ts apps/web/tests/integration/deal-agent-activity.test.ts
git commit -S -m "feat(dashboard): add since-window filter to the activity loaders"
```

---

## Task 5: clickable stat cards

**Files:**

- Modify: `apps/web/components/agent-stat-cards.tsx`

> RSC/component wiring; verified by `pnpm typecheck` + `pnpm lint` + `pnpm build`. The routing logic it calls is already unit-tested (Task 3).

- [ ] **Step 1: Replace `agent-stat-cards.tsx` in full**

```tsx
import { Card } from '@cema/ui';
import Link from 'next/link';

import { activityParams } from '@/lib/agent-activity/activity-href';
import { type AgentStatCard } from '@/lib/dashboard/agent-activity-summary';
import { statCardLink } from '@/lib/dashboard/stat-card-link';

function CardBody({ card, active }: { card: AgentStatCard; active: boolean }) {
  return (
    <Card className={`h-full p-4 ${active ? 'ring-foreground ring-2' : ''}`}>
      <div className="text-foreground text-2xl font-semibold tabular-nums">{card.count}</div>
      <div className="text-foreground text-sm font-medium">{card.label}</div>
      <div className="text-muted-foreground text-xs">
        {card.unit === 'open' ? 'open' : 'actions'}
      </div>
    </Card>
  );
}

function StatCard({
  card,
  activeAgent,
  activeSince,
}: {
  card: AgentStatCard;
  activeAgent: string | null;
  activeSince: string | null;
}) {
  const link = statCardLink(card.key);
  const body = <CardBody card={card} active={link?.kind === 'agent' && card.key === activeAgent} />;
  if (!link) return body;

  const className = 'block transition-opacity hover:opacity-80';
  if (link.kind === 'exceptions') {
    return (
      <Link href="/exceptions" className={className}>
        {body}
      </Link>
    );
  }
  // An agent (or Lifecycle) card drills into the feed, preserving the active
  // time window, and scrolls to the feed section.
  return (
    <Link
      href={{
        pathname: '/dashboard',
        query: activityParams({ agent: link.agentKey, since: activeSince }),
        hash: 'recent-activity',
      }}
      className={className}
    >
      {body}
    </Link>
  );
}

export function AgentStatCards({
  cards,
  activeAgent,
  activeSince,
}: {
  cards: AgentStatCard[];
  activeAgent: string | null;
  activeSince: string | null;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {cards.map((c) => (
        <StatCard key={c.key} card={c} activeAgent={activeAgent} activeSince={activeSince} />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter web typecheck`
Expected: PASS. (The `{ pathname: '/dashboard', query, hash }` UrlObject + the `"/exceptions"` literal are both known static `Route`s — no `as Route` cast, per the funnel pattern.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/agent-stat-cards.tsx
git commit -S -m "feat(dashboard): make agent stat cards clickable drill-downs"
```

---

## Task 6: dashboard page wiring (since parse + chips + compose)

**Files:**

- Modify: `apps/web/app/(app)/dashboard/page.tsx`

- [ ] **Step 1: Replace `dashboard/page.tsx` in full**

```tsx
import { formatDistanceToNow } from 'date-fns';
import Link from 'next/link';

import { AgentFilterChips, type AgentFilterChip } from '@/components/agent-filter-chips';
import { AgentStatCards } from '@/components/agent-stat-cards';
import { PipelineFunnel } from '@/components/pipeline-funnel';
import { activityHref } from '@/lib/agent-activity/activity-href';
import { AGENT_FILTERS, parseAgentFilter } from '@/lib/agent-activity/agent-filter';
import { SINCE_FILTERS, parseSinceFilter, sinceCutoffMs } from '@/lib/agent-activity/since-filter';
import { toOrgActivityItem } from '@/lib/agent-activity/org-activity-item';
import { getOrgExceptions } from '@/lib/agents/exception-triage/get-org-exceptions';
import { summarizeAgentActivity } from '@/lib/dashboard/agent-activity-summary';
import { summarizePipeline } from '@/lib/dashboard/pipeline-summary';
import { getAgentActionCounts } from '@/lib/queries/agent-action-counts';
import { getDealsByStatus } from '@/lib/queries/deals-by-status';
import { getOrgAgentActivity } from '@/lib/queries/org-agent-activity';

interface PageProps {
  searchParams: Promise<{ agent?: string; since?: string }>;
}

const BASE = '/dashboard';

export default async function DashboardPage({ searchParams }: PageProps) {
  const { agent: rawAgent, since: rawSince } = await searchParams;
  const activeAgent = parseAgentFilter(rawAgent);
  const activeSince = parseSinceFilter(rawSince);
  const cutoffMs = activeSince ? sinceCutoffMs(activeSince) : null;
  const sinceDate = cutoffMs != null ? new Date(Date.now() - cutoffMs) : undefined;

  const [statusCounts, actionCounts, exceptions, rows] = await Promise.all([
    getDealsByStatus(),
    getAgentActionCounts(),
    getOrgExceptions(),
    getOrgAgentActivity(activeAgent ?? undefined, sinceDate),
  ]);

  const pipeline = summarizePipeline(statusCounts);
  const openExceptionCount = exceptions.reduce((n, d) => n + d.exceptions.length, 0);
  const agentCards = summarizeAgentActivity(actionCounts, openExceptionCount);
  const items = rows.map(toOrgActivityItem);

  const agentChips: AgentFilterChip[] = [
    {
      key: 'all',
      label: 'All',
      href: activityHref(BASE, { since: activeSince }),
      active: activeAgent === null,
    },
    ...AGENT_FILTERS.map((f) => ({
      key: f.key,
      label: f.label,
      href: activityHref(BASE, { agent: f.key, since: activeSince }),
      active: activeAgent === f.key,
    })),
  ];

  const sinceChips: AgentFilterChip[] = SINCE_FILTERS.map((f) => ({
    key: f.key,
    label: f.label,
    href: activityHref(BASE, { agent: activeAgent, since: f.cutoffMs === null ? null : f.key }),
    active: f.cutoffMs === null ? activeSince === null : activeSince === f.key,
  }));

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      <section>
        <h2 className="text-muted-foreground mb-3 text-sm font-medium">Pipeline</h2>
        <PipelineFunnel summary={pipeline} />
      </section>

      <section>
        <h2 className="text-muted-foreground mb-3 text-sm font-medium">Agent activity</h2>
        <AgentStatCards cards={agentCards} activeAgent={activeAgent} activeSince={activeSince} />
      </section>

      <section id="recent-activity" className="scroll-mt-6">
        <h2 className="text-muted-foreground mb-4 text-sm font-medium">Recent agent activity</h2>
        <AgentFilterChips chips={agentChips} />
        <AgentFilterChips chips={sinceChips} />
        {items.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {activeAgent || activeSince
              ? 'No activity for this filter.'
              : 'Agent activity will appear here as deals move through the pipeline.'}
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

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/(app)/dashboard/page.tsx"
git commit -S -m "feat(dashboard): wire since filter + clickable cards into the dashboard"
```

---

## Task 7: per-deal timeline wiring (since filter)

**Files:**

- Modify: `apps/web/app/(app)/deals/[id]/agent-activity/page.tsx`

> Dynamic-path hrefs: `activityHref` returns a `string`; `AgentFilterChips` casts `as Route` once at the `<Link>` — the #137 pattern, so no typed-routes flip-flop.

- [ ] **Step 1: Replace `deals/[id]/agent-activity/page.tsx` in full**

```tsx
import { formatDistanceToNow } from 'date-fns';

import { AgentFilterChips, type AgentFilterChip } from '@/components/agent-filter-chips';
import { activityHref } from '@/lib/agent-activity/activity-href';
import { AGENT_FILTERS, parseAgentFilter } from '@/lib/agent-activity/agent-filter';
import { describeAuditEvent } from '@/lib/agent-activity/describe-audit-event';
import { SINCE_FILTERS, parseSinceFilter, sinceCutoffMs } from '@/lib/agent-activity/since-filter';
import { getDealAgentActivity } from '@/lib/queries/deal-agent-activity';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ agent?: string; since?: string }>;
}

export default async function DealAgentActivityPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { agent: rawAgent, since: rawSince } = await searchParams;
  const activeAgent = parseAgentFilter(rawAgent);
  const activeSince = parseSinceFilter(rawSince);
  const cutoffMs = activeSince ? sinceCutoffMs(activeSince) : null;
  const sinceDate = cutoffMs != null ? new Date(Date.now() - cutoffMs) : undefined;

  const events = await getDealAgentActivity(id, activeAgent ?? undefined, sinceDate);

  const base = `/deals/${id}/agent-activity`;
  const agentChips: AgentFilterChip[] = [
    {
      key: 'all',
      label: 'All',
      href: activityHref(base, { since: activeSince }),
      active: activeAgent === null,
    },
    ...AGENT_FILTERS.map((f) => ({
      key: f.key,
      label: f.label,
      href: activityHref(base, { agent: f.key, since: activeSince }),
      active: activeAgent === f.key,
    })),
  ];

  const sinceChips: AgentFilterChip[] = SINCE_FILTERS.map((f) => ({
    key: f.key,
    label: f.label,
    href: activityHref(base, { agent: activeAgent, since: f.cutoffMs === null ? null : f.key }),
    active: f.cutoffMs === null ? activeSince === null : activeSince === f.key,
  }));

  return (
    <div className="p-6">
      <h2 className="mb-4 text-lg font-semibold">Agent activity</h2>
      <AgentFilterChips chips={agentChips} />
      <AgentFilterChips chips={sinceChips} />
      {events.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {activeAgent || activeSince ? 'No activity for this filter.' : 'No agent activity yet.'}
        </p>
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

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/(app)/deals/[id]/agent-activity/page.tsx"
git commit -S -m "feat(dashboard): add since filter to the per-deal agent-activity timeline"
```

---

## Task 8: full verification + PR

- [ ] **Step 1: Typecheck (root)**

Run: `pnpm typecheck`
Expected: PASS (33/33).

- [ ] **Step 2: Lint (root — matches CI; covers apps/web incl. these files)**

Run: `pnpm lint`
Expected: 0 errors. (apps/web HAS a `lint` script, so unlike the agent eval packages these files ARE linted by root lint. Run after `pnpm --filter web exec next typegen` if typed-routes complain — but static UrlObject + the single `as Route` in `AgentFilterChips` avoid that.)

- [ ] **Step 3: Unit tests (root)**

Run: `pnpm test`
Expected: PASS. apps/web default gains the 3 new pure suites (since-filter 4, activity-href 4, stat-card-link 4 = +12 unit). No regressions.

- [ ] **Step 4: Build (the typed-routes source of truth)**

Run: `pnpm --filter web build`
Expected: PASS, `/dashboard` + `/deals/[id]/agent-activity` emit. This is the authoritative typed-routes check.

- [ ] **Step 5: Prettier on changed files (post-commit)**

Run (Bash, LF): `pnpm prettier --check "apps/web/lib/agent-activity/*.ts" "apps/web/lib/dashboard/stat-card-link*.ts" "apps/web/components/agent-stat-cards.tsx" "apps/web/app/(app)/dashboard/page.tsx" "apps/web/app/(app)/deals/[id]/agent-activity/page.tsx" "apps/web/lib/queries/org-agent-activity.ts" "apps/web/lib/queries/deal-agent-activity.ts"`
Expected: all clean (lint-staged formats on commit; re-check post-commit per CLAUDE.md §19).

- [ ] **Step 6: Push + PR**

```bash
git push -u origin feat/dashboard-drilldown-date-filter
gh pr create --title "feat(dashboard): clickable stat-card drill-down + composable date-range filter" --body "<summary + test plan + 🤖 trailer>"
gh pr merge <n> --auto --squash --delete-branch
```

- [ ] **Step 7: Watch CI → green → merged.** Resolve any CodeRabbit thread. GitGuardian/Vercel are known soft-fails.

---

## Self-Review

**1. Spec coverage** — clickable cards (Task 5 + the `statCardLink` of Task 3, wired in Task 6); Exception Triage → `/exceptions` (Task 3); date filter on both feeds (Task 1 vocab + Task 4 loaders + Tasks 6/7 pages); composing filters (Task 2 `activityHref`, used in every chip/card href); active highlight (Task 5 + Task 6 props). ✓

**2. Placeholder scan** — all pure modules + the two replaced components/pages are complete code. The only "read first" is Task 4 Step 4's integration-test extension, which is intentional (the Neon seed namespace must match the existing file; the assertion shape + approach are given). No TBD/TODO. ✓

**3. Type consistency** — `parseSinceFilter`/`sinceCutoffMs` (Task 1) used in Tasks 6/7; `activityParams`/`activityHref` (Task 2) used in Tasks 5/6/7; `statCardLink` returning `{kind:'agent',agentKey}|{kind:'exceptions'}|null` (Task 3) consumed in Task 5; loaders' new `since?: Date` 2nd/3rd param (Task 4) matches the call sites `getOrgAgentActivity(activeAgent ?? undefined, sinceDate)` (Task 6) + `getDealAgentActivity(id, activeAgent ?? undefined, sinceDate)` (Task 7); `AgentStatCards` props `{cards, activeAgent, activeSince}` (Task 5) match the call site (Task 6). ✓

**4. Compose-filter correctness** — agent chips pass `since: activeSince` (preserve window); since chips pass `agent: activeAgent` (preserve agent) + map the `all` preset to `since: null` (clear); cards pass `since: activeSince`. The `all` agent chip is active when `activeAgent === null`; the `all` since chip is active when `activeSince === null`. ✓
