# ADR 0017: Phase 1 Month 14 (Slice 1) — Agent Triggers (deal_status fan-out)

**Status:** Accepted (shipped 2026-05-31)
**Author:** M14 Slice 1 (Claude Opus 4.8 + Connor Hickey)
**Relates to:** spec §9 (CEMA AI agents); ADR 0010 (Intake Agent blueprint); ADR 0011 (OTel); ADR 0013 (WDK durable wrap); ADR 0014 (Servicer Outreach Agent); ADR 0015 (Collateral IDP Agent); ADR 0016 (Chain-of-Title Agent)

---

## Context

By the end of M13 the system had **four** Layer 3 agents — Intake (M10), Servicer
Outreach (M12), Collateral IDP (M13 Phase 1), Chain-of-Title (M13 Phase 2) — each
shipped, evaluated, and dormant. Every one had an app-layer `'use server'` entry point
(`runIntakeFromLos`, `runOutreachFromDeal`, `runCollateralIdpFromDeal`,
`runChainOfTitleFromDeal`), but **nothing invoked any of them**. The agents were a set
of disconnected capabilities, not a pipeline.

M14 Slice 1 wires the triggers so the agents actually run end-to-end. The chosen trigger
surface is the **`deal_status` lifecycle**: a Deal's status is the natural state machine a
processor (or, later, an upstream agent) advances, and three of the four agents map
cleanly onto a status. Concretely:

- `collateral_chase` → **Servicer Outreach Agent** (chase the prior servicer for the file)
- `title_work` → **Collateral pipeline**: IDP classifies the arrived file → Chain-of-Title
  validates the recorded chain → a `re_chase` break loops back to Outreach

The Intake Agent is **not** wired here: it runs at deal _creation_ from a LOS pull, which
is upstream of any status transition (it is the thing that produces the first Deal). The
other three are post-creation, status-driven, and are the subject of this slice.

There is deliberately **no `deal_status` transition state machine**. The spec does not
define a legal edge set, and inventing one risks blocking legitimate processor flows. The
write path records the change, audits it, and fans out — a legality guard can be layered
on later once the spec settles the lifecycle graph.

## Decision

### 1. `transitionDealStatus` is the single write path for a Deal's status

A `'use server'` action (`apps/web/lib/actions/transition-deal-status.ts`) is the one
place a Deal's `status` changes. It resolves identity from the Clerk session, validates
the target enum at the system boundary (an RPC endpoint takes arbitrary client args, so
the compile-time `DealStatus` type is not trusted), reads the current status under RLS,
and — only when `from !== to` — writes the new status, emits a PII-safe
`deal.status_changed` audit event (`{from, to}` enum pair only — never names or amounts,
hard rule #3), and `revalidatePath('/deals')`. A no-op (`from === to`) returns
`{changed: false}` with no write, no audit, and no dispatch, keeping the audit log free of
zero-delta events. Transitioning to `completed` sets `completedAt` in the same UPDATE to
satisfy the `deals_completed_at_required` CHECK.

### 2. Post-commit, in-request, best-effort fan-out

`onDealStatusChanged(dealId, toStatus)` runs **after** the status write commits and is
awaited in-request, but only when `result.changed` is true. It is **best-effort by
design**: every agent error is caught, `redactPii`-logged, and recorded on the span as
`ERROR`, but **never rethrown**. The status write already succeeded and was audited; a
failed downstream agent run is a side effect that must never roll it back or surface as a
failed transition. The swallowed `console.error` line is hardened twice over: the **whole**
composed line (not just the exception message) is run through `redactPii` (hard rule #3),
then every CR/LF is stripped so an untrusted `dealId` can never forge a second log entry.
The strip uses the quantifier-free `/[\r\n]/g` — the exact form CodeQL recognizes as a
`js/log-injection` sanitizer (a `+` makes the matched set infinite and defeats recognition,
which re-raised the alert on the first attempt — PR #99 review).

It runs **in-request** because that is the only trigger path that works today: the agent
actions are session-backed Server Actions, and neither cron nor Vercel Queues carries a
request session (and there is no durable WDK backend provisioned yet — `lib/queue.ts`'s
send is a no-op stub). At durable activation (Connor-gated) this becomes fire-and-forget.

### 3. Pure routing core + effectful dispatcher split

The status → agent map is a pure, table-driven function —
`triggerForStatus(status): 'collateral_pipeline' | 'outreach' | null` in
`on-deal-status-changed-core.ts` — so it is unit-testable with **zero** mocking of any
Server Action and lives outside the dispatcher's effectful boundary. The effectful
dispatcher (`on-deal-status-changed.ts`) carries the `deal.status_dispatch` OTel span and
the best-effort swallow. This split is also a `'use server'` constraint: a `'use server'`
module may export only async functions, so the pure helper _must_ live in a separate
non-`'use server'` module (a `type`/`const` export from a `'use server'` file is illegal).

### 4. `runCollateralPipeline` composes IDP → Chain-of-Title → Outreach

The `title_work` trigger runs a composition, not a single agent
(`apps/web/lib/agents/collateral-pipeline.ts`):

```
IDP  →  (if ≥1 doc classified)  Chain-of-Title  →  (if a re_chase break)  Outreach
```

Each stage is an existing session-backed Server Action (identity/RLS resolved per stage).
The `re_chase` loop-back is the elegant closure of the agent family: a chain break that is
_recoverable by chasing the servicer_ (`missing_assignment`, per ADR 0016 Decision 3)
re-invokes Outreach from inside the pipeline. The branch predicate is a pure helper —
`hasReChase(chain)` in `collateral-pipeline-core.ts` — kept out of the `'use server'`
module for the same reason as Decision 3. Unlike the dispatcher, the pipeline
**propagates** errors: the "never block the status write" policy lives one layer up, in
`onDealStatusChanged`, not in the composition.

### 5. Status mapping

| `deal_status`      | Trigger               | Why                                                                                                         |
| ------------------ | --------------------- | ----------------------------------------------------------------------------------------------------------- |
| `title_work`       | `collateral_pipeline` | The collateral file has arrived — classify + validate it                                                    |
| `collateral_chase` | `outreach`            | Still chasing the prior servicer for that file                                                              |
| (10 others)        | `null`                | No agent wired — explicit `UNWIRED` list in the core test forces a deliberate edit when a new trigger lands |

### 6. OTel: two PII-safe spans

`deal.status_dispatch` (dispatcher) and `pipeline.collateral` (composition) each open an
active span. Attributes are PII-safe by construction: opaque `dealId`, the `deal_status`
enum value, the trigger token, document **counts**, the chain **status enum**, and
booleans only — never party names, amounts, or any `ChainBreak.detail`. With no SDK
registered in Vitest the tracer is a non-recording no-op, so the app-action tests need no
`@opentelemetry/api` mock.

### 7. PII-safe, 0 new migrations

The whole slice reuses the existing `deals` / `audit_events` schema and the agents'
existing persistence (IDP enriches `documents.extractedData`; Chain-of-Title and Outreach
write only `audit_events` / `communications`). No schema change.

---

## What shipped

Three squash PRs over a sequential TDD series (each stacked on the prior, since P3 imports
P2's `runCollateralPipeline` and P2 imports the agents P1's action will trigger):

- [#97](https://github.com/connorbhickey/Project_CEMA/pull/97) — `transitionDealStatus` Server Action + split audit (Decision 1)
- [#98](https://github.com/connorbhickey/Project_CEMA/pull/98) — `runCollateralPipeline` + `hasReChase` (Decision 4)
- [#99](https://github.com/connorbhickey/Project_CEMA/pull/99) — `onDealStatusChanged` dispatcher + wire into `transitionDealStatus` (Decisions 2–3, 5–6)

### Files — `apps/web/lib/`

| File                                         | Change                                                                                                                                                                                                      |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `actions/transition-deal-status.ts`          | **New (#97), wired (#99).** Single status write path; boundary enum guard; split audit; no-op short-circuit; `completedAt` on `completed`; post-commit `await onDealStatusChanged` on a real change         |
| `actions/transition-deal-status.test.ts`     | **New (#97), extended (#99).** 6 tests — invalid status, org-not-found, deal-not-found, no-op, write+audit+revalidate+dispatch, `completedAt`                                                               |
| `agents/collateral-pipeline-core.ts`         | **New (#98).** `CollateralPipelineResult` interface + pure `hasReChase`                                                                                                                                     |
| `agents/collateral-pipeline-core.test.ts`    | **New (#98).** 3 tests — `hasReChase` true / false / empty                                                                                                                                                  |
| `agents/collateral-pipeline.ts`              | **New (#98).** `'use server'` `runCollateralPipeline`; `pipeline.collateral` span; propagates errors                                                                                                        |
| `agents/collateral-pipeline.test.ts`         | **New (#98).** 4 tests — IDP-only (no docs), IDP→Chain (clean), IDP→Chain→Outreach (re_chase), error propagation                                                                                            |
| `agents/on-deal-status-changed-core.ts`      | **New (#99).** Pure `triggerForStatus` routing table + `AgentTrigger` type                                                                                                                                  |
| `agents/on-deal-status-changed-core.test.ts` | **New (#99).** 3 tests — both wired statuses + the `UNWIRED` exhaustiveness sweep                                                                                                                           |
| `agents/on-deal-status-changed.ts`           | **New (#99).** Effectful dispatcher; `deal.status_dispatch` span; best-effort swallow                                                                                                                       |
| `agents/on-deal-status-changed.test.ts`      | **New (#99).** 5 tests — pipeline fires, outreach fires, unwired fires neither, thrown agent error is swallowed, and a hostile `dealId`+SSN error yields a single PII-masked log line (log-injection guard) |

**21 tests across the slice** (transition 6, pipeline-core 3, pipeline 4, dispatch-core 3,
dispatch 5). **0 new migrations.**

## Consequences

**Positive:** the four built-but-dormant agents are now a working pipeline. Advancing a
Deal to `collateral_chase` runs Outreach; advancing to `title_work` runs IDP →
Chain-of-Title and loops back to Outreach on a recoverable break — all from the single,
audited `transitionDealStatus` write path. The pure/effectful split keeps the routing
table trivially testable, and the best-effort swallow guarantees an agent failure can
never corrupt the deal's recorded lifecycle. PII-safe by construction; no schema change.

**Negative / tradeoffs:** the fan-out is **awaited in-request**, so a slow agent run
lengthens the status-transition response — acceptable while the runs are synchronous and
bounded, but it must move off the request path at durable activation. There is **no
idempotency guard at the pipeline level**: re-entering `title_work` re-runs the
composition (the individual agents are idempotent — IDP keyed by `documents.id`, Outreach
by touch number — but the pipeline has no dedupe). And there is **no transition legality
guard** — any status → any status is permitted (deliberate, per Context).

## Carry-overs (deferred to M14 Slice 2+)

1. **Durable activation** (Connor). At WDK activation the in-request `await
onDealStatusChanged` becomes fire-and-forget (enqueue + return), and the dispatcher
   moves onto the durable variants of each agent action. Needs a WDK backend +
   `VERCEL_OIDC_TOKEN` + the `/.well-known/workflow/*` `proxy.ts` exclusion (shared with
   ADR 0013/0014/0015/0016 carry-overs).
2. **Document-upload trigger for IDP.** `title_work` is a coarse trigger; a finer one is a
   document-upload event that runs IDP (and, on completion, Chain-of-Title) without
   requiring a status change. Slice 2+ once the upload surface exists.
3. **Pipeline idempotency.** A dedupe guard (e.g. skip if the deal already has a recent
   IDP/Chain run) so a repeated `title_work` entry does not re-run the whole composition.
4. **Transition legality guard.** Once the spec settles the legal `deal_status` edge set,
   layer a state-machine check into `transitionDealStatus` (currently any → any).
5. **Move the fan-out off the request path** (folds into #1): even before full durability,
   the awaited dispatch could be enqueued so the processor's status-change UI is not
   blocked on a multi-second agent run.
6. **Real route actuators stay dormant** (ADR 0016 carry-over #1): Chain-of-Title's
   `re_chase` loops back to Outreach _inside the pipeline_, but the attorney-review branch
   is still audit-only — it needs the review surface (M14 Slice 3).
