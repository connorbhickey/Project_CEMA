# ADR 0013: WDK durable wrap of the Intake Agent (`runIntake`)

**Status:** Accepted (shipped 2026-05-29)
**Author:** M11 PR-B (Claude Opus 4.8 + Connor Hickey)
**Supersedes:** None
**Superseded by:** None
**Relates to:** ADR 0010 carry-over #3 (WDK wrap); ADR 0011 (OTel tracing); M11 design doc Decision 1-4

---

## Context

ADR 0010 built the Intake Agent's `runIntake` as an orchestration-agnostic flat
await chain, deliberately shaped so each awaited boundary maps 1:1 onto a future
WDK `step.run(...)`. The WDK wrap was deferred (`@vercel/workflow` was not
installed). This ADR records actually wrapping the flow as a durable workflow so
the agent's I/O is crash-resilient and replay-idempotent across the long CEMA
lifecycle (spec: 75-day deals).

---

## Decision

### 1. "Shape B" — a workflow over serializable strings, not an injected step runner

The M11 design doc's Decision 1 imagined injecting a `step.run` runner through
`IntakeDeps` so `runIntake` itself became durable. WDK has **no injectable step
runner**, and `IntakeDeps` (functions + a `FixtureLosAdapter` instance) is **not
serializable** across the durable boundary (WDK's codec supports plain
objects/arrays/Date/Map/Set/etc. — not functions, class instances, or Symbols).
So the flow is re-expressed in the app layer:

- `intake.workflow.ts` — one `'use workflow'` fn taking three **serializable
  strings** (`externalId`, `organizationId`, `actorUserId`).
- `intake.steps.ts` — three `'use step'` boundaries (`fetchAndEvaluateStep`,
  `emitEvaluatedStep`, `createDealStep`). Each **rebuilds `IntakeDeps` internally**
  via `buildIntakeDeps(...)` and runs the pure logic (`checkEligibility`,
  `estimateSavings`) — all in full Node.

The package-level `runIntake` is **unchanged** (still used by the live, traced
`runIntakeFromLos`). The durable path duplicates its orchestration shape;
behavior is identical (same sequence, same audit-split, same ineligible
short-circuit). This divergence from Decision 1 is deliberate and is the only
shape WDK's execution model allows.

### 2. Sandbox cleanliness — the workflow imports only steps + a type

A `'use workflow'` fn runs in a VM with no Node.js. The `@cema/agents-intake`
barrel pulls the AI SDK (via `narrative.ts`), so the workflow imports **only** the
step references and a **type-only** `IntakeResult` (erased at compile time). All
Node-touching code lives in the steps. This is the docs-canonical "workflow =
orchestration only; logic in steps" shape.

### 3. Synchronous Server Action contract preserved via `run.returnValue`

`start(intakeWorkflow, [...])` returns a run handle immediately; the new
`'use server'` action `runIntakeFromLosDurable` awaits **`run.returnValue`** to
resolve the same `Promise<IntakeResult>` callers expect. The action **duplicates**
the Clerk org/user resolution from `run-intake-action.ts` rather than refactoring
it — the ADR-0011-traced live action must not be regressed, and a shared
extraction is out of scope.

### 4. Dormant action; OTel-in-steps deferred

No UI wires `runIntakeFromLosDurable` in this PR — it is the durable **seam**,
ready to swap behind a flag once a WDK backend + `VERCEL_OIDC_TOKEN` are
provisioned (Connor-owned runtime). Because the durable path doesn't touch
`@opentelemetry/api`, the ADR-0011 spans on `runIntakeFromLos` are untouched.
Tracing the durable steps (span-per-step) is a carry-over, folding into the
model-call-tracing work alongside the AI-Gateway slice.

**Activation prerequisite (`proxy.ts`):** the runtime serves its internal
endpoints under `/.well-known/workflow/*` (e.g. `POST
/.well-known/workflow/v1/flow`). Our `proxy.ts` matcher is a broad negative
lookahead that would run Clerk auth on those internal calls and corrupt the
request body (detached `ArrayBuffer`). Activation must therefore **exclude
`/.well-known/workflow/*`** from the proxy matcher. Left untouched in this PR
because the action is dormant — recorded here so activation doesn't rediscover it.

### 5. Replay idempotency for free; cross-run dedup out of scope

WDK persists step results, so a crash-and-resume **replays** completed steps from
cache — `createDealStep` won't double-insert on resume. This satisfies design-doc
Decision 3 with **zero new migrations**. Cross-_run_ dedup (two `start()` calls
for one `externalId`) is unchanged from `runIntake` today and out of scope (would
need a DB uniqueness constraint = a migration).

### 6. Testing — two tiers, neither requiring a backend in CI

- **Orchestration unit test** (`intake.workflow.test.ts`, default config,
  `vi.mock`'d steps): the behavioral guard for the sequence/short-circuit/
  audit-split. No DB, no backend. **This is required-CI green** and is the
  authoritative behavioral guard for the durable shape.
- **Durable integration test** (`tests/workflow/intake-durable.test.ts`,
  `@workflow/vitest`, in-process): the executable spec for the real
  `start()`→`run.returnValue` proof. It is **excluded from required CI** (lives
  under `tests/workflow/**`) and is currently **gated off by default** (carry-over
  #5) — see below. `vi.mock` does not work under the plugin (esbuild bundles step
  deps), which is why orchestration assertions live in the unit test.

### 7. Package name reconciled to `workflow`

The flow uses the `workflow` package (`workflow`, `workflow/api`, `workflow/next`)
plus `@workflow/vitest`, per the installed Vercel plugin docs. CLAUDE.md §4 + the
M11 design doc had said `@vercel/workflow`; §4 is corrected to the confirmed name.

---

## What shipped

| File                                                      | Change                                                                     |
| --------------------------------------------------------- | -------------------------------------------------------------------------- |
| `apps/web/lib/agents/intake/intake.steps.ts`              | **New.** 3 `'use step'` boundaries; deps rebuilt internally; PII-safe logs |
| `apps/web/lib/agents/intake/intake.steps.test.ts`         | **New.** `fetchAndEvaluateStep` unit test (fixture data, no DB)            |
| `apps/web/lib/agents/intake/intake.workflow.ts`           | **New.** `'use workflow'` orchestrator; imports only steps + type          |
| `apps/web/lib/agents/intake/intake.workflow.test.ts`      | **New.** Orchestration unit test (mocked steps) — the behavioral guard     |
| `apps/web/lib/agents/intake/run-intake-durable-action.ts` | **New.** Dormant `'use server'` action: `start()` + `run.returnValue`      |
| `apps/web/tests/workflow/intake-durable.test.ts`          | **New.** `@workflow/vitest` durable proof (gated off — carry-over #5)      |
| `apps/web/vitest.integration.config.ts`                   | **New.** Separate config w/ `workflow()` plugin                            |
| `apps/web/vitest.config.ts`                               | `exclude` += `tests/workflow/**`                                           |
| `apps/web/next.config.ts`                                 | wrapped in `withWorkflow(...)`                                             |
| `apps/web/package.json`                                   | `+ workflow`, `+ @workflow/vitest` (dev), `+ test:workflow`                |
| `.gitignore`                                              | `+ .workflow-data/`, `+ .workflow-vitest/` (generated artifacts)           |

No new DB migrations.

---

## Consequences

**Positive**

- The Intake flow is now durable: crash-resilient + replay-idempotent across
  long-lived deals, with no double-write on resume.
- Required CI stays green with no secrets and no WDK backend (the behavioral guard
  is the mocked-step orchestration unit test).
- The durable seam is ready to go live behind a flag once a backend + OIDC are
  provisioned.

**Negative / tradeoffs**

- Orchestration is duplicated between `runIntake` (package) and `intakeWorkflow`
  (app) — two shapes to keep in sync until one is retired. Mitigated: both
  delegate to the same pure functions + `buildIntakeDeps`.
- The durable action is dormant (unverified against a real backend) until Connor
  provisions one.
- `@workflow/vitest` esbuild-bundles step deps, so `vi.mock` is unavailable there
  — orchestration assertions are forced into the (good) unit test; the integration
  test is outcome-only.
- The in-process durable integration test cannot run under the current toolchain
  (carry-over #5) — the live `start()`→`run.returnValue` path is unverified
  locally until either the package ships a build or the WDK builder bundles
  workspace TS-source.

---

## Carry-overs

1. **Provision a WDK backend + `VERCEL_OIDC_TOKEN`** (Connor) — then flip a flag to
   route `runIntakeFromLos` → `runIntakeFromLosDurable`, exclude
   `/.well-known/workflow/*` from the `proxy.ts` matcher (Decision 4), and verify
   in a preview deploy.
2. **Trace the durable steps** — span-per-step inside the durable execution; folds
   into the model-call-tracing / AI-Gateway observability work.
3. **Cross-run dedup** — if business rules require it, add a DB uniqueness
   constraint on `(organization_id, external_id)` for intake deals (a migration).
4. **Retire the duplication** — once the durable path is live and trusted, decide
   whether `runIntake` or `intakeWorkflow` is the single source and collapse the
   other.
5. **Run the durable integration test** (`tests/workflow/intake-durable.test.ts`).
   It is gated off by default (needs both `DATABASE_URL` and `RUN_WDK_INTEGRATION`)
   because the `@workflow/vitest` builder externalizes workspace packages, but our
   `@cema/*` packages are published as raw TS source (no `dist/` — consumed
   everywhere via Turbopack `transpilePackages`). The in-process Local World then
   loads the step bundle through Node's raw ESM loader, which rejects
   `@cema/agents-intake`'s extensionless re-exports (`ERR_MODULE_NOT_FOUND` for
   `./types`). Production is unaffected — `withWorkflow` compiles steps via
   Turbopack, which honors `transpilePackages`. Resolution paths, either: (a)
   `@cema/agents-intake` ships a built `dist/` (and the steps import the built
   entry); or (b) the WDK builder / `@workflow/vitest` exposes a force-bundle
   (`noExternal`) knob for workspace packages — the lower-level
   `@workflow/builders` config has `externalPackages`, but `WorkflowTestOptions`
   does not surface it (verified against `@workflow/vitest@4.0.6`). Do **not**
   "fix" it by adding `@cema/*` to a sandbox/externalization list without
   understanding the cause. The mocked-step orchestration unit test remains the
   authoritative behavioral guard meanwhile.
