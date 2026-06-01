# ADR 0015: Phase 1 Month 13 — Collateral IDP Agent

**Status:** Accepted (shipped 2026-05-31)
**Author:** M13 (Claude Opus 4.8 + Connor Hickey)
**Relates to:** spec §9.5 (Collateral IDP Agent); ADR 0010 (Intake Agent blueprint); ADR 0011 (OTel); ADR 0012 (AI Gateway); ADR 0013 (WDK durable wrap); ADR 0014 (Servicer Outreach Agent); M13 design doc (Collateral IDP + Chain-of-Title)

---

## Context

M10 shipped the Intake Agent (first Layer 3 agent) and M12 the Servicer Outreach
Agent (second), both on an orchestration-agnostic pure-core blueprint. M13 is the
**third** Layer 3 agent — the Collateral IDP Agent — which classifies and extracts
structured data from the documents in a prior servicer's collateral file (the Note,
recorded Mortgage, intervening Assignments, Allonges, prior CEMAs, affidavits, tax
forms). It is the data-ingestion stage that every downstream CEMA agent reads from,
and the companion to the Chain-of-Title agent designed in the same doc but **not**
implemented in M13 (Phase 2 — it type-imports IDP's real `InstrumentRecord`).

Unlike M10 and M12, **IDP makes no LLM call**: classification and extraction are pure,
deterministic functions over an already-OCR'd `RawExtraction`. The expensive,
non-deterministic work (OCR + ML field extraction from a PDF blob) lives **behind a
seam** (`IdpAdapter`) so the agent's compliance-critical logic — what kind of
instrument is this, and does it require attorney review — is fully testable offline
with zero model flakiness and zero secrets.

## Decision

### 1. Classify + extract are pure, deterministic functions — no LLM

`classify(raw)` and `extract(documentId, raw, classification)` are side-effect-free.
The only non-deterministic surface (OCR / ML extraction of a blob → `RawExtraction`)
sits behind the `IdpAdapter` seam (`FixtureIdpAdapter` today; a real
Reducto/Textract/Vaultedge adapter is a carry-over). This inverts M10/M12: there is
**no** env-gated model call to gate or trace, so the offline test suite is the whole
story — the live Braintrust run exists only for parity with the other agents.

### 2. Classification via an ordered `KIND_BY_SIGNAL` signal table

`classify` lowercases `(fields.documentType ?? text ?? '')` and returns the kind of
the **first** signal whose text is a substring; default `other`. The table is ordered
**most-specific → most-general** and the ordering is **load-bearing**: `mt-15` before
`mortgage`, `allonge` before `note`, `consolidated note` / `gap note` before bare
`note`. A `types.test.ts` invariant + the final review confirm every **gated** signal
sits above the generic catch-alls, so no gated instrument can fall through to a
non-gated kind.

### 3. Attorney-review gate (hard rule #2), triple-enforced

`GATE_REQUIRED_KINDS` is the 14-kind set (`cema_3172`, `exhibit_a|b|c|d`, `gap_note`,
`gap_mortgage`, `consolidated_note`, `aom`, `allonge`, `aff_255`, `aff_275`, `mt_15`,
`county_cover_sheet`); `requiresAttorneyReview(kind)` is `GATE_SET.has(kind)`. The set
is enforced three independent ways: (a) a drift-guard test (`types.test.ts`) asserts it
matches the DB CHECK `documents_attorney_gate_required` byte-for-byte; (b) the
`attorney-gate-correct` Braintrust scorer re-verifies it per fixture; (c) the signal
ordering (Decision 2) prevents gated→non-gated misclassification. A gated instrument is
never persisted without `attorneyReviewRequired = true`.

### 4. Approach A persistence — enrich `documents.extractedData` in place (0 migrations)

IDP writes typed `InstrumentRecord[]` into the existing `documents.extractedData` jsonb
column, enriching each row 1:1 by `documents.id`. **0 new migrations** (reuses
`documents` + `audit_events`). `documents` has no `organizationId` column — it is
deal-owned (via `deal_id`) and tenant-isolated through the deal by RLS, so **every** DB
effect runs inside `withRls(organizationId, …)`.

### 5. Unreadability routing — `UNREADABLE_CONFIDENCE_THRESHOLD = 0.5`

A `RawExtraction` that is missing or whose `confidence < 0.5` is routed to an
`unreadable` bucket and **never persisted** — it cannot be silently classified as
`other` and written. This is the single unreadability signal; the orchestrator
short-circuits before any write when the input is unreadable.

### 6. Orchestration-agnostic core + split audit

`runCollateralIdp(dealId, deps)` injects every effect (`loadContext`,
`persistDocuments`, `emitAudit`) via `IdpDeps`. Split audit mirrors M10/M12:
`idp.evaluated` is emitted on **every** run before any write; `persistDocuments` (and
its co-transactional audit) only runs when `classified.length > 0`. The flat await
chain maps 1:1 onto a single WDK step boundary (Decision 8).

### 7. OTel: `idp.run` parent + PII-safe child spans

One parent span + a child span per awaited boundary via `withChildSpan`
(`@cema/observability`). Attributes are PII-safe by allowlist — `idp.deal_id`,
`idp.document_count`, `idp.unreadable_count`, `idp.gate_required_count` (ids + counts
only; never OCR text, borrower names, or addresses) — enforced by
`orchestrator.trace.test.ts`.

### 8. Dormant single-pass WDK durable wrap — ONE step, no sleep loop

IDP is **single-pass** (no cadence), so `idpWorkflow` (`'use workflow'`) calls the
whole `runCollateralIdp` core exactly once as a single `'use step'`
(`runCollateralIdpStep`) — **no** `sleep` loop, **no** `MAX_ITERATIONS` (simpler than
M12's re-entrant cadence wrap). Durability protects against crash + step-level retry,
not the passage of time. The workflow takes three serializable strings
(`dealId`, `organizationId`, `actorUserId`) and rebuilds deps **inside** the step (the
WDK boundary cannot serialize functions/class instances). Reached via a dormant
`runCollateralIdpFromDealDurable` action (`start()` + `run.returnValue`). The
mocked-step test (`idp.workflow.test.ts`) is the authoritative behavioral guard; the
`@workflow/vitest` durable proof is deferred (same `@cema/*`-externalization cause as
ADR 0013 carry-over #5).

### 9. Braintrust eval — offline scorers are the real gate

Four pure compliance scorers — `classification-correct`, `attorney-gate-correct`,
`no-pii-leak` (flags any structured instrument string > 200 chars, i.e. leaked OCR
text), `extraction-completeness` — verified offline by `scorers.test.ts` (required
`Unit tests` job) over all 23 fixtures via the shared `runPipeline`. The live
Braintrust run grades identical output and is skip-green unless `BRAINTRUST_API_KEY`
is set — and needs **only** that key (no model key; IDP makes no model call).

---

## What shipped

`@cema/agents-collateral-idp` (the 22nd workspace package) +
`apps/web/lib/agents/collateral-idp/` app wiring. **0 new migrations.** Shipped as a
single squash PR [#88](https://github.com/connorbhickey/Project_CEMA/pull/88) over a
6-task TDD series (scaffold+types → adapter seam → classify+extract → core+trace+app
wiring → durable wrap → eval).

### Package — `packages/agents/collateral-idp/`

| File                             | Change                                                                                                                                                                |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/types.ts`                   | **New.** `RawExtraction`, `InstrumentRecord`, `InstrumentKind`, `IdpDeps`; `GATE_REQUIRED_KINDS` (14) + `requiresAttorneyReview`                                      |
| `src/types.test.ts`              | **New.** 2 tests — attorney-gate drift guard vs the DB CHECK                                                                                                          |
| `src/adapter.ts`                 | **New.** `IdpAdapter` seam + `FixtureIdpAdapter` (dormant OCR/ML vendor seam)                                                                                         |
| `src/adapter.test.ts`            | **New.** 2 tests                                                                                                                                                      |
| `src/classify.ts`                | **New.** Pure `classify` over the ordered `KIND_BY_SIGNAL` table; `UNREADABLE_CONFIDENCE_THRESHOLD = 0.5`                                                             |
| `src/classify.test.ts`           | **New.** 10 tests — every kind, gated ordering, unreadable routing, `other` default                                                                                   |
| `src/extract.ts`                 | **New.** Pure `extract` — typed field coercion into an `InstrumentRecord` (never echoes raw OCR text)                                                                 |
| `src/extract.test.ts`            | **New.** 5 tests                                                                                                                                                      |
| `src/orchestrator.ts`            | **New.** `runCollateralIdp` core — orchestration-agnostic; `idp.run` parent + child spans; unreadable guard; split audit                                              |
| `src/orchestrator.test.ts`       | **New.** 5 tests — classify+persist, unreadable short-circuit, empty-classification, split-audit ordering                                                             |
| `src/orchestrator.trace.test.ts` | **New.** 1 test — PII-safe span-attribute allowlist guard                                                                                                             |
| `src/index.ts`                   | **New.** Public surface                                                                                                                                               |
| `evals/fixtures.ts`              | **New.** 23 fixtures (all 14 gate kinds + note, mortgage, payoff_letter, title_commitment, title_policy, endorsement_111, authorization, reel/page mortgage, `other`) |
| `evals/scorers.ts`               | **New.** 4 pure compliance scorers + `IDP_SCORERS` + shared `runPipeline`                                                                                             |
| `evals/scorers.test.ts`          | **New.** 23 cases (`it.each`) — the offline compliance gate                                                                                                           |
| `evals/collateral-idp.eval.ts`   | **New.** Braintrust `Eval()` wiring (skip-green unless `BRAINTRUST_API_KEY` set)                                                                                      |
| `evals/run.mjs`                  | **New.** Eval runner (`pnpm eval`); requires only `BRAINTRUST_API_KEY`                                                                                                |
| `package.json` / `tsconfig.json` | **New.** Package manifest (`test`, `eval` scripts; `braintrust` devDep)                                                                                               |

### App — `apps/web/lib/agents/collateral-idp/`

| File                                   | Change                                                                                    |
| -------------------------------------- | ----------------------------------------------------------------------------------------- |
| `deps.ts`                              | **New.** Builds `IdpDeps` (DB / Clerk / `FixtureIdpAdapter`); all DB effects in `withRls` |
| `run-collateral-idp-action.ts`         | **New.** Live `'use server'` shell over `runCollateralIdp` (non-durable)                  |
| `idp.steps.ts`                         | **New.** The one `'use step'` `runCollateralIdpStep` — rebuilds deps, runs the whole core |
| `idp.workflow.ts`                      | **New.** `'use workflow'` `idpWorkflow` — single step, no loop                            |
| `idp.workflow.test.ts`                 | **New.** 2 tests — mocked-step orchestration guard (the behavioral authority)             |
| `run-collateral-idp-durable-action.ts` | **New.** Dormant `'use server'` action: `start()` + `run.returnValue`                     |

**50 collateral-idp tests** — 48 package (7 files: types 2, adapter 2, classify 10,
extract 5, orchestrator 5, orchestrator.trace 1, scorers 23) + 2 apps/web
(`idp.workflow.test.ts`). No new DB migrations.

## Consequences

**Positive:** the data-ingestion stage every downstream CEMA agent depends on is now a
deterministic, attorney-safe agent on the proven M10/M12 blueprint. Because the
compliance logic makes no model call, the offline suite is a complete, flake-free gate
and required CI is green with no backend and no secrets. The attorney-review gate is
enforced three independent ways.

**Negative / tradeoffs:** the `IdpAdapter` is dormant — a real OCR/IDP vendor and
multi-instrument-per-blob handling are not wired, so nothing produces real
`RawExtraction` yet; the durable wrap and both Server Actions are dormant (no trigger
invokes the agent). (`InstrumentRecord` lived in the IDP package at M13; M14 Slice 4
promoted it to the shared `@cema/collateral` package — carry-over #5, resolved.)

## Carry-overs

1. **Real OCR/IDP vendor adapter** — implement `IdpAdapter` over Reducto / AWS Textract
   Lending / Vaultedge; add `packages/integrations/<vendor>/` (hard rule #12) + a spec
   §16 row; handle **multiple instruments per blob** (today one `RawExtraction` → one
   record). Dormant (`FixtureIdpAdapter`) until then.
2. **Wire a trigger** — a document-upload or `deal_status`-change hook (or cron) that
   calls `runCollateralIdpFromDeal` (or the durable variant). Nothing invokes the agent
   today.
3. **Durable activation** (Connor) — WDK backend + `VERCEL_OIDC_TOKEN`, exclude
   `/.well-known/workflow/*` from the `proxy.ts` matcher, flip behind a flag; then add
   the `@workflow/vitest` durable proof (same `@cema/*`-externalization cause as ADR
   0013 carry-over #5). Single-pass makes the in-request `await run.returnValue` far
   less acute than M12's long-sleeping cadence, but it should still become
   fire-and-forget at activation.
4. **Deal-scoped attorney-review surface — RESOLVED (rendering half; 2026-06-01, M14
   Slice 3, PRs #104 + #105).** The IDP set the gate boolean but nothing rendered it, and
   the live action's `revalidatePath('/deals/[id]/documents')` targeted a
   not-yet-existent route (a harmless no-op until the page existed). The **rendering half
   is now resolved**: a deal-scoped review surface at `/deals/[id]/documents` (RSC page +
   two RLS loaders `getDealDocumentsReview` / `getDealChainFindings` + the
   `DealDocumentReviewActions` client island) renders every gate-required instrument and
   offers a UI-driven `submitForReview` on gate-required docs that still lack a queue row
   (Decision 2 — the IDP sets `attorneyReviewRequired` but does not auto-enqueue). The
   IDP action's `revalidatePath('/deals/[id]/documents')` is therefore no longer a no-op.
   **Auto-enqueue fast-follow — RESOLVED (2026-06-01).** `persistDocuments` now
   idempotently inserts a `pending` `document_review_queue` row for every gate-required
   doc (`onConflictDoNothing` on the `(documentId, documentVersion)` unique index,
   `submittedById = actorUserId`) and emits a co-transactional
   `document.submitted_for_review` audit only on a real insert. **Enqueue-only:** unlike
   the manual island `submitForReview` (a processor's explicit lifecycle action, which
   flips `documents.status → attorney_review`), the IDP runs automatically across the
   whole collateral file, so it deliberately leaves `documents.status` alone — the queue
   row, not `documents.status`, is the signal the claim/approve machine (`canTransition`
   on `documentReviewQueue.state`) and the review surface (`reviewActionMode` on
   `queueId`) key off. The review queue now fills without a manual submit; the island
   submit remains for any gate-required doc lacking a queue row.
5. **Promote `InstrumentRecord` to a shared `@cema/collateral` package — RESOLVED
   (2026-05-31, M14 Slice 4, PRs #101 + #102).** The shared collateral vocabulary
   (`DOCUMENT_KINDS`/`DocumentKind`, `GATE_REQUIRED_KINDS`, `RecordingRef`,
   `InstrumentRecord`) + its DB drift-guard test now live in the new 24th workspace
   package `@cema/collateral`; IDP re-exports them (public API byte-identical) and
   Chain-of-Title type-imports them directly from `@cema/collateral` — no agent-to-agent
   coupling. `@cema/collateral` carries no runtime `@cema/db` dependency (drift guard
   uses it as a devDep only). `UNREADABLE_CONFIDENCE_THRESHOLD` stayed in IDP (OCR-tuning,
   not shared vocabulary).
6. **Persist chain edges to `kg_edges`** — when Chain-of-Title lands, attribute
   instrument relationships to the deal's knowledge graph.
7. **Provision `BRAINTRUST_API_KEY`** — the live eval skips-green; the offline
   `scorers.test.ts` is the real gate meanwhile (no model key needed — IDP has no model
   call).
8. **Error-path + span parity** — `run-collateral-idp-action.ts`'s `redactPii` path
   lacks M12's `?? String(err)` fallback (align); the dormant durable action sets
   `idp.document_count` but not `idp.unreadable_count` (add for parity); exception
   events could carry PII once a real OCR adapter throws (redact at the adapter
   boundary).
9. **`KIND_BY_SIGNAL` precision** — short signals (`rpt`, `cema`) can over-match,
   though never crossing gated→non-gated; tune once real OCR `documentType` values are
   known (Connor-tunable). The `no-pii-leak` scorer's shallow `Object.values` scan would
   miss strings nested inside `recordingRef` (cannot happen with current shapes; deepen
   if nested string fields are added).
10. **CodeQL directive allowlist** — add a CodeQL config so the WDK `'use workflow'` /
    `'use step'` directives stop raising "Unknown directive" review threads on every
    durable-wrap PR (PR #88 was blocked by `require_conversation_resolution` on exactly
    these two false positives until they were resolved with an explanation).
