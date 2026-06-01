# Chain-of-Title Tier 2 — Design Spec

> **Status:** Approved (Connor, 2026-06-01) — implementation pending.
> **Milestone:** Phase 1, M14 (deferred Chain-of-Title carry-over).
> **Predecessor:** Tier 1 route actuators (PR #108, ADR 0016 carry-over #1) + the Slice 3
> deal-scoped review surface (PRs #104/#105).
> **Authoritative design source:** the big spec
> (`docs/superpowers/specs/2026-05-12-cema-ai-processor-design.md`) remains the source of
> truth; this is a feature design under it. An ADR (0018) will be written as the close-out.

---

## 1. Goal & scope

The Chain-of-Title agent already **detects** breaks, **audits** the routing decision (Tier 1),
and **renders** findings read-only on `/deals/[id]/documents` (Slice 3). Nothing **durably acts**
on them. Tier 2 closes the **detect → render → act** loop:

- `attorney_review` breaks (`lost_note`, `ambiguous_assignment`, `unrecorded_instrument`)
  become durable, claimable work items an attorney resolves or dismisses.
- `re_chase` breaks (`missing_assignment`) are already handed off first-class (see §4.2 —
  a caller-graph finding during spec self-review); Tier 2 leaves that path unchanged.

### In scope

1. `chain_break_review_queue` table + enum + migration `0031` (first new migration since 0030) + RLS policy.
2. A chain-break review state machine in `@cema/attorney` (sibling to the document one).
3. Actuator wiring: idempotent `attorney_review` enqueue (`openAttorneyReview`). (`re_chase`/`routeReChase` unchanged — §4.2.)
4. Deal-scoped claim / release / resolve / dismiss UI on the existing Slice 3 surface.
5. PII-safe audit on every state transition.

### Out of scope (YAGNI / future slices)

- Cross-deal attorney inbox (a clean follow-up; the document queue's `listReviewQueue` is the model).
- Auto-reconciliation of stale rows (never auto-resolve — see §5).
- Durable-workflow activation (still Connor-gated: WDK backend + `VERCEL_OIDC_TOKEN`).
- Persisting chain edges to `kg_edges` (ADR 0015 carry-over #6 — separate work).

---

## 2. Data model — migration `0031`

New schema file `packages/db/src/schema/chain-break-review-queue.ts`.

New pgEnum `chain_break_review_state`: `pending | claimed | resolved | dismissed`.

Table `chain_break_review_queue`:

| column            | type                                                 | notes                                          |
| ----------------- | ---------------------------------------------------- | ---------------------------------------------- |
| `id`              | uuid pk defaultRandom                                |                                                |
| `organization_id` | uuid notNull → organizations (onDelete restrict)     | RLS tenancy; mirrors `document_review_queue`   |
| `deal_id`         | uuid notNull → deals (onDelete restrict)             | deal scope                                     |
| `break_hash`      | text notNull                                         | the deterministic 8-hex id (`breakHash`)       |
| `break_kind`      | text notNull                                         | one of the attorney-routed `BreakKind`s        |
| `document_id`     | uuid **nullable** → documents (onDelete restrict)    | a `ChainBreak.documentId` may be null          |
| `reason`          | text notNull                                         | the **static PII-free** `RouteDecision.reason` |
| `state`           | `chain_break_review_state` notNull default `pending` |                                                |
| `submitted_by_id` | uuid notNull → users (onDelete restrict)             | the actor who ran the chain (= `actorUserId`)  |
| `submitted_at`    | timestamptz notNull defaultNow                       |                                                |
| `reviewer_id`     | uuid nullable → users (onDelete set null)            | claiming attorney                              |
| `claimed_at`      | timestamptz nullable                                 |                                                |
| `decided_at`      | timestamptz nullable                                 |                                                |
| `resolution_note` | text nullable                                        | attorney free-text — **fenced** (§6)           |
| `created_at`      | timestamptz notNull defaultNow                       |                                                |
| `updated_at`      | timestamptz notNull defaultNow `$onUpdate(now())`    |                                                |

Constraints / indexes:

- `uniqueIndex chain_break_review_queue_deal_break_uidx` on `(deal_id, break_hash)` — **one row per break**; the idempotent-enqueue key.
- `index chain_break_review_queue_org_state_idx` on `(organization_id, state)` — future inbox query.
- `index chain_break_review_queue_reviewer_idx` on `(reviewer_id)`.
- CHECK `decided_at_requires_terminal_state`: `(decided_at IS NULL) OR (state IN ('resolved','dismissed'))`.
- CHECK `resolution_note_requires_terminal_state`: `(resolution_note IS NULL) OR (state IN ('resolved','dismissed'))`.
- CHECK `break_kind_is_attorney_routed`: `break_kind IN ('lost_note','ambiguous_assignment','unrecorded_instrument')`
  — defense-in-depth (mirrors the IDP's `documents_attorney_gate_required` CHECK). `missing_assignment`
  routes to `re_chase`, never here; this catches a routing regression at the DB boundary.
- **RLS policy** org-scoped, byte-for-byte mirroring `document_review_queue`'s policy (the `withRls` session-var pattern).

Migration must be tested **up and down** on a Neon branch (CLAUDE.md §11).

---

## 3. State machine — `packages/attorney/src/chain-break-state.ts`

A **sibling** to `state.ts` (the gate-critical document machine is left untouched — no risky
generalization). Same shape, chain-correct terminal names:

```
pending  → claimed
claimed  → pending | resolved | dismissed
resolved → ∅        (terminal)
dismissed → ∅       (terminal)
```

- `resolved` = the defect was remedied (lost-note affidavit, corrective/re-recorded assignment, etc.).
- `dismissed` = not a real defect (a false positive / the attorney has out-of-band assurance).

Distinct terminals give clean "real vs. false-positive" metrics. Exports (pure, unit-tested):
`ChainBreakReviewState`, `canTransitionChainBreak(from, to)`, `validChainBreakTransitions(from)`,
`isTerminalChainBreak(state)`.

---

## 4. Actuator wiring — `apps/web/lib/agents/chain-of-title/deps.ts`

The pure orchestrator (`runChainOfTitle`) is unchanged: it still dispatches each break to
`deps.routeReChase` / `deps.openAttorneyReview` per its existing loop. Only `openAttorneyReview` in
the **app deps** changes; `routeReChase` is left exactly as Tier 1 shipped it.

### 4.1 `openAttorneyReview(decision)` — idempotent enqueue

Diverge from the shared Tier 1 body (Tier 1 kept the two seams distinct precisely so this could
happen). Inside `withRls(organizationId, tx)`:

1. `INSERT ... ON CONFLICT (deal_id, break_hash) DO NOTHING RETURNING id` into `chain_break_review_queue`
   (`submitted_by_id = actorUserId`, `state = 'pending'`, copying `break_kind`/`document_id`/`reason`).
2. **Only if a row was actually inserted**, emit `chain.break_routed` (co-transactional).

This mirrors the IDP auto-enqueue (PR #107) and is an improvement over Tier 1's unconditional
emit — no audit spam when a deal's chain is re-analyzed.

### 4.2 `routeReChase(decision)` — unchanged (caller-graph finding)

**No change in Tier 2.** During spec self-review the caller graph confirmed `runCollateralPipeline`
is the **only** live caller of `runChainOfTitleFromDeal` (the durable variant is dormant), and the
pipeline already performs the re-chase hand-off: `hasReChase(chain) → runOutreachFromDeal(dealId)`.
Outreach is **deal-grained** (it chases the whole collateral file, not one assignment) and
**self-idempotent** (touches keyed `outreach:<dealId>:touch:<n>`). So the re-chase hand-off is
already first-class:

- the _effect_ is the pipeline's deal-grained, idempotent Outreach trigger (M14 Slice 1), and
- the durable _per-break record_ is Tier 1's `chain.break_routed` audit keyed by `breakHash`.

Moving the trigger into the actuator would only matter if a non-pipeline chain run existed (none
does), and it would churn `CollateralPipelineResult` and couple the chain deps to the outreach
action for zero current benefit — so `routeReChase` stays as Tier 1 left it (the simple per-break
`chain.break_routed` audit). Tightening that audit to once-per-break (it currently fires per run; the
_effect_ is already idempotent, so no duplicate servicer contact results) is a possible carry-over.

---

## 5. Read path

- Existing `getDealChainFindings(dealId)` (live recompute, Slice 3 Decision 1) stays.
- New loader `apps/web/lib/queries/deal-chain-break-reviews.ts` →
  `getDealChainBreakReviews(dealId): ChainBreakReviewRow[]` — RLS-scoped read of the queue rows for the deal.
- New **pure** merge core `apps/web/lib/agents/chain-of-title/merge-chain-review.ts` (node-testable,
  no Server-Action / RLS mocking — mirrors `reviewActionMode` / `hasReChase` / `breakHash`):
  - input: live `attorney_review` `RouteDecision[]` (recomputed) + persisted rows.
  - joins by `breakHash` → `{ decision, breakHash, review: row | null }[]`.
  - plus **orphans**: open rows whose `break_hash` is absent from the live recompute.

**Never auto-bless (load-bearing safety property).** The agent never returns `clean` unless breaks
are truly zero; symmetrically, Tier 2 **never auto-resolves** a row because its break vanished from
the live recompute (the break may have disappeared because a document was removed/reclassified, not
fixed). Orphans render as "previously flagged — no longer detected" with a manual **dismiss**. The
human stays in the loop in both directions.

---

## 6. Server actions — `apps/web/lib/actions/transition-chain-break-review.ts`

One guarded action (the state machine is the single validity source — cleaner than three
near-identical files):

```
transitionChainBreakReview(queueId: string, toState: ChainBreakReviewState, note?: string)
```

Each call: resolve Clerk identity + org → `withRls` → read the row → `canTransitionChainBreak(from, to)`
guard (reject invalid) → write:

- on `claimed`: set `reviewer_id = currentUser`, `claimed_at = now()`.
- on `pending` (release): clear `reviewer_id`, `claimed_at`.
- on `resolved` / `dismissed`: set `decided_at = now()`, `resolution_note = note ?? null`.

→ emit PII-safe audit `chain_break.claimed | chain_break.resolved | chain_break.dismissed`,
metadata `{ queueId, breakHash, breakKind, fromState, toState }` — **never** the note →
`revalidatePath('/deals/[id]/documents')`.

**PII fence on `resolution_note`:** it is attorney free-text that MAY contain party names. It is
stored (RLS-protected, encrypted at rest) but **never** logged, **never** placed in audit metadata,
and **never** set as an OTel span attribute (hard rule #3).

---

## 7. UI — deal-scoped (extends Slice 3)

New client island `apps/web/app/(app)/deals/[id]/documents/DealChainBreakReviewActions.tsx`
(mirrors `DealDocumentReviewActions`):

- per `attorney_review` finding: a **state badge** (pending / claimed-by / resolved / dismissed) +
  the **valid actions** for its current state (claim → release/resolve/dismiss), each calling
  `transitionChainBreakReview`.
- **orphaned** open rows render in a small "no longer detected" group with a dismiss action.

`page.tsx` calls `getDealChainFindings` + `getDealChainBreakReviews`, runs `mergeChainReview`, and
renders the merged view. `re_chase` findings remain informational (no row, automated hand-off).

---

## 8. Tests (TDD throughout)

- `chain-break-state.test.ts` — every transition + terminals + invalid moves.
- `merge-chain-review.test.ts` — live∪rows join, orphan detection, empty cases.
- `transition-chain-break-review.test.ts` — invalid transition rejected; audit emitted; note never audited.
- Migration `0031` up + down on a Neon branch.
- Neon-gated RLS integration (skip-green in CI; isolation-flake caveat noted):
  - enqueue actuator: idempotent insert + co-transactional `chain.break_routed` only on real insert.
  - loader: tenant scoping.
- Update the existing `chain-actuators.test.ts` (Tier 1) to the new `openAttorneyReview` enqueue
  behavior; assert `routeReChase` is untouched.

---

## 9. Compliance

- **Hard rule #2** — reinforced: attorney-routed breaks now get a durable, claimable record; no
  attorney-eyes break falls through the cracks.
- **Hard rule #3** — `reason` is the static PII-free template; `ChainBreak.detail` is never
  persisted; `resolution_note` is fenced from logs/audit/spans.
- **§10.5** — every transition is an append-only audit event.
- Run `legal:compliance-check` during implementation (touches the attorney-review audit trail).

---

## 10. File manifest (net)

**New:** `packages/db/src/schema/chain-break-review-queue.ts`; migration `0031`;
`packages/attorney/src/chain-break-state.ts` (+ test);
`apps/web/lib/queries/deal-chain-break-reviews.ts` (+ integration test);
`apps/web/lib/agents/chain-of-title/merge-chain-review.ts` (+ test);
`apps/web/lib/actions/transition-chain-break-review.ts` (+ test);
`apps/web/app/(app)/deals/[id]/documents/DealChainBreakReviewActions.tsx`.

**Edited:** `apps/web/lib/agents/chain-of-title/deps.ts` (`openAttorneyReview` enqueue only —
`routeReChase` untouched); `packages/db/src/schema/index.ts` (export new table/enum);
`packages/attorney/src/index.ts` (export state machine);
`apps/web/app/(app)/deals/[id]/documents/page.tsx` (wire merge);
`apps/web/lib/agents/chain-of-title/chain-actuators.test.ts` (update for enqueue behavior).

**Not edited:** `apps/web/lib/agents/collateral-pipeline.ts` — the re-chase hand-off stays where it
is (§4.2).

**No new workspace package.**
