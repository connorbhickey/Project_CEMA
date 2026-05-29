# Phase 1 Month 11 (M11) — Agent-Layer Platform Debt: AI Gateway + WDK Durable Wrap

**Status:** Design — approved section-by-section by Connor 2026-05-29; pending written-doc review before `writing-plans`.
**Author:** M11 scoping (Claude Opus 4.8 + Connor Hickey)
**Relates to:** ADR 0010 (Intake Agent) carry-overs #2 (AI-Gateway) and #3 (WDK); ADR 0011 (OTel tracing) Decision 2 (`@cema/observability` extraction trigger) + its open "trace the model calls" item; spec §4 (AI Gateway is the mandated LLM router), §8 (Writing an agent — "route via AI Gateway", "use WDK for orchestration"), §9.3/§9.4 (Intake done, Servicer Outreach next), §11 (re-baselined roadmap).

---

## Context

M10 shipped the Intake Agent (the first Layer 3 agent) and ADR 0011 wired its OpenTelemetry traces. Two pieces of **platform debt** were deliberately deferred, both flagged inline in the code itself:

- **AI Gateway (spec §4 / §8).** The repo's two LLM call sites call the `anthropic('claude-sonnet-4-6')` provider **directly** — `packages/agents/intake/src/narrative.ts:43` (the borrower savings narrative) and `packages/search/src/classifier.ts:30` (the query-intent classifier). `narrative.ts:9–12` documents that this mirrors the classifier and that Gateway routing is "deferred… tracked for the M10 close-out ADR." Spec §8 mandates routing through Vercel AI Gateway (model routing, cost tracking, failover); both sites bypass it.
- **WDK durable workflows (spec §8).** `runIntake` (`packages/agents/intake/src/orchestrator.ts:56`) was built as a flat await-chain whose three I/O boundaries map 1:1 onto WDK `step.run(...)` (the code comment at lines 36–38 says so explicitly), but `@vercel/workflow` is not installed, so the wrap was deferred.

The M11 fork was: pay down this agent-layer platform debt vs. build the next agent (Servicer Outreach) vs. build a real LOS (Encompass) adapter. **The dominant constraint is that no design partner is secured yet** (spec §13.1, overdue, on the critical path) — and the next agent is the _most_ data-hungry one. With no real CEMA volume to validate a new agent against, the highest-leverage work is hardening the platform every later agent reuses.

**Connor chose "Platform debt first," then chose Approach 3: do BOTH debts in M11, sequenced as two PRs (Gateway first, then WDK).** This is justified by the next agent: Servicer Outreach (§9.4) needs _both_ primitives — multi-model routing (Opus to classify responses, Sonnet for cadence emails) **and** durable multi-day cadence (T+5/10/15/20). Both debts must be paid before that agent is comfortable; M11 pays them on the _simple, already-shipped_ Intake Agent so the patterns are proven before the agent that genuinely depends on them.

---

## Decision — milestone shape (two PRs, sequenced)

|          | Slice                                                                   | Closes                                                                          | Risk                                                                           |
| -------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **PR-A** | AI Gateway routing + model-call tracing + extract `@cema/observability` | Carry-over #2; ADR 0011 "trace the model calls"; ADR 0011 Decision 2 extraction | **Low** — no DB, no migrations, no execution-model change; behavior-preserving |
| **PR-B** | WDK durable wrap of `runIntake`                                         | Carry-over #3                                                                   | **Medium** — new runtime; changes how the agent is invoked                     |

**Why A before B:** A is behavior-preserving and closes four debt items; B changes the execution model and _builds on_ A's traced model calls. Shipping A first means a snag in the riskier B never holds the safe debt-paydown hostage.

**Milestone acceptance:** both LLM call sites resolve through Gateway (routing/cost visible + spans emitted); `runIntake` runs as a durable workflow with each boundary a replayable step; intake's 82 tests stay green plus new per-slice tests; **zero new migrations**; CLAUDE.md updated; one ADR per slice (0012, 0013).

**Insight — why the WDK wrap is a substitution, not a rewrite.** `withChildSpan<T>(name, fn: () => Promise<T>): Promise<T>` (orchestrator.ts:16) and WDK's `step.run(name, fn)` are signature-identical. M10 built `withChildSpan` as the seam on purpose. The clean composition is _step outside, span inside_: `step.run('…', () => withChildSpan('…', fn))` — durability and tracing nest together.

---

## Slice 1 (PR-A) — AI Gateway + model-call tracing + `@cema/observability`

### Components

1. **Provider routing.** `narrative.ts:43` and `classifier.ts:30` swap `anthropic('claude-sonnet-4-6')` → the Gateway-routed model. We are on AI SDK `^4.0.0`, so the exact mechanism (`@ai-sdk/gateway` provider vs. model-string routing) is a `writing-plans` detail sourced from the `vercel:ai-gateway` skill. The change is per-call-site and reversible — only the `model:` field moves, regardless of whether the call uses `generateText` (narrative) or `generateObject` (classifier), because the Gateway sits _under_ both as a model-resolution layer.

2. **The gate decision.** The narrative is env-gated by `isLlmConfigured()` = `!!process.env.ANTHROPIC_API_KEY`; through Gateway the credential becomes the Gateway key (or Vercel OIDC in prod), so that gate must test the _Gateway_ credential. The classifier (`classifier.ts:24`) is **ungated** today. **Decision: preserve today's posture** — classifier stays ungated (Gateway-reachable assumed, exactly as a present API key was), narrative's gate switches to the Gateway credential. The slice stays behavior-preserving except for the routing path.

3. **Trace the model calls.** Wrap both `generate*` calls in spans (`intake.draft_narrative`, `search.classify_query`), finishing the OTel model-surface coverage ADR 0011 deferred. **PII-safe attributes only** (hard rule #3 / §10.3): model id, classifier intent/confidence, token usage if exposed — **never** prompt/response text, and never the savings dollar figures the narrative prompt embeds.

4. **Extract `@cema/observability`.** The classifier becomes the _second_ instrumented surface — the exact trigger ADR 0011 Decision 2 named ("the moment a second package needs instrumentation, lift the shared helper"). Lift `withChildSpan` + the PII-safe attribute conventions (allowlist + dollar-field denylist) into `packages/observability/` (the package CLAUDE.md §6 always planned). Both `@cema/agents-intake` and `@cema/search` consume it. The intake `orchestrator.trace.test.ts` guard moves/duplicates into the shared package's tests.

### Error posture (unchanged)

Narrative returns `null` when unconfigured / throws when configured-but-failed (so the app boundary can record to Sentry — carry-over #7). Classifier still throws on failure (load-bearing for search).

### Tests

Assert each call resolves through the Gateway provider; apply the trace-test PII allowlist to the two new model spans; unit-test the extracted `withChildSpan` + allowlist in `@cema/observability`; intake's 82 + search's existing suites stay green.

---

## Slice 2 (PR-B) — WDK durable wrap of `runIntake`

The three awaited boundaries to make durable (orchestrator.ts): `intake.fetch_application` (60–62), `intake.emit_audit` (76–83), `intake.create_deal` (93–95). The deterministic pure steps (`checkEligibility`, `estimateSavings`) stay inline as parent attributes — they have no I/O.

**Insight — M10's split-audit design pre-paid for durability.** `intake.evaluated` is emitted _before_ deal creation and `deal.created` is written atomically _inside_ `createDeal` (orchestrator.ts:50–54). The two writes are already separate, independently-checkpointable effects, so they map onto two durable steps with no restructuring.

### Decision 1 — Where the `step` primitive lives: **inject it via `IntakeDeps`**

The core cannot import `@vercel/workflow`. Unlike `@opentelemetry/api` (a no-op until a provider registers, which is why ADR 0011 allowed importing it in the core), `step.run` needs a live workflow context — importing it would break both the orchestration-agnostic rule (ADR 0010) and every unit test that calls `runIntake` outside a workflow. So **add a `step` runner to `IntakeDeps`**: production injects WDK's `step.run`; tests and any non-durable caller inject the passthrough `(name, fn) => fn()` (today's exact behavior). `withChildSpan` composes inside it. The core stays dependency-free and the 1:1 boundary promise stays literal.

_Rejected:_ (b) wrapping from outside `runIntake` can't reach the internal boundaries without collapsing them into one opaque step or rewriting the core; (c) importing WDK in the core breaks the agnostic posture and unit tests.

### Decision 2 — The Server Action contract: **keep synchronous, with a contingency**

`runIntakeFromLos` (`apps/web/lib/agents/intake/run-intake-action.ts`) currently `await`s `runIntake` and returns `IntakeResult` inline — the processor clicks "import" and gets eligibility + savings + dealId back in one request. Intake is sub-second and synchronous, so the durability payoff _here_ is modest; the real async/multi-day payoff is the next agent (Outreach). **So M11's WDK slice is a pattern-establishing rehearsal on a simple synchronous agent:** keep the synchronous-await contract, make the _steps_ durable/checkpointed underneath, return `IntakeResult` unchanged.

**Contingency:** this assumes WDK supports awaiting a workflow within a request. If WDK _requires_ out-of-band execution, the fallback is a pending-deal UX (trigger + return pending; the Deal appears asynchronously on the pipeline) — a materially bigger PR-B. **`writing-plans` must resolve the WDK execution model first** (via the `vercel:workflow` skill), since it can right-size the slice before any code is committed.

### Decision 3 — Replay idempotency: **memoization + a code-level `external_id` guard**

Durable steps re-run on retry. WDK memoizes _successful_ steps, so a resumed workflow won't double-write `emit_audit`/`create_deal`. For a full retry-from-scratch, add a **code-level** `external_id` idempotency guard on `createDeal` (lookup-before-insert) — the append-only audit log (§10.5) tolerates a duplicate `intake.evaluated` better than a duplicate Deal. A DB unique index is noted as deferred hardening so the **zero-migration** claim holds. Connects to the standing Upstash SETNX idempotency carry-overs.

### Decision 4 — OTel-inside-step: **verify, do not presume** (the open risk ADR 0011 flagged)

Steps can replay in fresh executions, so the parent `intake.run` span's context may not survive a step boundary. Stance: compose step-outside/span-inside, then **verify** nesting against the real runtime; if context doesn't propagate across replay, degrade gracefully to recording step identity as a span attribute/link rather than strict parent-child nesting. PR-B must prove this.

### Trigger & location

Keep the existing trigger (the Server Action) — durably wrapping orchestration doesn't require changing how it's kicked off (queue-triggered is later, with the real LOS adapter, carry-over #5). The workflow definition lives at the app boundary (`apps/web/lib/agents/intake/`, beside `deps.ts`/`run-intake-action.ts`) since it needs app concerns (DB/Clerk); the core stays in the package.

### Tests

All 82 intake tests stay green unchanged (passthrough `step` = today's behavior). New tests with a fake durable `step` assert each boundary runs as a discrete named step, results thread through correctly, and the wrap is behavior-preserving (same `IntakeResult` as the bare core), plus the Decision-4 OTel-nesting verification.

---

## Cross-cutting

- **Env vars (Connor-provisioned, non-blocking to merge):** PR-A adds `AI_GATEWAY_API_KEY` for local/CI (prod uses OIDC). `ANTHROPIC_API_KEY` is _still_ unprovisioned (gating item), so neither the direct provider nor the Gateway is exercised live yet — both slices are validated by tests, not a live backend, exactly like the OTel slice. PR-B installs `@vercel/workflow` (no secret).
- **Migrations:** **zero** (PR-B idempotency is a code-level guard, not a DB constraint).
- **ADRs:** **ADR 0012** (AI Gateway adoption + `@cema/observability` extraction) with PR-A; **ADR 0013** (WDK durable wrap) with PR-B.

### Carry-overs M11 closes

- #2 — AI-Gateway adoption (both call sites routed).
- #3 — WDK wrap (intake durably wrapped; pattern established).
- ADR 0011 open "trace the model calls" item.
- ADR 0011 Decision 2 — `@cema/observability` extracted.

### Still open after M11

#4 NY recording-tax rate table (Connor); #5 real LOS adapter (Encompass); #6 provision `BRAINTRUST_API_KEY` + `ANTHROPIC_API_KEY` (+ now `AI_GATEWAY_API_KEY`); #7 best-effort narrative / Sentry (error posture clarified, Sentry stays unwired); #8 LO notification on Deal creation; #9 all M2–M9 carry-overs, including the **design partner (overdue, on the critical path)**.

---

## Open questions for `writing-plans`

1. **WDK execution model (blocks PR-B sizing):** does `@vercel/workflow` support awaiting a workflow inside a Server Action (keeps Decision 2's synchronous contract), or does it require out-of-band execution (forces the pending-deal UX)? Resolve via the `vercel:workflow` skill _first_.
2. **AI Gateway invocation on AI SDK v4:** `@ai-sdk/gateway` provider vs. model-string routing — confirm the supported pattern and the exact local/CI credential fallback.
3. **OTel context across WDK step replay (Decision 4):** does the parent span context propagate, or do we record links/attributes instead?
4. **`@cema/observability` surface:** the minimal API shaped by its two real consumers (`withChildSpan`, the PII allowlist/denylist constants, a `getTracer` helper?).

---

## Alternatives considered

- **AI-Gateway slice only (defer WDK):** the recommended _order_, but Connor chose to commit to both in M11 so Servicer Outreach starts on clean platform. WDK stays a separate, isolated PR within the milestone rather than a separate milestone.
- **WDK only (defer Gateway):** de-risks the bigger unknown first, but leaves the model-routing/cost spine unbuilt and doesn't finish the OTel model-surface coverage; lower carry-overs-closed per unit effort.
- **One combined PR:** rejected — PR-B changes the execution model and deserves isolation; bundling risks the safe half being blocked by the risky half (the M10 multi-PR stretch is the cautionary precedent).
- **Build Servicer Outreach (next agent) instead:** rejected for M11 — it's the most data-hungry agent and there's no design partner / real CEMA volume to validate it against yet (spec §13.1). It also needs _both_ platform primitives M11 builds, so it's better sequenced after.
