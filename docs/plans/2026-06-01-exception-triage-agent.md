# Exception Triage Agent (v1) — Design Spec

> **Status:** Approved (Connor, 2026-06-01) — implementation pending.
> **Milestone:** Phase 1 (the 5th of 7 Layer-3 agents — spec §9.11). Pull/derive model.
> **Authoritative spec:** `docs/superpowers/specs/2026-05-12-cema-ai-processor-design.md` §9.11.

---

## 1. Goal & scope

A unified, cross-deal view of "what needs a human and where it goes," **derived** (pull) from
signals the other agents already emit — no agent changes, no new table, no clock, no LLM.

**In scope:** a pure deterministic classifier (`triageExceptions`) in a new
`@cema/agents-exception-triage` package; an RLS-scoped app aggregator that gathers a deal's live
signals; a cross-deal exception inbox at `/exceptions` + a sidebar entry.

**Out of scope (deferred — noted for a "Tier 2"):** a persisted triage queue + resolution tracking;
the LLM diagnostic/remediation surface (dormant, like the savings narrative); real actuation
(routes are _suggested pointers_ to existing remedies, not new actuators); a deal-scoped panel;
time-based exceptions (SLA/stalled — `deals.sla_breach_at`/`target_close_at` are dormant columns
with no writer yet, so an SLA kind would always be empty); `unreadable_collateral` (coarse — a count
from IDP audit metadata; the IDP does not persist unreadable docs); Phase-2 kinds (rejected
recording, borrower lapse).

## 2. Pure core — `@cema/agents-exception-triage` (new 25th package)

Mirrors the thin sibling packages (no `@cema/db` — it takes plain `DealSignals` as input).

```ts
export const EXCEPTION_KINDS = [
  'chain_break',
  'agent_dispatch_failed',
  'deal_flagged_exception',
] as const;
export type ExceptionKind = (typeof EXCEPTION_KINDS)[number];
export const EXCEPTION_SEVERITIES = ['low', 'medium', 'high', 'blocking'] as const;
export type ExceptionSeverity = (typeof EXCEPTION_SEVERITIES)[number];
export const EXCEPTION_ROUTES = ['attorney_review', 'reprocess', 'processor_review'] as const;
export type ExceptionRoute = (typeof EXCEPTION_ROUTES)[number];

export interface Exception {
  readonly kind: ExceptionKind;
  readonly severity: ExceptionSeverity;
  readonly route: ExceptionRoute;
  readonly reason: string; // static PII-free template
}
export interface DealSignals {
  readonly dealStatus: string; // deals.status
  readonly chainBreakCount: number; // open chain_break_review_queue rows
  readonly dispatchFailed: boolean; // a deal.agent_dispatch_failed audit present
}
export function triageExceptions(signals: DealSignals): Exception[];
```

- `chainBreakCount > 0` → `chain_break` (high, → `attorney_review`).
- `dispatchFailed` → `agent_dispatch_failed` (medium, → `reprocess`).
- `dealStatus === 'exception'` → `deal_flagged_exception` (high, → `processor_review`).
- Severity + route come from `SEVERITY_BY_KIND` / `ROUTE_BY_KIND` maps with a **load-time
  exhaustiveness guard** over `EXCEPTION_KINDS` (mirrors `ROUTE_BY_BREAK`). Pure, clockless, no LLM,
  PII-safe by construction (enum tokens + static reasons only).

## 3. App aggregator (loader)

`apps/web/lib/agents/exception-triage/`:

- `getOrgExceptions(): { dealId; dealStatus; exceptions: Exception[] }[]` — RLS-scoped. Gather, per
  deal in the org: `deals.status`; open (`pending`|`claimed`) `chain_break_review_queue` counts
  grouped by `deal_id`; the set of `deal_id`s with a `deal.agent_dispatch_failed` audit event. Build
  `DealSignals` per deal, run `triageExceptions`, keep deals with ≥1 exception. (2–3 RLS queries +
  app-side merge, mirroring `listReviewQueue`.)
- A pure `groupBySeverity` / ordering helper if the page needs it (unit-tested).

## 4. Surface

A cross-deal **exception inbox** at `apps/web/app/(app)/exceptions/page.tsx` — open exceptions across
deals, ordered by severity (blocking → low), each row showing kind + severity + reason + a link to
the relevant existing surface (`chain_break` → `/deals/[id]/documents`; others → the deal). A
"Exceptions" sidebar entry. Mirrors `/attorney/chain-queue`.

## 5. PII, audit, testing

PII-safe (enum tokens + static reasons + ids only). **No audit / no state change** (read-only
derived view). Tests: `triageExceptions` pure unit tests (each kind, severity, route,
exhaustiveness guard, no-PII, empty) — the real gate; a Neon-gated RLS integration test for
`getOrgExceptions` (create signals across deals/orgs, assert classification + org isolation), on a
dedicated `extr`/`e2c1…` identifier namespace. No migration, no vendor key.

## 6. Tradeoffs

`chain_break` also appears in the chain inbox — intentional (Triage is the unified pane, pointing
back). `dispatchFailed` is sticky/coarse (a dispatch-failure audit has no "resolved" marker, so it
surfaces until the deal stops failing) — acceptable for v1; a resolution marker is Tier-2 work.

## 7. Files

- **New package:** `packages/agents/exception-triage/{package.json, tsconfig.json, src/types.ts,
src/triage.ts, src/index.ts, src/triage.test.ts}`.
- **New (apps/web):** `lib/agents/exception-triage/get-org-exceptions.ts` (+ integration test);
  `app/(app)/exceptions/page.tsx`.
- **Modify:** `apps/web/components/sidebar.tsx` (+entry); `apps/web/package.json` (+dep).
- **No migration; no vendor key.**
