# Dashboard pipeline funnel + agent stat cards — Design

**Date:** 2026-06-02
**Author:** Claude Opus 4.8 + Connor
**Status:** Approved (brainstorm) → plan

## Goal

Turn the `/dashboard` landing page from a bare activity feed into an at-a-glance
operations view: a **deals-by-status pipeline funnel** (the book of business) and
**per-agent stat cards** (the fleet's all-time work), above the existing
"Recent agent activity" feed (which is unchanged).

This is the third UI-surfacing of the dormant agent layer, after the per-deal
Agent Activity timeline (PR #123) and the org-wide dashboard feed (PR #125). It
is a **read-side aggregation only**: no schema, no migration, no agent changes,
no vendor.

## Approved decisions

| Decision               | Choice                                                    |
| ---------------------- | --------------------------------------------------------- |
| Per-agent count window | **All-time totals** (no date filter)                      |
| Card set               | **9 agents + a Lifecycle bucket** (10 cards)              |
| Pipeline shape         | **Ordered stage funnel** (active lane + off-ramps)        |
| Exception Triage card  | **Option A — open-exceptions count** (it emits no audits) |

## Key facts that shape the design

- Agent + deal-lifecycle audit actions are written `entityType='deal'`; **document**
  actions (`document.*`) are written `entityType='document'`, so mirroring the
  existing feed's `entityType='deal'` filter keeps the counts consistent and means
  the **Lifecycle** bucket = `deal.*` events.
- **Exception Triage emits no audit actions** — `get-org-exceptions.ts` only _reads_
  others' audits. So its card count comes from open exceptions (`getOrgExceptions`),
  a distinct unit (`open`) the UI labels accordingly.
- `auditEvents` and `deals` both carry `organizationId` + org RLS; aggregation runs
  under `withRls` (and filters org explicitly, mirroring `getOrgExceptions`).
- `deal_status` lifecycle order: `intake → eligibility → authorization →
collateral_chase → title_work → doc_prep → attorney_review → closing → recording`,
  with `completed` / `exception` / `cancelled` as off-ramps.

## Architecture — 2 loaders + 2 pure aggregators + 1 registry (the house pattern)

**Loaders** (`apps/web/lib/queries/`, RLS-scoped, all-time `GROUP BY`):

- `getDealsByStatus(): DealStatusCount[]` — `deals` grouped by `status`.
- `getAgentActionCounts(): AgentActionCount[]` — `audit_events` (`entityType='deal'`)
  grouped by `action`.

**Pure aggregators** (`apps/web/lib/dashboard/`, node-testable, no DB):

- `summarizePipeline(counts)` → ordered active stages (zero-filled) + off-ramps +
  `activeTotal` + `total` (`total` counts unknown statuses so it never under-reports).
- `summarizeAgentActivity(actionCounts, openExceptionCount)` → a stable 10-card set:
  the 8 audit-emitting agents (pipeline order) + Exception Triage (open count) +
  Lifecycle (`deal.*` + any unmapped action).

**Registry** (`apps/web/lib/dashboard/agents.ts`): an ordered `AGENTS` array of
`{ key, label, prefix }` — the single source of truth the summarizer folds actions
into by dotted-prefix match.

**Page** (`apps/web/app/(app)/dashboard/page.tsx`): `Promise.all` the 4 loaders
(`getDealsByStatus`, `getAgentActionCounts`, `getOrgExceptions`, `getOrgAgentActivity`),
run the aggregators, render `<PipelineFunnel>` + `<AgentStatCards>` + the existing feed.

**Presentational components** (`apps/web/components/`, plain server components):
`pipeline-funnel.tsx`, `agent-stat-cards.tsx` — no client state, reuse the `Card`
primitive. Logic lives in the pure aggregators, so these are render-only (not unit-tested).

## Compliance

- **PII-safe by construction** (hard rule #3): every output is an integer count —
  no names, no metadata rendered.
- **0 migrations, 0 schema, 0 agent changes.** RLS org-scoped on both loaders.

## Out of scope (YAGNI)

Time windows, filters, drill-downs, charts/sparklines, per-agent "last active",
real-time refresh. Just counts, this PR.

## Testing

- **Unit (node):** `summarizeAgentActivity` (fold+sum, Lifecycle catch-all, Exception
  special-case, stable 10-card order, no cross-prefix mapping); `summarizePipeline`
  (canonical order + zero-fill, off-ramp split, `activeTotal` vs `total`, unknown
  status, empty input).
- **Integration (Neon-gated, skip-green):** one file asserting both loaders are
  **org-isolated** and `getAgentActionCounts` excludes document-scoped events —
  distinctive-namespace seed, never deletes orgs/users.
