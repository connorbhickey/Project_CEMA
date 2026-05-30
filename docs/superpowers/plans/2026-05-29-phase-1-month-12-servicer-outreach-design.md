# Phase 1 Month 12 (M12) — Servicer Outreach Agent (second Layer 3 agent)

**Status:** Design — approved (full design) by Connor 2026-05-29; pending written-doc review before `writing-plans`.
**Author:** M12 scoping (Claude Opus 4.8 + Connor Hickey)
**Relates to:** spec §9.4 (Servicer Outreach Agent), §11 (re-baselined roadmap — agent layer ~4 months behind the original schedule), §8 ("Writing an agent" — route via AI Gateway, use WDK for orchestration, ≥20 Braintrust fixtures, OTel traces, audit-log writes), §6.3/§6.5 (servicer department + communications schema), §10.3/§10.5 (PII redaction + audit-log immutability); ADR 0010 (Intake Agent — the blueprint this milestone mirrors) carry-over #5 (real LOS adapter) and #9 (design partner, overdue); ADR 0011 (OTel tracing); ADR 0012 (AI Gateway adoption); ADR 0013 (WDK durable wrap — "Shape B", the dormant-seam pattern M12 reuses).

---

## Context

M10 shipped the **Intake Agent** (the first Layer 3 agent — spec §9.3) and M11 paid down the two platform debts every later agent reuses: AI Gateway routing + model-call tracing (ADR 0012) and the WDK durable-wrap pattern (ADR 0013). With the platform primitives proven on the simple, deterministic Intake Agent, M12 builds the **second** Layer 3 agent: the **Servicer Outreach Agent** (spec §9.4).

This is the agent that delivers **spec product-goal #2 — cut deal cycle time from ~75 days toward ≤45** by automating the single biggest source of dead time in a CEMA: waiting on the prior servicer to acknowledge the request and ship the collateral file. Today a human processor pesters the servicer's CEMA department on a manual cadence (an initial request, then follow-ups every business week) and the servicer's slowness, not the lender's, sets the clock. The agent automates that cadence. **Success metric (spec §9.4): ≥90% of servicer touches automated.**

**Phase 1 scope is deliberately narrow (spec §11):** outbound **email only, no voice** (voice is Phase 3, spec §9.4 step 6). M12 builds the outreach **cadence engine + email touch** end-to-end behind the now-standard agent seams, and stops short of live sending and inbound-response classification — both of which need a design partner's real servicer traffic to validate (carry-over; spec §13.1 / ADR 0010 #9, overdue and on the critical path).

### Trigger — anchored on the `deal_status` enum, not §9.4's prose

Spec §9.4 describes the trigger conceptually as "authorization_received." The **authoritative** source of truth is the `deal_status` enum (`packages/db/src/schema/enums.ts`), whose relevant value is **`collateral_chase`** — the lifecycle stage a deal enters once borrower/lender authorization is in hand and the prior servicer must now be chased for the collateral file. **The agent triggers when a Deal reaches `collateral_chase`.** Per hard-rule #11 the spec is the source of truth and is **not** edited here; the §9.4 "authorization_received" wording is read as the conceptual name for the `authorization → collateral_chase` transition, and this reconciliation is recorded (not silently resolved) so `writing-plans` and any future spec re-baseline inherit it.

### Why this agent is the right M12 — and why it stays sub-live

The Intake Agent's decisions are deterministic, so it could ship and be trusted with **no** design partner. The Servicer Outreach Agent is the opposite: its value is the _quality and timing of real correspondence with real servicers_, which cannot be validated against fixtures alone. M12 therefore mirrors the M10 blueprint precisely — orchestration-agnostic pure core, injected effects, deterministic legally-load-bearing logic, env-gated additive LLM surface, dormant durable seam, offline-scored eval — and **defers every step that requires live external traffic** (the live email send, the inbound-response classifier) to clearly-flagged carry-overs. The result is a fully-built, fully-tested agent that goes live by flipping adapters + a flag once a partner and `RESEND_API_KEY` exist, exactly as the Intake durable path goes live by provisioning a WDK backend.

M12 also is the **first** agent that genuinely needs WDK's durability: the cadence spans ~20 business days (an initial touch at T+0 plus follow-ups at T+5/10/15/20 — spec §9.4), so the durable wrap's `step.sleep(until)` is a real requirement here, not the rehearsal it was for the sub-second Intake flow (ADR 0013 Decision 2). M12 builds that wrap as a **dormant seam** (the ADR-0013 "Shape B" pattern) so the cadence logic is durability-ready without depending on a provisioned backend to merge.

---

## Decision — milestone shape

Connor selected scope **"M10 blueprint, 0 migrations"** and approved the full nine-section design below. The milestone ships the agent as small, signed, auto-merging PRs mirroring M10's cadence (scaffold + cadence core → channel seam → LLM drafter + fallback → orchestrator + app wiring → dormant WDK wrap → eval → close-out ADR), each ≤ ~400 LOC and individually green on the four required checks (**Lint, Typecheck, Unit tests, Build**).

**Milestone acceptance:**

- A Deal at `collateral_chase` whose prior servicer is identified and email-reachable produces a deterministic, scheduled cadence of outbound email touches (T+0/5/10/15/20 business days), each persisted as a `communications` row + an audit event, with PII-safe OTel spans.
- The cadence core is a **pure** function of injected touch-history → next action; it is storage-agnostic and durability-agnostic.
- The email body is **always sendable** — an LLM drafts it when `AI_GATEWAY_API_KEY` is configured, a deterministic template produces it otherwise.
- Unsupported channels (portal/fax/USPS) return an **explicit** `unsupported_channel` decision — never a silent no-op.
- **Zero new DB migrations** (reuses `communications` + `audit_events`; touch-history is derived from `communications`).
- A dormant `'use workflow'`/`'use step'` durable wrap exists (cadence waits = `step.sleep`), gated off like ADR 0013's.
- A Braintrust eval (≥20 fixtures) targets the email-drafting surface, with **offline compliance scorers as the real CI gate** and the live run skip-green without keys.
- CLAUDE.md updated; one close-out ADR (0014).

**The load-bearing design insight:** the cadence is modeled as a _pure evaluator over injected touch-history_ — `nextOutreachAction({ cadence, now, touchesSent, response })`. Because touch-history is an **input**, the same function works whether history comes from a `communications` query today or a WDK step-memo tomorrow; that is what makes "0 migrations / derive from `communications`" and "durability-ready" coherent at once, with no logic rewrite when the durable path goes live. This is the M12 analogue of M10's split-audit pre-paying for durability (ADR 0013 Decision 2).

---

## 1. Package & layout — `@cema/agents-servicer-outreach`

A new workspace package at `packages/agents/servicer-outreach/` (the 21st workspace package per CLAUDE.md's count — Intake was the 19th, `@cema/observability` the 20th). It carries **no app / DB / Clerk import** on its core path; every effect arrives through injected collaborators (`OutreachDeps`), exactly like `@cema/agents-intake`. It depends on the AI SDK (`ai`, `@ai-sdk/anthropic`) for the one additive drafting module, `@cema/observability` for `withChildSpan`, and `braintrust` (dev) for the eval.

App-layer wiring lives in `apps/web/lib/agents/servicer-outreach/` mirroring the intake layout:

- `deps.ts` — `buildOutreachDeps(...)`: wires the DB-touching collaborators (load context, record touch, emit audit) to Neon via `withRls`; **request-agnostic** (takes resolved internal UUIDs, never Clerk handles).
- `run-outreach-action.ts` — `runServicerOutreach(...)`: the `'use server'` shell that owns request context (Clerk identity resolution, adapter selection), then delegates to the core `runOutreach`.

The package public surface (`src/index.ts`) exports the types, the two pure cadence functions, the drafter, the orchestrator, and `FixtureChannelAdapter` + fixtures.

---

## 2. Deterministic cadence core (pure, no I/O)

Two pure functions, unit-tested without any DB, model, or clock dependency (the clock is injected as `now`):

### `planOutreachCadence(trigger): OutreachCadence`

Takes a `trigger` carrying the trigger date **and** the servicer's `acceptedSubmissionMethods`. It resolves the data-driven business-day offsets `[0, 5, 10, 15, 20]` (initial touch at T+0 plus follow-ups at T+5/10/15/20) from the trigger date into an ordered list of absolute `dueAt` timestamps, and resolves the **primary delivery `channel`** from the accepted methods (Phase 1: `email` if present, else the first unsupported method). Weekends are excluded (Saturday/Sunday skipped when counting business days). **NY bank holidays are a carry-over** — v1 counts Mon–Fri only and notes (in the cadence result + the close-out ADR) that holiday-aware scheduling is deferred until the NY business-day calendar is confirmed (it pairs naturally with the Connor-owned NY recording-tax-table item — both are "confirm the NY reference data" tasks). The offsets are a named constant (`OUTREACH_OFFSETS_BUSINESS_DAYS`) so the cadence is tunable without touching logic. The resulting `OutreachCadence` therefore carries both `dueAt[]` and the resolved `channel`.

### `nextOutreachAction({ cadence, now, touchesSent, response }): OutreachAction`

The decision function. Given the planned cadence (which carries the resolved `channel`), the current time, the count/record of touches already sent (the **input** that makes this storage-agnostic), and any classified servicer response, it returns a **discriminated union**:

| Action                                    | Meaning                                                                            |
| ----------------------------------------- | ---------------------------------------------------------------------------------- |
| `{ kind: 'send', touchNumber }`           | A scheduled touch is due now and hasn't been sent → send it.                       |
| `{ kind: 'wait', until }`                 | The next touch is in the future → caller sleeps until `until`.                     |
| `{ kind: 'stop', reason: 'responded' }`   | A terminal servicer response arrived → cadence ends.                               |
| `{ kind: 'stop', reason: 'exhausted' }`   | All planned touches sent, no response → cadence ends (escalation is a carry-over). |
| `{ kind: 'unsupported_channel', method }` | The servicer's accepted method isn't email → explicit non-send (see §3).           |

Modeling "no supported channel" and "exhausted" as **first-class returns** (not exceptions, not silent skips) is the no-silent-failure guardrail (CLAUDE.md spirit; mirrors ADR 0010's "accumulate every failed rule" explainability stance). Every branch is independently unit-testable.

---

## 3. Channel seam — `ServicerChannelAdapter`

A one-method seam mirroring `LosAdapter`:

```ts
interface ServicerChannelAdapter {
  send(packet: OutreachPacket): Promise<ChannelSendResult>;
}
```

- **`FixtureChannelAdapter`** — in-package, no network. Records the packet in memory and returns a synthetic success. This is the **dormant default** and the test/eval double. It adds **no external integration**, so M12 triggers no hard-rule-#12 obligation this milestone.
- **`ResendChannelAdapter`** — **deferred** to when `RESEND_API_KEY` is provisioned **and** a design partner exists. When it lands it must be added as `packages/integrations/resend/` with a spec §16 Integration Catalog row (hard-rule #12); Resend is already named in the spec §4 stack table, but no integration package exists yet. Swapping `new FixtureChannelAdapter()` → `new ResendChannelAdapter()` in the Server Action is a one-line change by design.

**Channel resolution** reads `servicer_cema_departments.acceptedSubmissionMethods` (a `submission_method[]`: `email | portal | fax_only | usps`). Phase 1 supports **`email`** only; `portal`/`fax_only`/`usps` resolve to the `unsupported_channel` action from §2 (surfaced to the processor for manual handling, never silently dropped). A servicer with **no** identified department, or a deal whose `existing_loans.currentServicerId` is null, is a precondition failure surfaced explicitly (the column is nullable — "servicer may not be identified at intake").

---

## 4. LLM surface — `draftOutreachEmail` (env-gated, with a deterministic fallback)

The agent's **only** model-using surface, and unlike the Intake narrative it is **load-bearing on the send path** — so it can never return `null`:

- **Configured** (`AI_GATEWAY_API_KEY` present) → drafts the touch's subject + body with **Sonnet 4.6 via the Vercel AI Gateway**, reusing ADR 0012's `createAnthropic({ baseURL: 'https://ai-gateway.vercel.sh/v1' })` pattern. (The `anthropic/claude-sonnet-4.6` Gateway slug confirmation is an existing Connor-owned carry-over.) The call is traced (`outreach.draft_email`) with **PII-safe attributes only** (model id, touch number, a boolean `usedLlm` — **never** the servicer rep's name, the email body, the deal's borrower/address, or any dollar figure; hard-rule #3 / §10.3).
- **Unconfigured** → a **deterministic template** produces a complete, professional, sendable email from the structured department + deal-reference fields. This guarantees the cadence functions fully with the model off (CI, most dev loops), and makes the LLM a _quality_ enhancement, not a _correctness_ dependency.

The prompt builder is a pure string function (mirroring `buildSavingsNarrativePrompt`) and injects only non-PII structured fields + a stable deal reference. **Inbound-response classification is deferred** (spec §9.4 step 7): M12 defines the `ServicerResponse` type (`delivered | rejected | needs_info | other`) and a **dormant** `classifyServicerResponse` seam (Opus 4.7 per §9.4) so `nextOutreachAction` already accepts a `response`, but no live classifier ships — it needs real inbound servicer email to validate.

**Error posture (mirrors ADR 0010 Decision 4):** the template path never throws; a _configured_ Gateway call that fails throws (so the app boundary can record it to Sentry rather than silently shipping a worse email) — but because the template is always available, the orchestrator may choose best-effort (fall back to template on a configured failure). That best-effort-vs-surface choice is a `writing-plans` decision, flagged here.

---

## 5. Orchestrator — `runOutreach(dealId, deps)`

Mirrors `runIntake`: a flat chain of awaited, individually-testable boundaries under one OTel parent span, each boundary wrapped in `withChildSpan(tracer, ...)` from `@cema/observability` (`const tracer = trace.getTracer('@cema/agents-servicer-outreach')`).

Shape:

1. `outreach.load_context` — load the deal (assert `status === 'collateral_chase'`), resolve servicer + CEMA department, and **derive `touchesSent` from prior outbound servicer `communications`** (see §7).
2. `planOutreachCadence` + `nextOutreachAction` (pure, inline — no I/O, recorded as parent-span attributes). The orchestrator derives the **cadence anchor** (T+0) from touch-history — the earliest recorded touch's timestamp, or `now()` on the very first run — and passes it as the trigger date, so re-evaluation on a later run reproduces the same `dueAt[]` instead of drifting forward each invocation. This stable anchor is what lets the durable workflow resume and recompute the schedule identically.
3. On a `send` action: `outreach.draft_email` (§4) → `outreach.send_touch` (calls `channel.send`, then persists the `communications` row + `outreach.touch_sent` audit event **atomically**).

**Split audit (mirrors ADR 0010 Decision 3):** `outreach.planned` is emitted for **every** run _before_ any send (so the decision is durable even when the action is `wait`/`stop`/`unsupported_channel` and nothing is sent); `outreach.touch_sent` is written **co-transactionally** with the `communications` insert it describes (all-or-nothing). Append-only audit invariant honored at both ends (§10.5).

`OutreachDeps` (the injected seam): `{ channel: ServicerChannelAdapter; loadContext(dealId) → OutreachContext; recordTouch(...) → Promise<void>; emitAudit(event) → Promise<void>; now: () => Date }`. The core imports nothing from app/DB/Clerk/WDK — `now` is injected so cadence math is deterministic in tests.

---

## 6. Dormant WDK durable wrap (ADR 0013 "Shape B")

The cadence is multi-week, so durability is a genuine fit here. Built as a **dormant seam** exactly like ADR 0013:

- `outreach.workflow.ts` — a `'use workflow'` orchestrator over **serializable strings** (`dealId`, `organizationId`, `actorUserId`), importing only step references + a type-only result. The cadence `wait` actions become **`step.sleep(until)`** — the durable runtime sleeps across days/weeks and resumes, which is the whole point.
- `outreach.steps.ts` — `'use step'` boundaries (load-context / draft+send-touch) that **rebuild deps internally** via `buildOutreachDeps(...)`, since `OutreachDeps` (functions + adapter instance) isn't serializable across the durable boundary.
- `run-outreach-durable-action.ts` — a **dormant** `runServicerOutreachDurable` (`start()` + `run.returnValue`), wired by no UI, gated off.

The authoritative behavioral guard is the **mocked-step orchestration unit test** (per ADR 0013 Decision 6); the `@workflow/vitest` in-process durable proof is **excluded from required CI and gated off** (ADR 0013 carry-over #5 — the builder externalizes our raw-TS `@cema/*` packages, which Node's ESM loader rejects on extensionless re-exports; unchanged here). Activation (provision WDK backend + `VERCEL_OIDC_TOKEN`, exclude `/.well-known/workflow/*` from the `proxy.ts` matcher, flip the flag) is a Connor-owned carry-over.

---

## 7. Persistence — zero new migrations

Reuses existing tables:

- **Sends → `communications` rows.** Each touch: `kind = 'email'`, `direction = 'outbound'`, `medium = 'other'` (the email is Resend-originated, not a Gmail/M365 inbox-sync row), `dealId` set, `sourceThreadId` = a stable per-deal outreach thread id (groups the cadence). **Touch idempotency for free:** set `vendorEventId = 'outreach:<dealId>:touch:<n>'` (a deterministic key) to reuse the existing `communications_vendor_event_id_uidx` UNIQUE index — a replayed step or double-fire can't double-insert touch _n_. This is the DB-level idempotency guarantee ADR 0013 Decision 3 wanted, obtained here with **no migration**.
- **Decisions → `audit_events`** (`outreach.planned`, `outreach.touch_sent`), append-only (§10.5).
- **Touch-history derivation:** `loadContext` queries outbound servicer `communications` for the deal (ordered) and feeds the count/records into `nextOutreachAction`. No separate attempts table.

**Status-enum wrinkle (carry-over, surfaced honestly):** `communication_status` is telephony-flavored (`pending | ingested | transcribing | ready | failed`) with no `sent`/`delivered`/`bounced` states. M12 writes outbound email rows as `status = 'pending'` (the schema default) and treats the row's existence as "touch attempted." True email-delivery lifecycle states (and any bounce handling) are deferred together with the live `ResendChannelAdapter` — at which point either the enum gains email states (a migration) or a dedicated `servicer_outreach_attempts` table is introduced if volume/telemetry justifies it (§9). v1 deliberately does **not** migrate, keeping the zero-migration acceptance criterion.

---

## 8. Testing & eval

- **Unit tests (required `Unit tests` job):**
  - `planOutreachCadence` — business-day math edges: trigger on a Friday, over a weekend, offset landing on Sat/Sun, ordering, offset-constant changes.
  - `nextOutreachAction` — every union branch: due-now `send`, future `wait`, `stop`(responded), `stop`(exhausted), `unsupported_channel`; boundary at exactly `dueAt`; idempotent re-evaluation after a touch is recorded.
  - `runOutreach` with mocked deps — boundary **sequence**, the **split-audit** ordering (`outreach.planned` before any send; `outreach.touch_sent` co-transactional), and behavior-preserving result.
  - **Trace allowlist** test — the PII-safe span-attribute guard (mirrors `orchestrator.trace.test.ts`): assert no rep name / body / address / dollar figure ever reaches a span.
  - **Template fallback** — with the model off, `draftOutreachEmail` returns a complete, sendable subject+body.
  - Orchestration unit test for the dormant workflow (mocked steps), per ADR 0013.
- **Braintrust eval (≥20 fixtures, spec §8 / §11):** targets the **email-drafting** surface. **Offline pure compliance scorers are the real CI gate** (mirrors ADR 0010 Decision 8), verified by a `scorers.test.ts` in the required job, with the live run skip-green unless **both** `BRAINTRUST_API_KEY` and `AI_GATEWAY_API_KEY` are present. Scorer intent:
  - **no legal-advice language** (B2B servicer correspondence is not legal advice — UPL guardrail, §10.1);
  - **contains the deal reference / required identifying fields** (the servicer can act on it);
  - **no PII leak** (no SSN/DOB/full borrower name+address/account/payoff figures in the body — §10.3);
  - **professional B2B tone** (no borrower-style or consumer language);
  - **template fallback also scored** (the deterministic email must pass the same compliance bar as the LLM one).

---

## 9. Carry-overs (deferred, flagged)

1. **Live email send** — implement `ResendChannelAdapter` (+ `packages/integrations/resend/` + spec §16 row, hard-rule #12); needs `RESEND_API_KEY` + a design partner. One-line adapter swap by design.
2. **Inbound-response classification** — the dormant `classifyServicerResponse` (Opus 4.7, §9.4 step 7) goes live; needs real inbound servicer email to validate. `ServicerResponse` type + the `nextOutreachAction` `response` input already exist.
3. **NY bank-holiday calendar** — make `planOutreachCadence` holiday-aware (pairs with the Connor-owned NY recording-tax-table confirmation — both are "confirm NY reference data").
4. **Non-email channels** — portal (Sandboxed browser automation, §9.4), `fax_only`, `usps`; today each returns `unsupported_channel`.
5. **Flip the durable path live** — provision WDK backend + `VERCEL_OIDC_TOKEN`, exclude `/.well-known/workflow/*` from the `proxy.ts` matcher, flip the flag (shared with the Intake durable carry-over; Connor-owned).
6. **`communications` email-delivery states** — add `sent`/`delivered`/`bounced` (a migration) or a dedicated `servicer_outreach_attempts` table if volume/telemetry justifies it (§7 wrinkle).
7. **Escalation on `exhausted`** — when all touches are sent with no response, escalate via `servicer_cema_departments.escalationPath` (the data already models it); v1 just `stop`s.
8. **Per-servicer playbook content package — the moat (spec §5).** M12 reads the _structured_ department fields (`acceptedSubmissionMethods`, `typicalSlaBusinessDays`, `escalationPath`, `commonRejectionReasons`); a rich per-servicer playbook _content_ layer (tone, known quirks, document checklists) that the drafter adapts to is a later, higher-value slice (no `packages/playbooks/` exists yet).
9. **LO/processor notification on cadence events** (Slack/Teams clients exist from M4) — deferred, as in M10.
10. **All M2–M11 carry-overs still pending** — especially the **design partner (overdue, on the critical path** for validating this agent end-to-end), env-var provisioning (`AI_GATEWAY_API_KEY`, `BRAINTRUST_API_KEY`, `RESEND_API_KEY`), and the real LOS/Encompass adapter.

---

## Cross-cutting

- **Env vars (Connor-provisioned, non-blocking to merge):** the drafter exercises `AI_GATEWAY_API_KEY` live; the eval needs it + `BRAINTRUST_API_KEY`; live sending needs `RESEND_API_KEY`. All gate cleanly — M12 is validated by tests, not a live backend, exactly like M10/M11.
- **Migrations:** **zero** (idempotency via the existing `vendorEventId` unique index; touch-history derived from `communications`).
- **ADR:** **ADR 0014** (Servicer Outreach Agent) at close-out.
- **Compliance:** no attorney-review-gated documents are produced (servicer correspondence is not in the `attorney_review_required` document set, §10.1 / hard-rule #2); PII discipline enforced by the trace allowlist + eval no-PII scorer; audit append-only (§10.5).

---

## Open questions for `writing-plans`

1. **Best-effort vs. surface on a configured drafter failure (§4):** when `AI_GATEWAY_API_KEY` is set but the Gateway call throws, does the orchestrator fall back to the deterministic template (best-effort, since the template is always valid) or surface the error to the processor (loud, à la ADR 0010 Decision 4)? The template's existence makes best-effort defensible here in a way it wasn't for Intake.
2. **Stable `sourceThreadId` derivation:** the exact deterministic scheme for the per-deal outreach thread id (and how it interplays with `vendorEventId = outreach:<dealId>:touch:<n>` idempotency) — confirm against how M3/M8 used `sourceThreadId`.
3. **`loadContext` query shape:** one query vs. a small set (deal + existing*loans→servicer + department + prior outbound comms); confirm the RLS-scoped read path and whether to read the servicer via the \_oldest* chain-position existing-loan or all of them.
4. **WDK execution-model reuse:** confirm `step.sleep(until)` semantics + the synchronous-trigger contingency carry over unchanged from ADR 0013 (resolve via the `vercel:workflow` skill before sizing PR-B).
5. **Eval fixtures source (mirror ADR 0010 Decision 6):** derive drafting fixtures from real `servicer_cema_departments` + deal-reference shapes (not hand-written prose) so the eval grades the drafter against the structured inputs the system actually produces.

---

## Alternatives considered

- **Add a `servicer_outreach_attempts` table now (1 migration):** rejected for v1 — `communications` already models an outbound email touch, and deriving touch-history from it keeps the zero-migration criterion and avoids a parallel source of truth. Revisit only if delivery-state telemetry or volume demands it (§7 / carry-over #6).
- **Live `ResendChannelAdapter` in M12:** rejected — sending real servicer email with no design partner and no `RESEND_API_KEY` validates nothing and risks contacting real servicers from a half-built agent. The fixture adapter + offline eval prove the build; live send flips on later (carry-over #1).
- **Inbound-response classification in M12:** rejected — needs real inbound servicer email to validate the Opus classifier; the dormant seam + `ServicerResponse` type keep `nextOutreachAction` ready without shipping an unvalidated model surface (carry-over #2).
- **Skip the durable wrap (synchronous cadence via cron):** rejected — the multi-week cadence is the canonical WDK `step.sleep` use case and ADR 0013 already established the dormant-seam pattern; building it now (gated off) avoids a later rewrite of the cadence into a workflow.
- **Build the real LOS/Encompass adapter (ADR 0010 #5) instead:** a valid alternative M12, but it's plumbing that doesn't move the headline cycle-time metric; the Outreach Agent directly attacks spec goal #2, and the LOS adapter can land alongside the live-send slice when a partner exists.
