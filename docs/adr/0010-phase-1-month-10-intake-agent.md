# ADR 0010: Phase 1 Month 10 — Intake Agent (first Layer 3 agent)

**Status:** Accepted (shipped 2026-05-29)
**Author:** Phase 1 Month 10 implementation (Claude Opus 4.8 + Connor Hickey)
**Supersedes:** None
**Superseded by:** None

---

## Context

Phase 0 (Layers 1–2 — the Deal entity, attorney gate, and unified processor workspace) closed at Month 9. **Month 10 (M10) opens Phase 1 (Layer 3 — CEMA AI agents) with the first agent: the Intake Agent.** It is the cheapest agent to ship end-to-end (its core decisions are deterministic, so it needs no design partner to validate model quality) and it produces the entity every other agent and screen hangs off — a Deal.

The Intake Agent (spec §9.3) takes one Loan Origination System (LOS) application and runs a flat pipeline: **normalize → deterministic eligibility → recording-tax savings estimate → minimal Deal + audit → optional borrower-facing savings narrative.** Eligibility and savings are legal/arithmetic facts (NY-only, first-lien, eligible property type, eligible loan program, positive UPB; tax saved = assigned UPB × county rate − fees), so they are computed deterministically — never by an LLM. The only model-using surface is the closing narrative, which is additive: when no model key is configured the agent runs to completion and simply emits no narrative.

**Roadmap reconcile (carried from the M10 kickoff, PR #65):** spec §11 scheduled the agent layer for Months 6–9, but M6–M9 instead deepened the Layer 2 foundation (knowledge graph, search, memory, telephony entity resolution, cache hardening). The agent layer therefore starts ~4 months behind the spec roadmap. Spec §11 still shows the original schedule; a re-baseline diff awaits Connor's approval per hard-rule #11 (the spec is the source of truth — code does not silently rewrite it).

M10 shipped as **seven small, signed, auto-merging PRs** (#65 kickoff; #67–#72 implementation), each ≤ ~400 LOC and individually green on the four required checks. This ADR is the close-out (PR6).

---

## What shipped

### Kickoff (PR #65 — docs)

| File                                                                 | Purpose                                                                                                           |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `docs/superpowers/plans/2026-05-28-phase-1-month-10-intake-agent.md` | The M10 plan: scope, the three pre-recorded decisions (WDK defer, LosAdapter, env-gated LLM), and Connor's inputs |
| `CLAUDE.md` §2 + `.env.example` + provisioning runbook               | Phase 0→1 transition note; added `CRON_SECRET`; runbook extended with Upstash + Cron                              |

### Agent core package — `@cema/agents-intake` (PRs #67, #68, #69, #71, #72)

The nineteenth workspace package. It carries **no app, DB, Clerk, or AI-Gateway import on its deterministic path** — every side effect arrives through injected collaborators (`IntakeDeps`). It depends only on the AI SDK (`ai`, `@ai-sdk/anthropic`) for the one additive narrative module, and on `braintrust` (dev) for the eval.

| File                               | Purpose                                                                                                                                                                                                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/types.ts`                     | Domain vocabulary: `NormalizedApplication`, `EligibilityResult`/`IneligibilityReason`, `SavingsEstimate`, `RecordingTaxRateTable`, `LosAdapter`, `IntakeDeps`, `IntakeResult`, `IntakeAuditEvent`; `ELIGIBLE_PROPERTY_TYPES`, `EXCLUDED_LOAN_PROGRAMS`, `CemaType` |
| `src/eligibility.ts`               | `checkEligibility()` — pure, accumulates **every** failed rule (no short-circuit) so the audit log + eval can fully explain a decision                                                                                                                             |
| `src/savings.ts`                   | `estimateSavings(app, rates)` — assigned UPB × county rate − fees; `PLACEHOLDER_RATES` (isPlaceholder=true, defaultRate 0.02, fees $1,000); case-insensitive county lookup with default fallback                                                                   |
| `src/prompts/savings-narrative.ts` | `buildSavingsNarrativePrompt()` — pure string builder; injects raw figures; adds the §255 _preliminary_ caveat only when `isPlaceholderRate`; mandates the no-legal-advice closing disclosure                                                                      |
| `src/narrative.ts`                 | `isLlmConfigured()` + `draftSavingsNarrative()` — the **only** LLM surface; `null` = "off" (unconfigured), a configured-but-failed call **throws** ("off" ≠ "broken")                                                                                              |
| `src/orchestrator.ts`              | `runIntake(externalId, deps)` — the flat awaited chain; orchestration-agnostic; emits `intake.evaluated` before deal creation                                                                                                                                      |
| `src/fixture-los-adapter.ts`       | `FixtureLosAdapter` — in-memory `LosAdapter` (spec §13.6) so the agent is testable with zero vendor credentials; returns a rejected `Promise` (not a sync throw) on miss                                                                                           |
| `src/fixtures.ts`                  | 15 named source fixtures (eligible × 5 property types, ineligible × 6, edge × 3) backing the adapter + unit tests                                                                                                                                                  |
| `src/index.ts`                     | Public surface (types + `checkEligibility`, `estimateSavings`, `draftSavingsNarrative`, `runIntake`, `FixtureLosAdapter`, fixtures)                                                                                                                                |
| `evals/scorers.ts`                 | Five pure compliance scorers (see Decision 8) + `NARRATIVE_SCORERS`                                                                                                                                                                                                |
| `evals/fixtures.ts`                | 24 eval fixtures, each `savings` derived by the **real** `estimateSavings` (Decision 6)                                                                                                                                                                            |
| `evals/savings-narrative.eval.ts`  | Braintrust `Eval` wiring fixtures → live `draftSavingsNarrative` → scorers                                                                                                                                                                                         |
| `evals/scorers.test.ts`            | 17 offline Vitest cases — the real CI gate for the compliance logic (no model, no key)                                                                                                                                                                             |
| `evals/run.mjs`                    | Skip-green wrapper: exits 0 with a reason unless **both** `BRAINTRUST_API_KEY` and `ANTHROPIC_API_KEY` are present                                                                                                                                                 |
| `package.json` / `tsconfig.json`   | `eval` script + `braintrust` devDep; `rootDir: "."` + `include: evals/**/*.ts` so the harness is typechecked                                                                                                                                                       |

### App-layer wiring (PR #70)

The seam where the orchestration-agnostic core acquires concrete DB/Clerk behaviour, in `apps/web`.

| File                                                  | Purpose                                                                                                                                                                                                                 |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/lib/agents/intake/deps.ts`                  | `buildIntakeDeps()` — wires `emitAudit` + `createDeal` to Neon via `withRls`; **request-agnostic** (takes resolved internal UUIDs, never Clerk handles, never `revalidatePath`) so it is unit-testable with plain UUIDs |
| `apps/web/lib/agents/intake/run-intake-action.ts`     | `runIntakeFromLos()` — the `'use server'` shell that owns request context (Clerk identity resolution, adapter selection, `revalidatePath('/deals')`), then delegates to `runIntake`                                     |
| `apps/web/tests/integration/intake-agent-rls.test.ts` | RLS integration test against a real Neon branch: an eligible app creates a Deal + existing-loan + two audit rows; an ineligible app records `intake.evaluated` and creates no Deal                                      |
| `apps/web/package.json` / `playwright.config.ts`      | Adds the `@cema/agents-intake` dependency; Playwright `webServer` gate touch-up                                                                                                                                         |

### Test count

The intake package ships **76 tests across 6 files**: `eligibility` ×21, `savings` ×13, `narrative` ×10, `orchestrator` ×9, `fixture-los-adapter` ×6, `evals/scorers` ×17. Plus one RLS integration test file in `apps/web` (Neon-gated). Net M10 source: **26 files, +2,347 lines.** Zero new DB migrations (the agent reuses the existing `deals` / `existing_loans` / `audit_events` schema).

---

## Architectural decisions

### 1. Deterministic eligibility + savings; the LLM only writes the narrative

**Decision:** `checkEligibility` and `estimateSavings` are pure functions with no model call. The LLM (`draftSavingsNarrative`) runs **after** the Deal is created and is never on the write path.

**Rationale:** Eligibility (NY-only, first-lien, §255 applicability) and the recording-tax math are legal/arithmetic facts. A hallucinated "eligible" or a wrong dollar figure on a borrower summary is a compliance event, not a UX blemish. Determinism makes the decision fully explainable (the eval grades it without a model) and reproducible in court.

**Trade-off accepted:** The narrative — the one place borrowers actually read prose — is the one place a model can still be wrong. The five eval scorers (Decision 8) exist precisely to bound that surface (e.g. it may not cite a dollar figure the estimate didn't provide).

### 2. Dependency-injected, orchestration-agnostic core (`IntakeDeps`) — WDK-ready

**Decision:** `runIntake(externalId, deps)` is a flat chain of awaited collaborators — `adapter.getApplication → checkEligibility → emitAudit → estimateSavings → createDeal`. The core imports nothing from the app, DB, Clerk, or a workflow engine; every effect arrives through `IntakeDeps`.

**Rationale:** Spec §9.2 + CLAUDE.md §8 mandate Vercel Workflow DevKit (WDK), but `@vercel/workflow` is **not installed** yet (Decision 1 in the plan). Rather than block the whole agent layer on WDK infra, each `await` is designed as an idempotent, individually-testable boundary that maps **1:1** to a future `step.run(...)`. The WDK wrap becomes a thin shell, not a rewrite.

**Trade-off accepted:** A later WDK-adoption pass is owed (tracked as WDK debt). Mitigated by the 1:1 step mapping.

### 3. Split audit ownership: `intake.evaluated` before, `deal.created` atomic

**Decision:** `runIntake` emits `intake.evaluated` for **every** run (eligible or not) **before** any Deal exists; `createDeal` owns the `deal.created` row and writes it inside the **same transaction** as the Deal + existing-loan inserts.

**Rationale:** The evaluation decision must be durable even for ineligible apps (which never get a Deal) and even if the subsequent insert fails — so it is emitted first, in its own `withRls` transaction. The `deal.created` row, by contrast, must be all-or-nothing with the Deal it describes, so it is co-transactional. This honours the append-only audit invariant (§10.5) at both ends.

**Trade-off accepted:** Two transactions per eligible run (one audit, one deal+audit) rather than one. The durability guarantee is worth the extra round-trip; at Phase 0/1 volume it is immaterial.

### 4. Env-gated LLM: `null` means "off", a thrown error means "broken"

**Decision:** `draftSavingsNarrative` returns `null` **only** when `ANTHROPIC_API_KEY` is absent. A configured call that fails is allowed to **throw**.

**Rationale:** The narrative is an optional enhancement, never a hard dependency — so an unconfigured environment (CI, most dev loops) degrades cleanly to "no narrative." But silently swallowing a _configured_ failure would hide a real outage behind the same `null` the caller treats as benign. Keeping the two distinct lets the app boundary record a genuine failure (Sentry) instead of dropping it. Mirrors the repo's one existing LLM consumer, `@cema/search`'s query classifier.

**Trade-off accepted:** Callers must wrap configured calls in their own try/catch if they want best-effort behaviour. The app Server Action does not yet — a configured-but-failing model call would surface to the processor. Acceptable: until keys are provisioned the path is dormant, and "loud failure" is the safer default for a borrower-facing artifact.

### 5. Direct `anthropic()` provider, **not** AI Gateway — a flagged, reversible deviation

**Decision:** `narrative.ts` calls `anthropic('claude-sonnet-4-6')` directly on `ANTHROPIC_API_KEY`. It does **not** route through Vercel AI Gateway.

**Rationale:** The plan (step 7) and spec §4 specify AI Gateway for model routing, cost tracking, and failover. But no code in the repo uses the Gateway yet — the only existing LLM consumer (`@cema/search`) also calls the provider directly. Adopting the Gateway is a **repo-wide** concern (env wiring, routing config, failover policy) that deserves its own slice, exactly like the WDK wrap (Decision 2). Forcing it into the first agent would couple "ship the Intake Agent" to "adopt a new platform primitive."

**Trade-off accepted / flag (hard-rule #11):** This is a deliberate divergence from the plan + spec §4, surfaced here rather than silently. It is **reversible**: swapping `anthropic(...)` for a Gateway-routed model is a one-line change in `narrative.ts`, behind the same `isLlmConfigured()` gate. **Owed: an AI-Gateway adoption slice** (route the narrative + the `@cema/search` classifier through the Gateway together).

### 6. Eval fixtures are derived from the production estimator, never hand-written

**Decision:** `evals/fixtures.ts` constructs each `NormalizedApplication` and then computes its `savings` by calling the **real** `estimateSavings`. The only knob is which rate table feeds it (`PLACEHOLDER_RATES` vs. an illustrative confirmed table).

**Rationale:** A hand-written `savings` figure can silently drift from the estimator it is supposed to exercise; a derived one cannot. The eval then grades the _narrative against the numbers the system actually produced_, which is the property we care about.

**Trade-off accepted:** The fixtures import from `../src/savings` (not `../src/index`), keeping the eval-fixtures module — and anything that imports it — free of the AI SDK that `../src/narrative` pulls in.

### 7. Float-clean fixture rates (≤ 3 decimal places)

**Decision:** Every fixture rate table is held to ≤ 3 decimal places (0.02, 0.015, 0.025), and UPBs are multiples of 1,000.

**Rationale:** `buildSavingsNarrativePrompt` injects **raw** JS numbers into the prompt. Empirically, a rate with > 3 dp (e.g. 0.02175) × a UPB produces a float tail like `6785.999999999999`, which the live model would faithfully echo into a borrower's summary. Rate × multiple-of-1,000 at ≤ 3 dp is an exact whole dollar.

**Trade-off accepted:** The illustrative `CONFIRMED_RATES` table in the fixtures is explicitly _not_ the authoritative NY table (still Connor's to confirm — see carry-overs); magnitudes are illustrative only. When the real table lands, if any rate exceeds 3 dp the prompt builder will need to round before injecting.

### 8. Skip-green two-key eval gate; offline scorer tests are the real CI gate

**Decision:** The compliance logic lives in five **pure** scorers unit-tested by `evals/scorers.test.ts` (17 cases, no model, no key), which runs in the **required `Unit tests`** job. The live Braintrust eval (which needs both `BRAINTRUST_API_KEY` and `ANTHROPIC_API_KEY`) runs only via `run.mjs`, which exits 0 with a reason when either key is absent — keeping the **non-blocking `llm-eval`** job green in CI.

**Rationale:** This mirrors the repo's `isXConfigured()` gating (Typesense, Mem0, Upstash). CI must stay green without provisioned paid keys, but the _logic that protects the borrower_ (anti-hallucination, preliminary-caveat enforcement, legal disclosure) must still be verified on every PR — so it is extracted into pure functions and tested offline. The scorers are:

- **`mentionsNetSavings`** — the headline figure appears (comma- or bare-formatted, rounded).
- **`groundedInProvidedFigures`** — the anti-hallucination guardrail: every cited money figure (≥ $1,000) must be one of `{assignedUpb, taxSaved, fees, netSavings}` (rounded). Small bare numbers — §255, a 2% rate, lien position 1 — are ignored.
- **`hasLegalDisclosure`** — the no-legal-advice disclosure is present (case-insensitive).
- **`placeholderCaveatConsistency`** — a **placeholder** rate **must** be flagged preliminary; a confirmed rate may be stated plainly.
- **`withinSentenceBudget`** — ≤ 5 sentences.

**Trade-off accepted:** The live eval never runs in CI until keys are provisioned, so prompt-quality regressions (as opposed to scorer-logic regressions) are caught only when someone runs `pnpm eval` locally with keys. Acceptable for a dormant, additive surface.

### 9. `tsconfig rootDir: "."` to typecheck `evals/` alongside `src/`

**Decision:** The package `tsconfig` sets `rootDir: "."` and `include: ["src/**/*", "evals/**/*.ts"]`.

**Rationale:** `evals/` sits outside `src/`; with `rootDir: "src"` TypeScript raises TS6059 ("not under rootDir"). Widening `rootDir` to `.` is free here because the package is `noEmit` and its entry points (`main`/`types`) point at `src/index.ts` — nothing is built from the eval files.

---

## What changed against the plan

| Plan instruction                                       | Reality                                                                 | Reason                                                                                                                                  |
| ------------------------------------------------------ | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Step 7: `draftSavingsNarrative()` **via AI Gateway**   | Direct `anthropic('claude-sonnet-4-6')` provider on `ANTHROPIC_API_KEY` | Decision 5 — no Gateway usage exists in the repo yet; adopting it is a repo-wide slice, deferred + flagged (reversible one-line change) |
| CLAUDE.md §8: "every agent emits OpenTelemetry traces" | **No OTel spans wired** on `runIntake` or the Server Action             | Carry-over. The injected-deps seam is the natural span boundary; wiring deferred to the observability pass (see carry-overs)            |
| Wrap the orchestrator in WDK `workflow()`              | Pure async orchestration-agnostic core                                  | Decision 2 (= plan Decision 1) — `@vercel/workflow` not installed; await boundaries map 1:1 to future steps                             |
| Real LOS adapter                                       | `FixtureLosAdapter` only                                                | Decision 2 in plan — Encompass adapter is a later slice; the fixture adapter unblocks the whole agent with zero credentials             |
| Step 8: Slack/Teams LO notification                    | Not wired                                                               | Clients exist from M4; notification wiring deferred to a later slice                                                                    |

---

## Carry-overs to M11 (or later Phase 1 slices)

1. **OTel traces on the agent.** Add spans at the `runIntake` await boundaries + the Server Action; CLAUDE.md §8 requires it for every agent. The DI seam already isolates the natural span points.
2. **AI-Gateway adoption slice.** Route `draftSavingsNarrative` **and** the existing `@cema/search` query classifier through Vercel AI Gateway (spec §4) — model routing, cost tracking, failover. One-line per call site behind the existing gate.
3. **WDK wrap.** Once `@vercel/workflow` is installed repo-wide, wrap `runIntake` in `workflow()`; each existing `await` becomes a `step.run(...)`.
4. **Confirm the authoritative NY recording-tax rate table (Connor).** Until then `estimateSavings` runs on `PLACEHOLDER_RATES` and every borrower narrative carries the §255 _preliminary_ caveat. If any confirmed rate exceeds 3 dp, `buildSavingsNarrativePrompt` must round before injecting (Decision 7).
5. **Real LOS adapter (Encompass first).** Implement `LosAdapter` against the live LOS; swap `new FixtureLosAdapter()` in the Server Action — a one-line change by design (Decision 2).
6. **Provision `BRAINTRUST_API_KEY` + `ANTHROPIC_API_KEY`** so the live eval actually runs in the `llm-eval` job (today it skips-green). Folds into the broader Connor-owned env-var provisioning (Typesense, Mem0, Upstash, Cron).
7. **Best-effort narrative at the app boundary.** Decide whether `runIntakeFromLos` should try/catch a configured-but-failed model call (record to Sentry) rather than surface it to the processor (Decision 4 trade-off).
8. **LO notification (Slack/Teams)** on Deal creation — step 8, deferred.
9. **All M2–M9 carry-overs still pending** (see ADRs 0002–0009): Nango + PBX/email vendors; WDK consumers; Upstash provisioning + SETNX extension to non-Twilio webhooks; activity-feed pagination + `kg_edges` deal attribution; Reducto IDP; CRM enrichment; design partner (spec §13.1, overdue and now on the critical path for validating any agent end-to-end).

---

## References

- Plan: `docs/superpowers/plans/2026-05-28-phase-1-month-10-intake-agent.md`
- Predecessor ADRs: `docs/adr/0001`–`docs/adr/0009`
- Spec anchors: §9.3 (Intake Agent pipeline), §9.2 + §8 (WDK orchestration mandate), §4 (AI Gateway), §13.6 (LosAdapter), §10.5 (audit-log immutability), §11 (roadmap — re-baseline pending), §13.1 (design partner).
- PRs: #65 (kickoff), #67 (scaffold + eligibility), #68 (savings + fixture adapter), #69 (orchestrator), #70 (app wiring + RLS test), #71 (LLM narrative + prompt), #72 (Braintrust eval), and this close-out.
