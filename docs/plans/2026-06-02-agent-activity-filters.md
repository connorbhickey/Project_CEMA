# Agent-activity filters — Design + Plan

**Date:** 2026-06-02 · **Status:** approved (batch "continue on all")

**Goal:** Filter the org `/dashboard` feed and the per-deal `/deals/[id]/agent-activity` timeline by
agent, via a `?agent=<key>` searchParam (server-side, RSC). Reuses the `AGENTS` registry.

## Architecture

- **New `apps/web/lib/agent-activity/agent-filter.ts`** (node-testable):
  - `AGENT_FILTERS`: ordered `{ key, label, pattern }[]` = the 8 audit-emitting agents (from `AGENTS`,
    `pattern = prefix + '%'`) + a `lifecycle` bucket (`'deal.%'`). Exception Triage excluded (no audits).
  - `parseAgentFilter(raw): string | null` — valid filter key or null (the boundary guard).
  - `agentLikePattern(key): string | null` — the SQL `LIKE` pattern for a key, or null.
- **Loaders** gain an optional `agentKey`:
  - `getOrgAgentActivity(agentKey?)` and `getDealAgentActivity(dealId, agentKey?)` add
    `like(auditEvents.action, pattern)` when set.
- **New `apps/web/components/agent-filter-chips.tsx`** (RSC, render-only): an "All" chip + one per
  `AGENT_FILTERS` entry; active chip highlighted. Takes pre-built `{ label, href, active }[]` items so
  each page supplies type-correct hrefs (dashboard: `UrlObject`; deal page: `as Route` string — the
  dynamic-path case).
- **Pages**: dashboard + agent-activity read `?agent=`, pass to the loader, render the chips above the feed.

## Compliance / scope

PII-safe (action-prefix patterns only); RLS unchanged (extra `WHERE` under `withRls`); 0 migrations.
**Out of scope:** multi-select, date filters, filtering the funnel/cards.

## Tasks (TDD)

### Task 1: `agent-filter.ts` + tests

- RED: `apps/web/lib/agent-activity/agent-filter.test.ts` — `parseAgentFilter` (valid agent, `lifecycle`,
  invalid, undefined → null); `agentLikePattern` (`idp` → `'idp.%'`, `lifecycle` → `'deal.%'`, invalid → null);
  `AGENT_FILTERS` shape (9 entries: 8 agents + lifecycle, each with a `%` pattern; excludes `exception`).
- GREEN: implement deriving from `AGENTS`.
- Commit.

### Task 2: loader filters + integration

- Add optional `agentKey?` to both loaders (conditional `like`). Extend the existing
  `dashboard-aggregates` / add a small case asserting `getOrgAgentActivity('idp')` returns only `idp.*`.
- Typecheck; commit.

### Task 3: chips component + wire both pages

- `agent-filter-chips.tsx` (render-only). Dashboard page: `?agent=` + UrlObject chip hrefs. Deal page:
  add `searchParams`, `?agent=` + `as Route` chip hrefs.
- Typecheck + build; commit.

### Task 4: full verification

- typecheck / lint / prettier / `web test` / `test:integration` / build.
