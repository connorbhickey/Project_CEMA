# ADR 0014: Phase 1 Month 12 — Servicer Outreach Agent

**Status:** Accepted (shipped 2026-05-30)
**Author:** M12 (Claude Opus 4.8 + Connor Hickey)
**Relates to:** spec §9.4 (Servicer Outreach Agent); ADR 0010 (Intake Agent blueprint); ADR 0011 (OTel); ADR 0012 (AI Gateway); ADR 0013 (WDK durable wrap); M12 design doc

---

## Context

M10 shipped the Intake Agent as the first Layer 3 agent on an orchestration-agnostic
pure-core blueprint. M12 is the **second** Layer 3 agent — the Servicer Outreach
Agent — which automates the prior-servicer collateral-file chase that is the single
biggest driver of CEMA deal time (target: ~75 → ≤ 45 days; success metric ≥ 90% of
servicer touches automated). Phase 1 scope is **email only, no voice**. It is the
**first agent that genuinely needs durability**: a touch cadence spans weeks.

## Decision

### 1. Cadence is a pure evaluator over injected touch-history

`OUTREACH_OFFSETS_BUSINESS_DAYS = [0, 5, 10, 15, 20]` (5 touches: initial + four
follow-ups). `addBusinessDays` skips weekends (UTC); NY holidays are a carry-over.
The anchor is the **earliest recorded touch timestamp** (else `now()` on the first
run), so `planOutreachCadence` is reproducible — re-evaluation and durable replay
compute the same `dueAt[]`. `nextOutreachAction` is a pure function of
`{cadence, now, touchesSent, response}` returning `send | wait | stop | unsupported_channel`.
No clock or DB inside the evaluator; all effects are injected via `OutreachDeps`.

### 2. Trigger = `deal_status` enum `collateral_chase`

Reuses the existing `deal_status` enum value (`enums.ts`) — **0 new migrations**
(reuses `communications`, `existing_loans`, `servicer_cema_departments`,
`audit_events`). A touch is one `communications` row (`kind='email'`,
`direction='outbound'`, `vendorEventId='outreach:<dealId>:touch:<n>'` for idempotency).

### 3. Email channel behind a `ServicerChannelAdapter` seam

`FixtureChannelAdapter` today (records sends, deterministic message id); a real
Resend adapter is a carry-over (one-line swap in the Server Action). The agent
short-circuits to `unsupported_channel` when the servicer has no email on file or
`acceptedSubmissionMethods` excludes email — the cadence never silently no-ops.

### 4. Additive, env-gated LLM polish — never legally load-bearing

`draftOutreachEmail` NEVER returns null: `renderTemplateEmail` is a deterministic,
PII-free, always-compliant floor. When `AI_GATEWAY_API_KEY` is set the body is
polished via the Vercel AI Gateway (`anthropic/claude-sonnet-4.6`, ADR 0012);
**any** model failure records the exception + `outreach.draft_fallback` and returns
the template. A late servicer follow-up must never fail on an additive polish step.

### 5. Split audit: `outreach.planned` before send / `outreach.touch_sent` atomic

Every run emits `outreach.planned` (before any send), mirroring intake's
`intake.evaluated`. A successful touch writes the `communications` row and
`outreach.touch_sent` **co-transactionally** in one `withRls` block.

### 6. OTel: `outreach.run` parent + PII-safe child spans

One parent span + a child span per awaited boundary
(`outreach.load_context`, `outreach.emit_planned`, `outreach.send_touch`,
`outreach.record_touch`) via `withChildSpan`. The gated email polish **self-spans**
as `outreach.draft_email` inside `draftOutreachEmail` (the ADR 0012 pattern — the
orchestrator does not double-wrap it). Attributes are PII-safe by allowlist
(ids + booleans + the action enum only — never servicer names, email bodies, or
addresses), enforced by `orchestrator.trace.test.ts`.

### 7. Durable wrap reuses the core as ONE step (no orchestration duplication)

Unlike intake (ADR 0013), the re-entrant evaluator lets `outreachWorkflow`
(`'use workflow'`) call the **whole** `runOutreach` core once per iteration as a
single `'use step'` (`runOutreachStep`), adding only a durable `sleep(dueAt)` loop
bounded by `MAX_ITERATIONS=12`. Sandbox-clean (inlined constant, type-only result
import). Dormant `runOutreachFromDealDurable` action (`start()` + `run.returnValue`).
The mocked-step orchestration test is the authoritative behavioral guard; the
`@workflow/vitest` durable proof is deferred (same `@cema/*`-externalization cause
as ADR 0013 carry-over #5).

### 8. Braintrust eval — offline scorers are the real gate

Five pure compliance scorers (no UPL, no PII leak to a third party, deal reference
present, professional B2B tone, requests the collateral file) verified offline by
`scorers.test.ts` (required `Unit tests` job) over all 25 fixtures' template-floor
output. The live run grades only the LLM polish and is skip-green unless both
`BRAINTRUST_API_KEY` and `AI_GATEWAY_API_KEY` are set.

---

## What shipped

`@cema/agents-servicer-outreach` (the 21st workspace package) +
`apps/web/lib/agents/servicer-outreach/` app wiring. **0 new migrations.** Shipped as
six PRs: #81 (scaffold + cadence), #82 (channel seam), #83 (drafter + classifier),
#85 (orchestrator + dormant app wiring), #86 (dormant WDK durable wrap), #84
(Braintrust eval) — landed out of numeric order since the eval depends only on the
drafter (PR-6 → #84).

### Package — `packages/agents/servicer-outreach/`

| File                             | Change                                                                                                                            |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `src/types.ts`                   | **New.** `OutreachAction` (incl. `unsupported_channel`), `OutreachResult`, `OutreachDeps`, cadence/context types                  |
| `src/cadence.ts`                 | **New.** `OUTREACH_OFFSETS_BUSINESS_DAYS = [0,5,10,15,20]`, `addBusinessDays`, `planOutreachCadence`, `nextOutreachAction` (pure) |
| `src/cadence.test.ts`            | **New.** 12 tests — stable-anchor reproducibility + every action transition                                                       |
| `src/channel.ts`                 | **New.** `ServicerChannelAdapter` seam + `FixtureChannelAdapter` (deterministic message id)                                       |
| `src/channel.test.ts`            | **New.** 2 tests                                                                                                                  |
| `src/draft.ts`                   | **New.** `draftOutreachEmail` — template floor (never null) + env-gated AI-Gateway polish; self-spans `outreach.draft_email`      |
| `src/draft.test.ts`              | **New.** 8 tests — floor compliance + gated-polish fallback                                                                       |
| `src/classify.ts`                | **New.** Dormant `classifyServicerResponse` (inbound-reply seam; not yet wired)                                                   |
| `src/classify.test.ts`           | **New.** 2 tests                                                                                                                  |
| `src/orchestrator.ts`            | **New.** `runOutreach` core — orchestration-agnostic; parent span + 4 child spans; split audit                                    |
| `src/orchestrator.test.ts`       | **New.** 6 tests — send / wait / stop / unsupported_channel paths + idempotency                                                   |
| `src/orchestrator.trace.test.ts` | **New.** 1 test — PII-safe span-attribute allowlist guard                                                                         |
| `src/index.ts`                   | **New.** Public surface                                                                                                           |
| `evals/scorers.ts`               | **New.** 5 pure compliance scorers + `OUTREACH_SCORERS`                                                                           |
| `evals/scorers.test.ts`          | **New.** 37 tests — the offline compliance gate over the template floor                                                           |
| `evals/fixtures.ts`              | **New.** 25 fixtures (5 servicers incl. null × 5 touches) via `flatMap`                                                           |
| `evals/outreach-email.eval.ts`   | **New.** Braintrust `Eval()` wiring (skip-green unless both keys set)                                                             |
| `evals/run.mjs`                  | **New.** Eval runner (`pnpm eval`)                                                                                                |
| `package.json` / `tsconfig.json` | **New.** Package manifest (`test`, `eval` scripts; `braintrust` devDep)                                                           |

### App — `apps/web/lib/agents/servicer-outreach/`

| File                             | Change                                                                                  |
| -------------------------------- | --------------------------------------------------------------------------------------- |
| `deps.ts`                        | **New.** Builds `OutreachDeps` (DB / Clerk / `FixtureChannelAdapter`) for the app       |
| `run-outreach-action.ts`         | **New.** Live `'use server'` shell over `runOutreach` (non-durable)                     |
| `outreach.steps.ts`              | **New.** The one `'use step'` `runOutreachStep` — rebuilds deps, runs the whole core    |
| `outreach.workflow.ts`           | **New.** `'use workflow'` `outreachWorkflow` — `sleep(dueAt)` loop, `MAX_ITERATIONS=12` |
| `outreach.workflow.test.ts`      | **New.** 3 tests — mocked-step orchestration guard (the behavioral authority)           |
| `run-outreach-durable-action.ts` | **New.** Dormant `'use server'` action: `start()` + `run.returnValue`                   |

**71 servicer-outreach tests** — 68 package (7 files: cadence 12, channel 2, classify
2, draft 8, orchestrator 6, orchestrator.trace 1, scorers 37) + 3 apps/web
(`outreach.workflow.test.ts`). No new DB migrations.

## Consequences

**Positive:** the highest-leverage manual step (servicer chase) is now an automatable,
durable, attorney-safe agent on the proven M10 blueprint; required CI stays green
with no backend and no secrets.

**Negative / tradeoffs:** the channel + durable action are dormant until a design
partner + `RESEND_API_KEY` + a WDK backend are provisioned; NY-holiday handling and
inbound response classification (`classifyServicerResponse`) are stubbed/dormant.

## Carry-overs

1. **Real Resend channel adapter** — implement `ServicerChannelAdapter` over Resend;
   add `packages/integrations/resend/` (hard rule #12) + spec §16 row; one-line swap.
2. **Wire a trigger** — a cron or deal-status-change hook that calls
   `runOutreachFromDeal` (or the durable variant) for `collateral_chase` deals.
3. **NY holiday calendar** in `addBusinessDays` (currently weekends only).
4. **Inbound response ingestion** — wire `classifyServicerResponse` to real replies
   (Nylas/Resend inbound) so `response` is populated and the cadence can stop early.
5. **Durable activation** (Connor) — WDK backend + `VERCEL_OIDC_TOKEN`, exclude
   `/.well-known/workflow/*` from the `proxy.ts` matcher, flip behind a flag. At
   activation the dormant action's in-request `await run.returnValue` must become
   fire-and-forget (return `runId`, retrieve `OutreachResult` out-of-band) — the
   `Promise<OutreachResult>` contract is incompatible with a long-sleeping cadence
   (raised by CodeRabbit on PR #86; deferred since the seam is dormant).
6. **Trace the durable steps** + provision `BRAINTRUST_API_KEY`/`AI_GATEWAY_API_KEY`.
