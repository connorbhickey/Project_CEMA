# Phase 1 · Month 10 — Intake Agent (first CEMA AI agent)

> **Status:** PLAN — pending review. No code written yet.
> **Phase:** Phase 1 (Refi-CEMA Agent Layer) — **this is the first Layer 3 agent.**
> **Spec:** §9.1–9.3 (Layer 3 architecture + Intake Agent) and §13.6 (LosAdapter).
> **Author:** Claude Opus 4.8 + Connor · 2026-05-28

---

## 0. Why this milestone, why now

Months 1–9 built and hardened Layers 1–2 (Deal entity, attorney gate, telephony,
email, files, search, memory, knowledge graph, entity resolution, cache). That is
the foundation — but **no Layer 3 agent exists yet** (`packages/agents/` is empty).
Layer 3 is the product thesis: software that does CEMA processor work. M10 starts it.

Per spec §11 the agent layer was scheduled for Months 6–9; the schedule slipped ~4
months into foundation depth. M10 is the pivot from "workspace" to "automation."

**Agent build order** (each builds on the last; first three minimize new vendor deps):

1. **Intake Agent** ← _this milestone_ (deterministic core, proves the architecture)
2. Servicer Outreach Agent (needs Servicer playbook + Resend/fax)
3. Collateral IDP Agent (needs Reducto/Textract keys)
4. Chain-of-Title Agent (reuses M6's `@cema/kg` graph)

---

## 1. Goal & acceptance criteria

**Goal:** Ship the Intake Agent's deterministic core as a durable, audited workflow
that turns a normalized loan application into a `Deal` (status = `intake`) with an
eligibility decision and a recording-tax savings estimate.

**Acceptance criteria:**

- Given a normalized application, the agent returns a correct **eligibility decision**
  (NY · property type · first-lien · has-UPB rules from spec §9.3 step 2).
- For an eligible application, it computes a **savings estimate** from the NY
  recording-tax table (see §6 — Connor input required) and creates a `Deal`.
- Every run emits audit events (`intake.evaluated`, `deal.created`) — never bypassing
  the audit log (hard-rule, CLAUDE.md §10.5).
- A **Braintrust eval with ≥ 20 fixtures** covers eligible / ineligible / edge cases
  (CLAUDE.md §11).
- Full unit coverage on the pure eligibility + savings functions.
- Builds, typechecks, lints, tests green; runs in dev/CI **without** LLM keys
  (LLM narrative is env-gated, consistent with `isTypesenseConfigured()` pattern).

---

## 2. Scope — first slice (M10)

**In scope:**

- New `packages/agents/` workspace + `packages/agents/intake/` package.
- `LosAdapter` interface (spec §13.6) + a `FixtureLosAdapter` for testing.
- Pure `checkEligibility(app): EligibilityResult` — deterministic, fully unit-tested.
- Pure `estimateSavings(app, rates): SavingsEstimate` — deterministic, table-driven.
- Orchestrator that: read app → eligibility → savings → create `Deal` → audit.
- Optional LLM step (Claude Sonnet 4.6 via AI Gateway) for the borrower-facing
  **savings narrative** + eligibility **edge-case explanation** — env-gated off by default.
- Braintrust eval scaffold + ≥ 20 fixtures.

**Out of scope (deferred to later slices / M11+):**

- Live **Encompass** LOS adapter (slice 1 uses `FixtureLosAdapter`). LOS integration
  is its own package (`packages/integrations/encompass/`, not yet built).
- **ACRIS pre-discovery** (NYC BBL chain → draft Schedule A) — spec §9.3 step 3.
- **MERS** servicer lookup — step 4.
- Borrower **CEMA authorization PDF + DocuSign** routing — step 6 (DocuSign client
  exists from M4; wiring deferred).
- **Slack/Teams** LO notification — step 8 (clients exist from M4; wiring deferred).
- Voice (Phase 3).

---

## 3. Architecture decisions

`★ Decision 1 — Orchestration: build core orchestration-agnostic now, wrap in WDK later.`
Spec §9.2 + CLAUDE.md §8 mandate Vercel Workflow DevKit (WDK), but **`@vercel/workflow`
is not installed in any package** (confirmed 2026-05-28; a standing M2 carry-over). Rather
than block the entire agent layer on WDK infra, slice 1 implements the agent as **pure
functions + a thin async orchestrator** with explicit step boundaries, then wraps it in a
WDK `workflow()` once WDK is adopted repo-wide. Step boundaries are designed to map 1:1 to
future WDK steps (each is idempotent and individually testable). **This is a deliberate,
reversible deviation from §9.2 — flagged here per hard-rule #11 rather than silently taken.**

`★ Decision 2 — LosAdapter isolates LOS variance (spec §13.6).`
`getApplication(externalId): Promise<NormalizedApplication>` is the only surface the agent
depends on. Encompass / LendingPad / MeridianLink / Calyx each become an adapter impl. Slice
1 ships `FixtureLosAdapter`; Encompass is the first real impl (later slice). This keeps the
deterministic core testable today with zero vendor credentials.

`★ Decision 3 — LLM is additive + env-gated, never on the critical path.`
Eligibility and savings are **deterministic** (legal correctness > LLM judgment). The LLM
only drafts human-readable narrative. `isLlmConfigured()` (mirrors the project's existing
`isXConfigured()` gates) means dev/CI run green without `AI_GATEWAY_API_KEY`, and a missing
key degrades to "no narrative," never an error. LLM calls route through AI Gateway (no
hard-coded provider) using the already-present `@ai-sdk/anthropic`.

---

## 4. Task breakdown (TDD order)

> Follow CLAUDE.md §8: failing test first, signed commits, small PRs. The agent build is
> itself a multi-PR milestone — this plan is its spec, not a single PR.

1. **Workspace scaffold** — create `packages/agents/intake/` (package.json, tsconfig
   extending `@cema/config`, vitest). Add `packages/agents/*` to root workspace if needed.
2. **Types** — `NormalizedApplication`, `EligibilityResult`, `SavingsEstimate`, `LosAdapter`
   in `src/types.ts`. (Dispatch `pr-review-toolkit:type-design-analyzer` on these.)
3. **Eligibility (TDD)** — `checkEligibility()` pure fn + unit tests for every §9.3 step-2
   rule and its negations (co-op, VA, FHA, non-NY, second-lien, zero-UPB).
4. **Savings (TDD)** — `estimateSavings()` pure fn + table-driven tests. **Blocked on §6
   rate table.** Until confirmed, ship behind a clearly-marked `PLACEHOLDER_RATES` constant
   and skip the dollar-exact assertions (structure-only tests).
5. **FixtureLosAdapter** — deterministic fixtures (eligible/ineligible/edge) reused by evals.
6. **Orchestrator** — `runIntake(externalId, deps)`: adapter → eligibility → savings →
   `createDeal(status='intake')` → `emitAudit('intake.evaluated' | 'deal.created')`.
   Integration test against a Neon test branch (RLS-scoped).
7. **LLM narrative (env-gated)** — `draftSavingsNarrative()` via AI Gateway; `isLlmConfigured()`
   gate; unit test asserts skip-when-unconfigured.
8. **Prompts** — create `packages/prompts/` (does not exist yet) and version the intake
   prompt there per CLAUDE.md §8, or co-locate in `src/prompts/` if `packages/prompts/` is
   deferred. **Decision flag.**
9. **Braintrust eval** — `packages/agents/intake/evals/` with ≥ 20 fixtures; wire the
   `llm-eval` CI job (currently no agents exist for it to run against).
10. **Audit + OTel** — confirm audit rows are append-only; add OpenTelemetry spans per §8.
11. **Docs** — ADR `0010-phase-1-month-10-intake-agent.md` + CLAUDE.md §2 close-out.

---

## 5. Dependencies & prerequisites

| Need                               | State (2026-05-28)                              | Action                                              |
| ---------------------------------- | ----------------------------------------------- | --------------------------------------------------- |
| `@vercel/workflow` (WDK)           | **Not installed**                               | Decision 1 — defer; build orchestration-agnostic    |
| `packages/prompts/`                | **Does not exist**                              | Create in task 8, or co-locate                      |
| `packages/agents/` workspace       | **Empty**                                       | Create in task 1                                    |
| AI SDK                             | Present (`@ai-sdk/anthropic`, `@ai-sdk/openai`) | Use via AI Gateway                                  |
| `AI_GATEWAY_API_KEY`               | In `.env.example`, not provisioned              | Needed only for live narrative; gated off otherwise |
| `Deal` entity + `createDeal`       | Exists (Layer 1)                                | Reuse                                               |
| Audit emitter (`@cema/compliance`) | Exists                                          | Reuse                                               |
| Encompass LOS API                  | **Not built**                                   | Deferred — `FixtureLosAdapter` for slice 1          |

---

## 6. Decisions needed from Connor (domain input)

These are domain/legal calls I should **not** invent — getting them wrong has legal/tax
consequences (hard-rule: attorney-supervised tool):

1. **NY recording-tax rate table.** `estimateSavings()` needs authoritative per-county NY
   mortgage-recording-tax rates (NYC basic + special additional + NYC tax; upstate basic +
   special additional). What is the source of truth — a maintained config table, a vendor
   feed, or attorney-provided constants? Until confirmed, savings ships behind `PLACEHOLDER_RATES`.
2. **Eligibility edge rules.** Spec §9.3 lists 1–3 family / condo / PUD and excludes co-op /
   VA / FHA. Confirm: are mixed-use, 4+ unit, or PUD-with-HOA-lien cases in or out for v1?
3. **`packages/prompts/` now or later?** Create the shared versioned-prompts package this
   milestone, or co-locate intake prompts and extract later?

---

## 7. Risks

- **WDK adoption debt.** Building orchestration-agnostic now means a later WDK-wrap pass.
  Mitigated by designing idempotent step boundaries that map 1:1 to WDK steps.
- **Savings correctness.** Deterministic + table-driven + Connor-confirmed rates + unit
  tests on exact dollars once §6.1 lands. No LLM in the math path.
- **No design partner (spec §13.1, highest risk).** The agent can be built and unit-tested
  on fixtures, but real Encompass applications + real servicer behavior are needed to
  validate end-to-end and accumulate the playbook moat. Tracked as a Connor critical-path item.
