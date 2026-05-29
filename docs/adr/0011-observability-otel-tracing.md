# ADR 0011: Observability — OpenTelemetry tracing (first instrumented agent)

**Status:** Accepted (shipped 2026-05-29)
**Author:** OTel tracing slice (Claude Opus 4.8 + Connor Hickey)
**Supersedes:** None
**Superseded by:** None
**Relates to:** ADR 0010 carry-over #1 (OTel traces on the Intake Agent)

---

## Context

CLAUDE.md §8 ("Writing an agent") mandates that **every agent emits OpenTelemetry traces**. M10 shipped the Intake Agent (ADR 0010) without them — the single largest of its nine carry-overs (#1). This slice pays it down for the Intake Agent and, because the repo had **zero OpenTelemetry anywhere** (a `grep` for `@opentelemetry` returned nothing, and there is no `@cema/observability` package despite CLAUDE.md §6 envisioning one), it also stands up the tracing layer that every later agent will reuse.

The decisions below are therefore broader than one agent: they set the pattern for how this monorepo does tracing. They were made inline during implementation; this ADR records them.

---

## Decision

### 1. Libraries instrument against `@opentelemetry/api`; the app registers the SDK

Packages (`@cema/agents-intake`) import **only `@opentelemetry/api`** and create spans through `trace.getTracer(...)`. The API is a **no-op until a provider is registered** — so importing it in the orchestration-agnostic core (or in unit tests) adds no behaviour and does not violate ADR 0010's "no app/DB/Clerk/LLM on the deterministic path" posture. The _SDK_ never enters a package.

The **app** registers the SDK exactly once, in `apps/web/instrumentation.ts`, via `@vercel/otel`'s `registerOTel({ serviceName: 'cema-web' })`. This is the standard OpenTelemetry library/app split: libraries depend on the stable API; the composition root owns the SDK. Registration is what turns the package's no-op spans into real, exported spans.

`@vercel/otel` (not a hand-rolled `NodeTracerProvider`) auto-configures the OTLP exporter to Vercel Observability in production and a context manager for span nesting. With **no OTLP endpoint** configured (local dev, CI, tests) it is effectively a no-op, so tracing adds no latency or behaviour outside a traced deployment.

### 2. No `@cema/observability` package yet — direct API use for one consumer

CLAUDE.md §6 lists a planned `packages/observability/` wrapper. We did **not** create it. With a single instrumented package, a wrapper would be premature abstraction over a one-line `trace.getTracer()` call. **Extraction trigger:** the moment a _second_ package needs instrumentation (the next agent), lift the shared helper (e.g. `withChildSpan`, the PII-safe attribute conventions) into `@cema/observability` then — with two real consumers to shape its surface.

### 3. Span topology mirrors the future WDK step boundaries

`runIntake` opens a parent **`intake.run`** span with one child span per **awaited I/O boundary**:

- `intake.fetch_application` (LOS adapter)
- `intake.emit_audit` (the `intake.evaluated` write)
- `intake.create_deal` (only on the eligible path)

These are exactly the three points that become `step.run(...)` when the orchestrator is wrapped in the Vercel Workflow DevKit (ADR 0010 carry-over #3) — so the WDK wrap stays a mechanical transform, not a redesign. The **deterministic pure steps** (`checkEligibility`, `estimateSavings`) run inline and surface as **parent-span attributes**, not their own spans: they have no I/O and no failure mode worth its own trace node.

The Server Action `runIntakeFromLos` opens its own parent **`intake.run_from_los`** span (Clerk identity resolution → eligibility → audit → deal creation in one trace); `runIntake`'s spans nest beneath it via context propagation.

### 4. Span attributes are PII-safe by allowlist (hard rule #3 / CLAUDE.md §10.3)

Spans are logs, so the same PII prohibition applies. Spans carry **only** non-PII signal: ids, classifications, and rule codes — `external_id`, `cema_type`, `state`, `county`, `property_type`, `loan_program`, `lien_position`, `eligible`, `reasons`, `is_placeholder_rate`, `deal_id`. They **never** carry dollar figures (existing UPB, new loan amount, assigned UPB, applied rate, tax saved, fees, net savings). Note `is_placeholder_rate` is a boolean _flag_ — the placeholder signal, never the rate value.

A dedicated trace test (`orchestrator.trace.test.ts`) enforces this with an **allowlist**: every attribute key emitted on every span must be in the vetted set, so a future edit that attaches an un-reviewed attribute fails the suite. A substring denylist of the exact dollar-field names backs it up as executable documentation.

---

## What shipped

| File                                                    | Change                                                                                                                                  |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/instrumentation.ts`                           | **New.** Next 16 instrumentation hook; `register()` → `registerOTel({ serviceName: 'cema-web' })` (the one place the SDK is wired)      |
| `packages/agents/intake/src/orchestrator.ts`            | `runIntake` wrapped in the `intake.run` parent span + a `withChildSpan` helper around the three awaited boundaries; PII-safe attributes |
| `apps/web/lib/agents/intake/run-intake-action.ts`       | The `'use server'` shell wrapped in an `intake.run_from_los` span (external_id, eligible, deal_created, deal_id; OK/ERROR status)       |
| `packages/agents/intake/src/orchestrator.trace.test.ts` | **New.** 6 tests: span tree (eligible/ineligible), parent-child nesting, ERROR-status propagation, and the PII attribute-key guard      |
| `apps/web/package.json`                                 | `+ @vercel/otel`, `+ @opentelemetry/api`                                                                                                |
| `packages/agents/intake/package.json`                   | `+ @opentelemetry/api` (dep); `+ @opentelemetry/sdk-trace-base`, `+ @opentelemetry/context-async-hooks` (devDeps — test-only)           |

No new DB migrations. Intake package: **82 tests** (76 prior + 6 trace). Next.js build compiles `instrumentation.ts` + `@vercel/otel` cleanly.

---

## Consequences

**Positive**

- CLAUDE.md §8's tracing mandate is satisfied for the Intake Agent; the layer exists for the next agent at the cost of a `trace.getTracer()` call.
- The api/SDK split keeps the agent core orchestration-agnostic (ADR 0010) — the no-op API means tests and other consumers stay behaviour-free.
- Span boundaries are pre-aligned to the future WDK steps.
- The PII guard is enforced by test, not convention.

**Negative / tradeoffs**

- Tracing is **inert until an OTLP endpoint is configured** in the Vercel deployment — local/CI runs export nothing, so the spans are validated by the in-memory trace test, not by a live backend (acceptable: the test asserts shape + the PII contract, which is what we most need to guarantee).
- A second instrumented package will carry duplicated tracer/attribute boilerplate until `@cema/observability` is extracted (deliberate — see Decision 2).
- The Intake Agent's other model surface (`draftSavingsNarrative`) and the `@cema/search` classifier are **not yet traced** — they call the provider directly today (ADR 0010 carry-over #2); tracing them folds into the AI-Gateway adoption slice.

---

## Alternatives considered

- **Create `@cema/observability` now.** Rejected as premature abstraction over one consumer (Decision 2); the wrapper's surface is better shaped by two real call sites.
- **Hand-roll `NodeTracerProvider` in `instrumentation.ts`.** Rejected: `@vercel/otel` is the supported path on this stack (CLAUDE.md §4), auto-wires the OTLP exporter + context manager, and is a no-op off-platform — less code, fewer ways to misconfigure.
- **A span per pipeline step (including the pure ones).** Rejected: the deterministic steps have no I/O; modelling them as parent attributes keeps the trace readable and the span count equal to the durability boundaries.

---

## Carry-overs

1. **AI-Gateway adoption slice** (ADR 0010 #2): route `draftSavingsNarrative` + the `@cema/search` classifier through the Gateway and trace those model calls.
2. **WDK wrap** (ADR 0010 #3): each `withChildSpan` boundary becomes a `step.run(...)`; confirm the spans still nest under the workflow's trace.
3. **Extract `@cema/observability`** when the second agent is instrumented (Decision 2 trigger).
4. **Wire a real OTLP endpoint** in the Vercel deployment so the spans land in Vercel Observability (and confirm PII-safe attributes end-to-end against a live backend).
5. **Sentry** (CLAUDE.md §4) is still unwired; the catch blocks `recordException` to the span but do not yet report to Sentry — fold in with carry-over #7 from ADR 0010 (best-effort narrative error reporting).
