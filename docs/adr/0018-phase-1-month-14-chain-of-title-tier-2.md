# ADR 0018: Phase 1 Month 14 — Chain-of-Title Tier 2 (durable attorney-review queue)

**Status:** Accepted (shipped 2026-06-01)
**Author:** M14 Chain-of-Title Tier 2 (Claude Opus 4.8 + Connor Hickey)
**Relates to:** spec §9 (CEMA AI agents); ADR 0016 (Chain-of-Title Agent — Tier 1 actuators); ADR 0015 (Collateral IDP — auto-enqueue precedent); ADR 0017 (Agent Triggers / collateral pipeline); M14 Slice 3 (deal review surface)
**Spec:** `docs/plans/2026-06-01-chain-of-title-tier-2.md`

---

## Context

By the end of M14 Slice 3 the Chain-of-Title agent **detected** breaks, **audited** the
routing decision (Tier 1, PR #108 — `routeReChase` / `openAttorneyReview` each wrote a
PII-safe `chain.break_routed` audit keyed by a deterministic `breakHash`), and the deal
review surface **rendered** the findings read-only (`/deals/[id]/documents`,
recomputed live from `documents.extractedData`). What was missing: nothing **durably
acted** on an `attorney_review` break. A processor could see "lost note → attorney review"
but there was no work item that survived a reload, no task to claim, no resolution state.

Tier 2 closes the **detect → render → act** loop for the human-review half of the chain
agent's output.

## Decisions

1. **Dedicated table, not a generalized queue.** A chain break is identified by `breakHash`
   (it spans zero-to-many documents and resolves differently from a document), so a new
   `chain_break_review_queue` keyed `(deal_id, break_hash)` is cleaner — and zero-risk to
   the gate-critical `document_review_queue` (hard rule #2) — than overloading the working
   document queue with a discriminator + nullable `document_id`. Migration `0031` (the
   first new migration since 0030); org-isolation RLS policy hand-written to match the
   established `current_setting('app.current_organization_id')` convention (0028).

2. **`attorney_review` items only; `re_chase` stays a hand-off (no row).** The brainstorm
   chose hand-off-only for `re_chase`. Spec self-review then confirmed via the caller graph
   that `runCollateralPipeline` is the **only** live chain trigger and already performs the
   deal-grained, idempotent Outreach hand-off (`hasReChase → runOutreachFromDeal`). Outreach
   is deal-grained and self-idempotent (touches keyed `outreach:<dealId>:touch:<n>`), so
   "per-break re_chase" cannot mean N Outreach runs. Therefore `routeReChase` is **unchanged**
   from Tier 1 (audit-only); moving the trigger into the actuator would churn the pipeline
   contract for zero current benefit. The re-chase hand-off is already first-class (pipeline
   effect + Tier 1 per-break audit).

3. **Idempotent enqueue actuator (mirrors the IDP auto-enqueue, PR #107).**
   `openAttorneyReview` inserts a `pending` row with `onConflictDoNothing` on
   `(deal_id, break_hash)` and emits `chain.break_routed` **only on a real insert** — an
   improvement over Tier 1's unconditional emit (no audit spam on chain re-analysis). The
   row + audit are co-transactional (`withRls`).

4. **Sibling state machine in `@cema/attorney`.** `pending → claimed → resolved | dismissed`
   (`claimed → pending` releases). Distinct terminals (`resolved` = defect remedied;
   `dismissed` = false positive) give clean real-vs-false-positive metrics. A sibling to
   the document machine (`state.ts`) rather than a generalization — the gate-critical
   document path is untouched.

5. **`breakKind` threaded onto `RouteDecision`.** The queue's `break_kind` column + its
   defense-in-depth CHECK (`IN ('lost_note','ambiguous_assignment','unrecorded_instrument')`,
   mirroring `documents_attorney_gate_required`) need the underlying `BreakKind`, which a
   `RouteDecision` did not carry. Added a readonly `breakKind` (null for `advisory_pass`),
   populated in `route()`. **Deliberately excluded from the `breakHash` material** — `reason`
   already encodes the kind, so the hash stays byte-stable across durable replays.

6. **Never auto-bless, in reverse (orphans).** The agent never returns `clean` unless breaks
   are truly zero; symmetrically, Tier 2 never auto-resolves a queue row because its break
   vanished from the live recompute (the break may have disappeared because a document was
   removed/reclassified, not fixed). The pure `mergeChainReview` core surfaces such open
   rows as **orphans** ("No longer detected") for manual dismissal. A human stays in the
   loop in both directions.

7. **PII fence on `resolution_note`.** The attorney's free-text note MAY carry party names
   (hard rule #3). It is stored (RLS-protected) but never logged, audited, or spanned. The
   guarantee is structural: the pure `chainBreakAuditMetadata` helper's parameter type
   accepts **only** `breakHash` + `breakKind`, so a note cannot reach an audit event through
   the transition action; a CHECK confines the note to terminal rows.

8. **Thin action over pure cores.** `transitionChainBreakReview` (claim/release/resolve/
   dismiss) mirrors `claim-review`: `canTransitionChainBreak` guards validity, the pure
   injected-clock `chainBreakReviewTransitionFields` computes the per-state column updates
   (decidedAt/note only on terminal — matching the CHECKs), `chainBreakAuditMetadata` emits
   PII-safe audit. Deal-scoped UI (`DealChainBreakReviewActions`) extends the Slice 3 surface.

## Consequences

**Positive:** the chain agent's `attorney_review` findings are now durable, claimable work
items — the detect→render→act loop is closed for the half of chain output that needs a
lawyer. Verified against the Neon dev branch in isolation (migration 0031 applies; the
`document_id` FK holds; enqueue is idempotent; RLS isolates by org). The risky logic
(state transitions, per-state fields, audit-without-note) is pure and unit-tested; the DB
CHECKs are a second backstop. No change to the gate-critical document path.

**Negative / tradeoffs:** there is now a second review queue + a second (small) read path.
Claimer-only resolution is enforced at the **action** boundary (`isChainBreakActorAuthorized`
— only the claiming reviewer may resolve/dismiss/release, mirroring approve/reject-document);
the **UI** still shows the buttons to non-claimers, who get a rejection error rather than a
hidden control (a v1 nicety, carry-over #2). A break's `document_id` FK means an
`attorney_review` break with a `documentId` that is not a real `documents` row would throw
on enqueue (cannot happen in production — the id always comes from an IDP-persisted
document — but it is a hard coupling). Durable-workflow activation is still Connor-gated.

## Carry-overs (deferred)

1. **Cross-deal attorney inbox** — a console listing all open chain-break items across
   deals (mirror the document `listReviewQueue`); the deal-scoped surface links into it.
2. **Claimer-only resolution — UI half.** The **action** already enforces it
   (`isChainBreakActorAuthorized`); the remaining nicety is hiding the buttons from
   non-claimers, which needs the loader to return `reviewerIsCurrentUser` (mirror
   `getDealDocumentsReview`). Today a non-claimer sees the buttons and gets a rejection error.
3. **`re_chase` audit once-per-break** — the re_chase `chain.break_routed` audit fires per
   run (no row to guard on); the effect is already idempotent. Tighten if audit volume matters.
4. **Auto-reconciliation policy** — orphans are surfaced but never auto-closed; a future
   pass could mark them "stale" with provenance once a re-run confirms the break is gone.
5. **Durable activation (Connor)** — WDK backend + `VERCEL_OIDC_TOKEN`; the enqueue is
   already idempotent, so the durable path is low-risk.
6. **`kg_edges`** (ADR 0015 #6) — persist chain edges to the knowledge graph (separate work).
7. **Dispatcher hardening — RESOLVED (2026-06-01, PR #111).** `onDealStatusChanged` now
   records a durable, PII-safe `deal.agent_dispatch_failed` audit (metadata: the `deal_status`
   enum + trigger token only) on a swallowed agent-dispatch failure, and prefixes the log with
   a stable `ERROR_IDS.AGENT_DISPATCH_FAILED` token (new `apps/web/lib/constants/error-ids.ts`).
   The audit is itself best-effort (the same outage that failed the agent can fail the insert)
   and never escapes; the dispatcher still never rethrows. Org + actor are threaded in from
   `transitionDealStatus` for the audit's `withRls` scope. **Still deferred:** full Sentry
   routing — no Sentry client is wired in `apps/web` yet (the error-id token is the seam it
   keys on); it folds into the separate observability task that also owns the
   `with-read-audit.ts` Sentry TODO.
8. **Type-design polish** (from review): promote `RouteDecision` to a discriminated union on
   `kind` (makes the `breakKind`/`kind` coupling compile-time, deletes the runtime null-guard
   in `deps.ts`); annotate app-layer `breakKind` as `BreakKind` instead of `string`
   (`merge-chain-review.ts`, `chain-break-audit.ts`); optional lifecycle-coherence CHECK
   (`pending` ⇒ null reviewer/claimedAt; `claimed` ⇒ non-null).
