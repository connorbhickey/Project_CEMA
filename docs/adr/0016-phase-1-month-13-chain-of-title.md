# ADR 0016: Phase 1 Month 13 (Phase 2) — Chain-of-Title Agent

**Status:** Accepted (shipped 2026-05-31)
**Author:** M13 Phase 2 (Claude Opus 4.8 + Connor Hickey)
**Relates to:** spec §9.6 (Chain-of-Title Agent); ADR 0010 (Intake Agent blueprint); ADR 0011 (OTel); ADR 0013 (WDK durable wrap); ADR 0014 (Servicer Outreach Agent); ADR 0015 (Collateral IDP Agent — the source of the `InstrumentRecord` this agent reads); M13 design doc (Collateral IDP + Chain-of-Title)

---

## Context

M13 Phase 1 (ADR 0015) shipped the Collateral IDP Agent, which classifies each
document in a prior servicer's collateral file and persists a typed
`InstrumentRecord` onto `documents.extractedData`. Phase 2 — the **Chain-of-Title
Agent**, the **fourth** Layer 3 agent — is the structural validator that reads those
persisted instruments and walks the recorded chain (Note → Mortgage → Assignments →
Allonges), flagging breaks and routing each to the right remedy (re-chase the servicer
vs. attorney review / lost-note affidavit). It is the companion designed alongside IDP
in the same design doc.

Like IDP — and unlike Intake (M10) and Outreach (M12) — Chain-of-Title makes **no LLM
call**. It goes one step further: `analyzeChain` and `route` are pure, deterministic,
and have **no clock** either (a chain of title is not time-based — only its inputs'
`recordedAt` timestamps matter, and those are data, not wall-clock reads). The agent's
entire compliance surface is testable offline with zero model flakiness and zero
secrets. It **type-imports** `InstrumentRecord` from the sibling
`@cema/agents-collateral-idp` package (type-only — no runtime coupling, no `@cema/db`
in the core), which realizes ADR 0015 carry-over #5 ("Chain-of-Title type-imports
`InstrumentRecord`") as a pragmatic type-only re-export rather than a new shared
package.

## Decision

### 1. `analyzeChain` + `route` are pure, deterministic — no LLM, no DB, no clock

Both functions are side-effect-free and reference no wall clock, so the same
`InstrumentRecord[]` always yields the same `ChainAnalysis` / `RouteDecision[]`
(durable-replay safe). `InstrumentRecord`, `DocumentKind`, and `RecordingRef` are
**type-only** imports from `@cema/agents-collateral-idp`; the package never imports
`@cema/db`. This is the cleanest member of the M10/M12/M13 agent family: there is no
env-gated model call to gate or trace, so the offline test suite is the whole story and
the live Braintrust run exists only for dashboard parity.

### 2. "Never auto-bless" safety property

`toStatus(breaks)` returns `clean` **IFF** `breaks.length === 0`; all-`missing_assignment`
→ `broken`; otherwise → `ambiguous`. `status` is driven **solely** by `breaks` — the
descriptive edge graph (Decision 4) never influences it. An empty instrument set, or
one with no anchor, can therefore never be `clean`: it surfaces as `ambiguous`/`broken`
for human review. This is the property the whole agent exists to hold — a CEMA must not
proceed on an unverified chain — and it is re-verified independently by the
`no_false_clean` eval scorer (Decision 9).

### 3. Break taxonomy + hybrid routing

Four break kinds: `missing_assignment` (a recoverable gap), `lost_note`,
`ambiguous_assignment`, `unrecorded_instrument`. A static `ROUTE_BY_BREAK` map routes
`missing_assignment → re_chase` (chase the servicer for the missing instrument) and the
other three → `attorney_review` (a lawyer's eyes). A clean chain (zero breaks) yields a
single `advisory_pass`. A load-time exhaustiveness guard throws if `BREAK_KINDS` ever
gains a member the route/reason maps don't cover, rather than silently routing
`undefined`.

### 4. Break detection passes (A–E) + a descriptive edge graph

`analyzeChain` runs five passes: **(A)** any `RECORDED_KINDS` instrument
(`mortgage`/`gap_mortgage`/`aom`) missing both a reel/page and a CRFN →
`unrecorded_instrument`; **(B)** if there is no anchor at all, every note is an orphan →
`lost_note`; **(C)** no anchor _and_ no note → a single `ambiguous_assignment` (the set
is unanalyzable); **(D)** assignment-graph ambiguity — missing party, fork (one
assignor, ≥2 outgoing), merge (one assignee, ≥2 incoming), or cycle (DFS
three-coloring) → `ambiguous_assignment`; **(E)** a sequential gap (`assignee[n] !==
assignor[n+1]` over hops sorted by `recordedAt`, nulls last) → `missing_assignment`,
checked **only** when pass D added no new ambiguity (an already-ambiguous graph has no
well-defined sequence). It also builds a descriptive `ChainEdge[]` graph (`assigns_to`
from each assignment, `consolidates` from each CEMA instrument) as analysis **output**;
edges do not influence `status`.

### 5. PII-safe by construction (hard rule #3)

A `ChainBreak.detail` MAY carry party names for in-memory, human-readable context, but
it is **never** persisted and **never** propagated into a `RouteDecision.reason` —
`route` maps each break to a static, PII-free `REASON_BY_BREAK` template. Likewise the
`ChainEdge.assignor`/`assignee` parties exist only for in-memory graph context. The
audit events and OTel spans (Decisions 6–7) carry only ids, status enums, and counts.

### 6. Orchestration-agnostic core + split audit

`runChainOfTitle(dealId, deps)` injects every effect via `ChainDeps` —
`loadInstruments`, `routeReChase`, `openAttorneyReview`, `emitAudit` (no clock, no LLM).
Split audit mirrors M10/M12/M13-Phase-1: `chain.analyzed` is emitted on **every** run
before any write; a single aggregate `chain.routed` (counts only) is emitted **once**,
inside the `chain.route` span, **only** when `breaks.length > 0` and after each break
has been dispatched to its dormant actuator seam (`routeReChase` / `openAttorneyReview`).
A clean chain emits `chain.analyzed` only — neither seam is called. The flat await chain
maps 1:1 onto a single WDK step (Decision 8).

### 7. OTel: `chain.run` parent + **3** PII-safe child spans (vs IDP's 4)

One parent span plus a child span per **awaited** boundary via `withChildSpan`
(`@cema/observability`): `chain.load_instruments`, `chain.emit_analyzed`, and (only when
there are breaks) `chain.route`. Only three children — not four — because `analyzeChain`
and `route` are **synchronous** pure calls, so there is no async "extract" boundary to
span (IDP had one). Attributes are PII-safe by allowlist — `chain.deal_id`,
`chain.status`, `chain.edge_count`, `chain.break_count`, `chain.re_chase_count`,
`chain.attorney_review_count` (ids + status enum + counts only) — enforced by
`orchestrator.trace.test.ts`.

### 8. Dormant single-pass WDK durable wrap — ONE step, no sleep loop

Chain-of-Title is **single-pass** (no cadence), so `chainWorkflow` (`'use workflow'`)
calls the whole `runChainOfTitle` core exactly once as a single `'use step'`
(`runChainOfTitleStep`) — **no** `sleep` loop, **no** `MAX_ITERATIONS` (it follows IDP's
single-pass shape, not M12's re-entrant cadence). The workflow takes three serializable
strings (`dealId`, `organizationId`, `actorUserId`) and rebuilds deps **inside** the
step (the WDK boundary cannot serialize functions/class instances). Reached via a
dormant `runChainOfTitleFromDealDurable` action (`start()` + `run.returnValue`). The
mocked-step test (`chain.workflow.test.ts`) is the authoritative behavioral guard; the
`@workflow/vitest` durable proof is deferred (same `@cema/*`-externalization cause as
ADR 0013 carry-over #5).

### 9. Braintrust eval — offline scorers are the real gate

Four pure scorers — `status_correct`, `break_kinds_correct`, `route_kinds_correct`, and
the safety scorer `no_false_clean` (returns 0 when `output.status === 'clean' &&
expected.status !== 'clean'`) — verified offline by `scorers.test.ts` (required `Unit
tests` job) over all 24 fixtures via the shared `runPipeline`, plus one explicit
fabricated false-clean case proving `no_false_clean` actually fails closed (25 tests
total). The live Braintrust run grades identical output and is skip-green unless
`BRAINTRUST_API_KEY` is set — and needs **only** that key (no model key; the agent makes
no model call).

---

## What shipped

`@cema/agents-chain-of-title` (the 23rd workspace package) +
`apps/web/lib/agents/chain-of-title/` app wiring. **0 new migrations** (reads the
`InstrumentRecord[]` the IDP enriched onto `documents.extractedData`; writes only
`audit_events`). Shipped as five squash PRs
[#91](https://github.com/connorbhickey/Project_CEMA/pull/91)–[#95](https://github.com/connorbhickey/Project_CEMA/pull/95)
over a 5-task TDD series (scaffold+types+drift-guard → pure core `analyzeChain`+`route`
→ orchestrator+trace+app wiring → dormant durable wrap → eval).

### Package — `packages/agents/chain-of-title/`

| File                             | Change                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/types.ts`                   | **New.** `ChainStatus`/`BreakKind`/`RouteKind`/`EdgeKind` enums; `ANCHOR`/`NOTE`/`ASSIGNMENT`/`RECORDED`/`CONSOLIDATION_KINDS`; `ChainBreak`/`ChainEdge`/`ChainAnalysis`/`RouteDecision`/`ChainAuditEvent`/`ChainDeps`/`ChainResult`; type-only re-export of `DocumentKind`/`InstrumentRecord`/`RecordingRef` from `@cema/agents-collateral-idp` |
| `src/types.test.ts`              | **New.** 6 tests — enum + kind-set invariants and the `DocumentKind` drift guard against the IDP export                                                                                                                                                                                                                                          |
| `src/chain.ts`                   | **New.** Pure `analyzeChain` (passes A–E + cycle DFS three-coloring + descriptive edge graph); `toStatus` (the "never auto-bless" floor)                                                                                                                                                                                                         |
| `src/chain.test.ts`              | **New.** 14 tests — every status/break, fork/merge/cycle, unrecorded, orphaned note, sequential gap                                                                                                                                                                                                                                              |
| `src/route.ts`                   | **New.** Pure `route` — static `ROUTE_BY_BREAK` + PII-free `REASON_BY_BREAK` + load-time exhaustiveness guard                                                                                                                                                                                                                                    |
| `src/route.test.ts`              | **New.** 6 tests                                                                                                                                                                                                                                                                                                                                 |
| `src/orchestrator.ts`            | **New.** `runChainOfTitle` core — orchestration-agnostic; `chain.run` parent + 3 child spans; split audit; dormant actuator dispatch                                                                                                                                                                                                             |
| `src/orchestrator.test.ts`       | **New.** 3 tests — clean advisory-pass (analyzed-only), break dispatch + `chain.routed`, split-audit ordering                                                                                                                                                                                                                                    |
| `src/orchestrator.trace.test.ts` | **New.** 1 test — PII-safe span-attribute allowlist guard                                                                                                                                                                                                                                                                                        |
| `src/index.ts`                   | **New.** Public surface (`analyzeChain`, `route`, `runChainOfTitle`, types)                                                                                                                                                                                                                                                                      |
| `evals/fixtures.ts`              | **New.** 24 fixtures (F1–F24) spanning every `ChainStatus`, `BreakKind`, and `RouteKind`                                                                                                                                                                                                                                                         |
| `evals/scorers.ts`               | **New.** 4 pure scorers + `CHAIN_SCORERS` + the shared `runPipeline` (analyze → route)                                                                                                                                                                                                                                                           |
| `evals/scorers.test.ts`          | **New.** 25 cases — 24 fixtures via `it.each` + 1 fabricated false-clean; the offline compliance gate                                                                                                                                                                                                                                            |
| `evals/chain-of-title.eval.ts`   | **New.** Braintrust `Eval()` wiring (skip-green unless `BRAINTRUST_API_KEY` set)                                                                                                                                                                                                                                                                 |
| `evals/run.mjs`                  | **New.** Eval runner (`pnpm eval`); requires **only** `BRAINTRUST_API_KEY` (no model key)                                                                                                                                                                                                                                                        |
| `package.json` / `tsconfig.json` | **New.** Package manifest (`test`, `eval` scripts; `braintrust` devDep; `@cema/agents-collateral-idp` for the type import)                                                                                                                                                                                                                       |

### App — `apps/web/lib/agents/chain-of-title/`

| File                                   | Change                                                                                                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `deps.ts`                              | **New.** Builds `ChainDeps` — reads `InstrumentRecord[]` from `documents.extractedData`; dormant actuator no-ops; all DB effects in `withRls` (deal-owned tenancy) |
| `run-chain-of-title-action.ts`         | **New.** Live `'use server'` shell over `runChainOfTitle` (non-durable); `chain.run_from_deal` span; `redactPii` on error                                          |
| `chain.steps.ts`                       | **New.** The one `'use step'` `runChainOfTitleStep` — rebuilds deps, runs the whole core                                                                           |
| `chain.workflow.ts`                    | **New.** `'use workflow'` `chainWorkflow` — single step, no loop                                                                                                   |
| `chain.workflow.test.ts`               | **New.** 2 tests — mocked-step orchestration guard (the behavioral authority)                                                                                      |
| `run-chain-of-title-durable-action.ts` | **New.** Dormant `'use server'` action: `start()` + `run.returnValue`                                                                                              |

**57 chain-of-title tests** — 55 package (6 files: types 6, route 6, chain 14,
orchestrator 3, orchestrator.trace 1, scorers 25) + 2 apps/web
(`chain.workflow.test.ts`). No new DB migrations.

## Consequences

**Positive:** the fourth Layer 3 agent — and the structural validator every CEMA
recording decision will lean on — is a deterministic, PII-safe routing agent on the
proven M10/M12/M13-Phase-1 blueprint. With no model call (and no clock), the offline
suite is a complete, flake-free gate and required CI is green with no backend and no
secrets. The "never auto-bless" floor is enforced twice: structurally in `toStatus`
(status driven solely by `breaks`) and independently by the `no_false_clean` scorer.
Type-only import of `InstrumentRecord` couples Chain-of-Title to the IDP's shape with
zero runtime dependency.

**Negative / tradeoffs:** the route actuators (`routeReChase` / `openAttorneyReview`)
are dormant no-ops — routing is durable solely via the `chain.routed` audit event
(counts in metadata) plus the in-memory `RouteDecision[]` returned to the caller — so
findings are audited but neither rendered nor acted on; nothing triggers the agent yet;
and **head-gap verification is structurally out of reach** because `InstrumentRecord`
carries no original-mortgagee field (the first assignment's assignor cannot be checked
against the anchor's lender — see carry-over #5). `InstrumentRecord` remains in the IDP
package and is consumed type-only here rather than promoted to a shared
`@cema/collateral` package (a deliberate shortcut). Operationally, the durable-wrap PR
([#94](https://github.com/connorbhickey/Project_CEMA/pull/94)) again tripped the CodeQL
"Unknown directive" false positives on `'use step'` / `'use workflow'` and sat
`BLOCKED` on `require_conversation_resolution` until both threads were resolved — the
recurring cost tracked as ADR 0015 carry-over #10 (a CodeQL directive allowlist), still
open.

## Carry-overs (deferred to M14+)

1. **Real route actuators.** `routeReChase` / `openAttorneyReview` are dormant no-ops;
   routing is durable solely via the `chain.routed` audit event (counts in metadata)
   plus the in-memory `RouteDecision[]` returned to the caller. Wiring the real
   re-chase trigger (hand off to the Servicer Outreach Agent) + a first-class
   attorney/processor review surface that renders re-chase vs. attorney-review items —
   each dispatched idempotently, keyed `chain:<dealId>:break:<hash>` — is deferred.
   Until then findings are audited but not rendered or acted on.
2. **Wire a trigger.** Nothing invokes `runChainOfTitleFromDeal` yet. The natural
   trigger is "Collateral IDP finished persisting instruments for a deal" — a post-IDP
   hook or a `deal_status` transition. M14 owns this.
3. **Durable activation** (Connor). Provision a WDK backend + `VERCEL_OIDC_TOKEN`,
   exclude `/.well-known/workflow/*` from the `proxy.ts` matcher, then flip
   `chainWorkflow` live behind a flag. Single-pass + bounded, so the in-request
   `await run.returnValue` is acceptable (unlike outreach's weeks-long sleep).
4. **Trace the durable step** + provision `BRAINTRUST_API_KEY` for the live
   chain-of-title eval (the offline `scorers.test.ts` is the real gate meanwhile).
5. **Head-gap verification.** `analyzeChain` checks internal consistency of the
   assignment sequence (`assignee[n] === assignor[n+1]`) but cannot verify the FIRST
   assignment's assignor against the original mortgagee, because `InstrumentRecord`
   carries no originator field. Closing this needs either an enriched IDP extraction
   (original-mortgagee name on the anchor) or a title-commitment Schedule A
   cross-check.
6. **Reference-target validation.** `InstrumentRecord.references` (e.g. a CEMA's list
   of consolidated mortgages, or an AOM citing the mortgage it assigns) is currently
   ignored by `analyzeChain`. A future pass could parse `references` and confirm each
   cited instrument is present in the deal — turning the head-gap and "is every
   consolidated mortgage accounted for" checks from structural into reference-anchored.
7. **Allonge-specific semantics.** Allonges are treated as assignment-graph edges
   (assignor→assignee) alongside AOMs. A note-endorsement allonge has different chain
   semantics than a mortgage assignment; distinguishing them (and validating the
   allonge attaches to a note, not a mortgage) is deferred.
