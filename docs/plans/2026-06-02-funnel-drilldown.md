# Funnel drill-down (clickable pipeline stages → filtered deals) — Design

**Date:** 2026-06-02
**Author:** Claude Opus 4.8 + Connor
**Status:** Approved (brainstorm) → plan

## Goal

Make the dashboard pipeline funnel (shipped in #133) **clickable**: each non-zero stage
links to the `/deals` list filtered to that `deal_status`, so a processor can go from
"3 in Collateral Chase" straight to those 3 deals.

## Approved decisions

- **Landing target:** filter the existing `/deals` list via a `?status=<status>` searchParam
  (not a new page) — one canonical place, reuses `DealCard` (which already shows status).
- **Which stages link:** all **non-zero** stages, active lane _and_ off-ramps. Zero-count stays
  non-clickable.
- **DRY:** consolidate one canonical `dealStatusLabel` (there are already two copies — `DealCard`
  sentence-case, `pipeline-summary` Title Case). Re-point `pipeline-summary` to it (zero visible
  change — identical Title Case). Leave `DealCard` untouched (re-pointing would change its visible
  casing — out of scope).

## Architecture / units

- **New `apps/web/lib/deals/deal-status.ts`** (node-testable, no `@cema/db` runtime dep):
  - `DEAL_STATUS_LABELS` (Title Case, 12 entries) + `type DealStatus = keyof typeof DEAL_STATUS_LABELS`.
  - `dealStatusLabel(status: string): string` — label or the raw status fallback.
  - `parseDealStatusFilter(raw): DealStatus | null` — validates an untrusted searchParam (valid iff a
    known status), the boundary guard.
- **`pipeline-summary.ts`**: import `dealStatusLabel`, drop its local `STATUS_LABELS`/`labelFor`
  (identical Title Case → no visible change; its tests don't assert labels).
- **`list-deals.ts`**: `listDeals(status?: DealStatus)` — conditional `eq(deals.status, status)` in the
  `WHERE` under `withRls` (keeps the existing 50-row cap).
- **`/deals/page.tsx`**: `await searchParams`, `parseDealStatusFilter`, pass to `listDeals`; render a
  "Showing **<Label>** · N deals · [All deals]" header + a filter-aware empty state when filtered.
- **`pipeline-funnel.tsx`**: wrap each non-zero stage in `<Link href={{ pathname: '/deals', query: {
status } }}>` (type-safe `UrlObject` form — no `Route` cast).

## Compliance / scope

- RLS unchanged (extra `WHERE` runs under `withRls`); PII-safe (status enum only); 0 schema, 0 migrations.

## Testing

- **Unit (node):** `parseDealStatusFilter` (valid / invalid / undefined / empty → null); `dealStatusLabel`
  (known + unknown fallback); a **drift guard** asserting `DEAL_STATUS_LABELS` keys == `dealStatusEnum.enumValues`.
- **Integration (Neon-gated, skip-green):** `listDeals('intake')` returns only the org's intake deals
  (excludes other statuses + other org). Distinctive namespace; never deletes orgs/users.
- typecheck / lint / prettier / build. Resolve the typed-routes query href at build (UrlObject; cast fallback).

## Out of scope (YAGNI)

Pagination, multi-status filter, sort controls, filtering the per-agent cards (the separate "filters"
option), re-pointing `DealCard`.
