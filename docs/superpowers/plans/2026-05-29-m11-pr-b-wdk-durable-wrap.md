# M11 PR-B: WDK Durable Wrap of `runIntake` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wrap the Intake Agent's `runIntake` flow in a Vercel Workflow DevKit (WDK) durable workflow — three `'use step'` boundaries orchestrated by one `'use workflow'` function, reached through a new dormant Server Action — so the agent's 75-day-lifecycle-bound I/O becomes crash-resilient and replay-idempotent, while every required CI check stays green with no env vars and no WDK backend.

**Architecture:** WDK's execution model makes the design doc's original "inject `step.run` via `IntakeDeps`" infeasible — there is no injectable step runner, and `IntakeDeps` (functions + a class instance) is not serializable across the durable boundary. So PR-B re-expresses the flow as **Shape B**: a workflow function that takes only **serializable strings** (`externalId`, `organizationId`, `actorUserId`) and calls three step functions. The pure logic (`checkEligibility`, `estimateSavings`) and all effectful collaborators (`buildIntakeDeps` → real `withRls` writes) live **inside the steps** (full Node.js), so the workflow body imports **only** the step functions plus a type-only `IntakeResult` — zero runtime imports into the sandboxed workflow VM. A new `'use server'` action (`runIntakeFromLosDurable`) calls `start(intakeWorkflow, [...])` and awaits `run.returnValue`, preserving the synchronous Server Action contract. The action is **dormant** (no UI caller in this PR); the existing ADR-0011-traced `runIntakeFromLos` stays the live path, untouched.

**Tech Stack:** TypeScript (strict), Vercel Workflow DevKit (`workflow` + `workflow/api` + `workflow/next`), `@workflow/vitest` (in-process integration testing), Next.js 16, Drizzle + Neon, Vitest, pnpm workspaces + Turborepo.

---

## Background & Constraints (read before starting — this is what makes the plan correct)

### B1. The package name is `workflow` (verify at install; `@vercel/workflow` is the fallback)

The installed `vercel` plugin's `workflow/SKILL.md` is authoritative: the package is **`workflow`** with subpaths `workflow/api`, `workflow/next`, `workflow/vite`, `workflow/astro`, plus scoped companions `@workflow/vitest`, `@workflow/ai`, `@workflow/next`, `@workflow/core`. **However**, CLAUDE.md §4 and the M11 design doc both say `@vercel/workflow`, and the plugin's validate rule references `@vercel/workflow` for a legacy `createWorkflow` API. **Task 1 resolves this empirically:** install `workflow`, then confirm `node_modules/workflow/package.json` and `node_modules/workflow/docs/` resolve. If `pnpm add workflow` 404s, fall back to `@vercel/workflow` and adjust every `from 'workflow...'` import accordingly. Do not proceed past Task 1 until the package name is confirmed and the bundled docs are readable — Task 6 reconciles CLAUDE.md §4 to whatever name wins.

### B2. Serialization rule → pass strings, not `IntakeDeps`

WDK serializes step args/returns with a structured-clone-like codec. **Supported:** string, number, boolean, null, undefined, bigint, plain objects, arrays, `Date`, `RegExp`, `URL`, `Map`, `Set`, `Headers`, typed arrays, streams. **NOT supported:** functions, class instances, Symbols, `WeakMap`/`WeakSet`. `IntakeDeps` is `{ adapter: LosAdapter (a FixtureLosAdapter instance); createDeal: fn; emitAudit: fn; rates?: ... }` — functions + a class instance — so it **cannot cross the boundary**. The workflow therefore passes the three id strings, and each step **rebuilds its own deps internally** via `buildIntakeDeps({ organizationId, actorUserId, adapter: new FixtureLosAdapter() })`. `NormalizedApplication` and `SavingsEstimate` ARE plain objects, so they serialize fine between steps.

### B3. Sandbox limit → the workflow imports only steps + a type

A `'use workflow'` function runs in a sandboxed VM with **no Node.js** (no `fetch` from global, no `setTimeout`, no Node modules). The `@cema/agents-intake` **barrel** (`index.ts`) re-exports `draftSavingsNarrative`/`isLlmConfigured`, which import the AI SDK — pulling that into the sandbox bundle would break it. **Shape B avoids this entirely:** the workflow file imports `{ createDealStep, emitEvaluatedStep, fetchAndEvaluateStep } from './intake.steps'` (step references — durable boundaries, not inlined) and `import type { IntakeResult } from '@cema/agents-intake'` (erased at compile time → zero runtime import). All Node-touching code (`FixtureLosAdapter`, `checkEligibility`, `estimateSavings`, `buildIntakeDeps`, `withRls`, `@cema/db`) lives in the **steps**, which have full Node.

### B4. Realized "Shape B" diverges from the design doc's Decision 1 — on purpose

The M11 design doc (`docs/superpowers/plans/2026-05-29-phase-1-month-11-platform-debt-design.md`) Decision 1 imagined injecting a `step.run(...)` runner through `IntakeDeps` so `runIntake` itself became durable. WDK has no such injectable runner, and `IntakeDeps` isn't serializable (B2), so that is infeasible. Shape B instead **duplicates the orchestration shape** in `intake.workflow.ts` (an app-layer file) while leaving the package-level `runIntake` untouched. Behavior is identical (same sequence, same audit-split, same eligibility short-circuit). ADR 0013 records this divergence; it is not a silent deviation.

### B5. Synchronous Server Action contract → `await run.returnValue`

`start(workflowFn, [args])` returns a run handle immediately (fire-and-forget durability). To honor the existing `Promise<IntakeResult>` Server Action contract, the action awaits **`run.returnValue`**, which resolves with the workflow's return value once it completes. "Do not call workflow functions directly — use `start()`." (Verify `run.returnValue`'s exact type against the bundled `start` doc in Task 1; fall back to `const result = (await run.returnValue) as IntakeResult;` if the handle is loosely typed.)

### B6. Replay idempotency (design doc Decision 3) → free from step memoization; zero migrations

WDK persists each step's result. A crash-and-resume re-enters the workflow but **replays** completed steps from cache rather than re-executing — so `createDealStep` won't double-insert a Deal on resume. This satisfies Decision 3's "no double-write on retry" with **zero new migrations**. (Cross-_run_ dedup — two independent `start()` calls for the same `externalId` — is unchanged from `runIntake` today and explicitly out of scope; it would need a DB uniqueness constraint, i.e. a migration. Noted in ADR 0013.)

### B7. OTel-in-steps (design doc Decision 4) → sidestepped, documented as future work

The durable path does **not** touch `@opentelemetry/api`. The ADR-0011 OTel spans live on the untouched `runIntakeFromLos` path; the durable action is dormant, so there is no live traced path to regress. Tracing WDK steps (span-per-step inside the durable execution) is a documented carry-over in ADR 0013, folding into the same future work as model-call tracing.

### B8. Mergeability — every required check is green with no secrets and no backend

Required CI checks are exactly `{Lint, Typecheck, Unit tests, Build}`.

- **Lint** (`cross-env ESLINT_USE_FLAT_CONFIG=false eslint app lib proxy.ts`) — covers `app lib proxy.ts` only; the new runtime files in `lib/` ARE linted; test files and `vitest.integration.config.ts` are NOT. The `'use workflow'`/`'use step'` directives are first-statement string-literal prologues (like `'use server'`) and should be exempt from `no-unused-expressions`; **contingency:** if Lint flags them, add a single `// eslint-disable-next-line <exact-rule-from-error>` above the directive — do not broaden the disable.
- **Typecheck** (`tsc --noEmit`) — validates the steps, workflow, and durable action; requires `workflow` installed (Task 1).
- **Unit tests** (`vitest run`, default config) — runs the 4 new no-DB unit tests; the default config is edited (Task 5) to **exclude** `tests/workflow/**`, so the Neon-gated durable tests never run here.
- **Build** (`next build` via `withWorkflow`) — compiles the workflow/steps; the WDK backend + `VERCEL_OIDC_TOKEN` are **runtime/deploy** concerns (Connor-owned), not build-time. Task 1 proves `pnpm --filter web build` is green with `withWorkflow` wired and **zero** workflow code (the de-risk gate) before any durable code is written.

The durable action + workflow are **dormant** (no caller) in this PR, so nothing in the live app changes behavior. The real end-to-end proof is the local Neon-gated `test:workflow` run (`@workflow/vitest`, in-process — no server/cloud backend).

### B9. PII discipline on step logs (CLAUDE.md hard rule #3 / §10.3)

WDK's validate rule encourages `console.log` in steps for observability. Those logs **must be PII-safe**: log `externalId` (a LOS reference, not PII) and booleans (`eligible`) only — **never** UPB, fees, tax, net-savings, names, or addresses. The step code below follows this; do not add figure-bearing logs.

### B10. Branch & sequencing

Branch `feat/m11-wdk-durable-wrap`, cut from **latest `main` _after_ PR-A (`feat/m11-ai-gateway-observability`) merges** — so this PR's CLAUDE.md count/§4 edits layer cleanly on top of PR-A's (PR-A adds `@cema/observability` as the 20th package; PR-B adds no package). Commits are signed (`-S`) with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Local `git log --show-signature` printing "No signature" is a known SSH-display artifact — GitHub verifies server-side (CLAUDE.md §2).

### B11. Highest residual risk (see Troubleshooting at the end)

`@workflow/vitest` bundles a step's dependency graph with esbuild. The steps reach `buildIntakeDeps → withRls → @cema/db` (Neon driver). If that bundle fails locally, the **Task 3 orchestration unit test** (which mocks the steps) remains the authoritative behavioral guard, and the Task 5 integration test can be reduced or deferred **without blocking merge** (it is excluded from required CI either way). Do not let an integration-test bundling snag block the mergeable unit-tested core.

---

## File Structure

**New — durable intake path (`apps/web/lib/agents/intake/`):**

- `apps/web/lib/agents/intake/intake.steps.ts` — three `'use step'` functions (`fetchAndEvaluateStep`, `emitEvaluatedStep`, `createDealStep`). Each is a full-Node retryable/cached boundary; pure logic + deps live here. One responsibility: be the durable I/O units.
- `apps/web/lib/agents/intake/intake.steps.test.ts` — unit test (default config, no DB) for `fetchAndEvaluateStep` only (the only step that touches no DB).
- `apps/web/lib/agents/intake/intake.workflow.ts` — one `'use workflow'` function orchestrating the three steps. Imports only steps + type-only `IntakeResult`. One responsibility: orchestration.
- `apps/web/lib/agents/intake/intake.workflow.test.ts` — the TDD heart: orchestration unit test (default config, no DB/backend) with `vi.mock('./intake.steps')`.
- `apps/web/lib/agents/intake/run-intake-durable-action.ts` — `'use server'` action `runIntakeFromLosDurable(externalId)`; resolves Clerk org/user, calls `start(intakeWorkflow, [...])`, awaits `run.returnValue`. Dormant (no caller in this PR).

**New — Neon-gated integration test (`apps/web/tests/workflow/`):**

- `apps/web/tests/workflow/intake-durable.test.ts` — `@workflow/vitest` in-process durable run against real Neon (`describe.skipIf(!DATABASE_URL)`). Proves the real `start()` → `run.returnValue` path end-to-end.

**New — integration test config:**

- `apps/web/vitest.integration.config.ts` — separate Vitest config loading the `@workflow/vitest` plugin and including only `tests/workflow/**`.

**Modified:**

- `apps/web/package.json` — `+ "workflow"` dep, `+ "@workflow/vitest"` devDep, `+ "test:workflow"` script.
- `apps/web/next.config.ts` — wrap export in `withWorkflow(...)`.
- `apps/web/vitest.config.ts` — add `tests/workflow/**` to `exclude` (keep the default suite backend-free).
- `docs/adr/0013-wdk-durable-wrap.md` — **new.** Records Shape B, serialization rationale, divergence from design-doc Decision 1, dormant-action posture, replay idempotency, Neon-gated integration test, package-name reconciliation, OIDC/backend = runtime/Connor-owned.
- `CLAUDE.md` — §2 carry-over #3 (WDK wrap) → RESOLVED; §4 `@vercel/workflow` → confirmed package name; package/test counts.

---

## Task 1: Install WDK, wire `withWorkflow`, prove the build is green with zero workflow code

**Files:**

- Modify: `apps/web/package.json` (add `workflow` dep + `@workflow/vitest` devDep)
- Modify: `apps/web/next.config.ts` (wrap export)

> **This is the de-risk gate.** It proves the WDK toolchain compiles cleanly into our Next.js 16 build _before_ any durable code exists. If `withWorkflow` + a clean build can't be achieved here, stop and resolve it — every later task depends on it.

- [ ] **Step 1: Install the WDK runtime + the vitest integration plugin**

Run: `pnpm --filter web add workflow && pnpm --filter web add -D @workflow/vitest`
Expected: both resolve and install; `apps/web/package.json` gains `"workflow"` under `dependencies` and `"@workflow/vitest"` under `devDependencies`; `pnpm-lock.yaml` updates.

> **Contingency (B1):** if `pnpm --filter web add workflow` fails with 404 (package not found), the package is published as `@vercel/workflow` — run `pnpm --filter web add @vercel/workflow && pnpm --filter web add -D @vercel/workflow` (or the scoped vitest companion the docs name) and replace every `from 'workflow'` / `from 'workflow/api'` / `from 'workflow/next'` import in later tasks with the `@vercel/...` equivalent the bundled docs specify.

- [ ] **Step 2: Confirm the package + bundled docs resolve, then read the canonical APIs**

Run: `ls node_modules/workflow/package.json node_modules/workflow/docs`
Expected: both exist. Then **read** these bundled docs (SKILL.md instruction #1 — read bundled docs before any workflow task) and confirm the exact API forms used in later tasks:

- `node_modules/workflow/docs/getting-started/next.mdx` — confirms the `withWorkflow` import path/shape and whether an `npx workflow init` step or a route handler is required for Next.js. **If init or a route handler is required, do it now and include it in this task's commit.**
- `node_modules/workflow/docs/foundations/workflows-and-steps.mdx` — confirms the `'use workflow'` / `'use step'` directive semantics used in Tasks 2-3.
- `node_modules/workflow/docs/api-reference/workflow-api/start.mdx` — confirms `start(fn, [args])` returns a handle and that `run.returnValue` is the completion promise used in Tasks 4-5.

> Record any divergence between these docs and the code blocks below (e.g. `withWorkflow` taking options, `start` taking an options object, `returnValue` being a method). Adjust the code in later tasks to match the installed version — the docs are authoritative over this plan for version-specific shapes.

- [ ] **Step 3: Wire `withWorkflow` into the Next.js config**

The current `apps/web/next.config.ts` is:

```typescript
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@cema/ui', '@cema/auth', '@cema/db', '@cema/compliance'],
  typedRoutes: true,
  serverExternalPackages: ['docusign-esign'],
};

export default nextConfig;
```

Change it to (verify `withWorkflow`'s import path + call shape against the Step-2 doc):

```typescript
import type { NextConfig } from 'next';
import { withWorkflow } from 'workflow/next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@cema/ui', '@cema/auth', '@cema/db', '@cema/compliance'],
  typedRoutes: true,
  serverExternalPackages: ['docusign-esign'],
};

export default withWorkflow(nextConfig);
```

- [ ] **Step 4: Prove the build is green with `withWorkflow` and NO workflow code (de-risk gate)**

Run: `pnpm --filter web build`
Expected: a successful production build. `withWorkflow` is now in the toolchain but no `'use workflow'`/`'use step'` files exist yet — this confirms the WDK Next.js plugin compiles cleanly on its own. (If the build needs a WDK backend env var, the docs from Step 2 will say so — but compilation should not; backend/OIDC is runtime.)

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: no errors (the `withWorkflow` import resolves against the installed types).

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json apps/web/next.config.ts pnpm-lock.yaml
git commit -S -m "$(cat <<'EOF'
build(web): install Workflow DevKit + wire withWorkflow into next.config

Adds the `workflow` runtime + `@workflow/vitest` dev plugin and wraps the
Next.js config in withWorkflow(). De-risk gate: `pnpm --filter web build`
is green with the WDK toolchain wired and zero workflow code, confirming
compilation is independent of any WDK backend or OIDC token (runtime
concerns, Connor-owned). Durable code lands in the next tasks.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

> If Step 2 required `npx workflow init` or a generated route handler, add those files to this commit and name them in the message.

---

## Task 2: The three durable steps + the no-DB step unit test

**Files:**

- Create: `apps/web/lib/agents/intake/intake.steps.ts`
- Test: `apps/web/lib/agents/intake/intake.steps.test.ts`

> The step file is created **before** the test here, because the test imports the real (un-mocked) `fetchAndEvaluateStep`. Under the default Vitest config (no `@workflow/vitest` plugin) the `'use step'` directive is an inert string literal, so the function runs as a plain async fn — `new FixtureLosAdapter().getApplication(...)` (fixture data, no network) + `checkEligibility` (pure). No DB, no backend.

- [ ] **Step 1: Write the steps file**

Create `apps/web/lib/agents/intake/intake.steps.ts`:

```typescript
/**
 * Durable WDK steps for the Intake Agent (M11 PR-B, Shape B).
 *
 * Each `'use step'` function is a cached/retryable boundary with FULL Node.js —
 * so the pure logic (checkEligibility/estimateSavings) and the effectful deps
 * (buildIntakeDeps -> withRls -> Neon) live HERE, not in the workflow. Args and
 * returns are serializable (strings + plain objects); IntakeDeps is rebuilt
 * inside each step because it (functions + a class instance) cannot cross the
 * durable boundary (ADR 0013 / WDK serialization rule).
 *
 * console.log lines are PII-safe by design: externalId (a LOS reference) and
 * booleans only — never UPB, fees, tax, net-savings, names, or addresses
 * (CLAUDE.md hard rule #3 / §10.3).
 */

import { FixtureLosAdapter, checkEligibility, estimateSavings } from '@cema/agents-intake';
import type {
  EligibilityResult,
  IneligibilityReason,
  NormalizedApplication,
  SavingsEstimate,
} from '@cema/agents-intake';

import { buildIntakeDeps } from './deps';

/** Step 1: fetch the LOS application and run deterministic eligibility (pure, no DB). */
export async function fetchAndEvaluateStep(
  externalId: string,
): Promise<{ application: NormalizedApplication; eligibility: EligibilityResult }> {
  'use step';
  console.log('[intake.step] fetch_and_evaluate', { externalId });
  const application = await new FixtureLosAdapter().getApplication(externalId);
  const eligibility = checkEligibility(application);
  return { application, eligibility };
}

/** Step 2: emit the intake.evaluated audit row (every run, before any deal). */
export async function emitEvaluatedStep(args: {
  organizationId: string;
  actorUserId: string;
  externalId: string;
  eligible: boolean;
  reasons: IneligibilityReason[];
}): Promise<void> {
  'use step';
  console.log('[intake.step] emit_audit', {
    externalId: args.externalId,
    eligible: args.eligible,
  });
  const deps = buildIntakeDeps({
    organizationId: args.organizationId,
    actorUserId: args.actorUserId,
    adapter: new FixtureLosAdapter(),
  });
  await deps.emitAudit({
    action: 'intake.evaluated',
    externalId: args.externalId,
    eligible: args.eligible,
    reasons: args.reasons,
  });
}

/** Step 3: estimate savings (pure) + create the Deal (writes deal.created audit atomically). */
export async function createDealStep(args: {
  organizationId: string;
  actorUserId: string;
  application: NormalizedApplication;
}): Promise<{ dealId: string; savings: SavingsEstimate }> {
  'use step';
  console.log('[intake.step] create_deal', { externalId: args.application.externalId });
  const savings = estimateSavings(args.application);
  const deps = buildIntakeDeps({
    organizationId: args.organizationId,
    actorUserId: args.actorUserId,
    adapter: new FixtureLosAdapter(),
  });
  const { dealId } = await deps.createDeal({ application: args.application, savings });
  return { dealId, savings };
}
```

> `estimateSavings(args.application)` is called with **no rate table**, so it uses `PLACEHOLDER_RATES` — behavior-identical to the current app path (`run-intake-action.ts` does not pass `rates` either). When Connor confirms the NY recording-tax table (ADR 0010 carry-over #4), thread it through `createDealStep`'s args then — not now.

- [ ] **Step 2: Write the step unit test**

Create `apps/web/lib/agents/intake/intake.steps.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import { fetchAndEvaluateStep } from './intake.steps';

// No @workflow/vitest plugin here (default config): 'use step' is an inert
// directive, so fetchAndEvaluateStep runs as a plain async fn over fixture
// data — no Neon, no WDK backend. (emitEvaluatedStep/createDealStep touch the
// DB and are exercised by the Neon-gated integration test in Task 5.)
describe('fetchAndEvaluateStep', () => {
  it('fetches an eligible single-family refi and marks it eligible', async () => {
    const { application, eligibility } = await fetchAndEvaluateStep('FIX-ELIG-SF');
    expect(application.externalId).toBe('FIX-ELIG-SF');
    expect(application.state).toBe('NY');
    expect(application.cemaType).toBe('refi_cema');
    expect(eligibility.eligible).toBe(true);
    expect(eligibility.reasons).toEqual([]);
  });

  it('fetches an ineligible co-op and accumulates the property-type reason', async () => {
    const { application, eligibility } = await fetchAndEvaluateStep('FIX-INELIG-COOP');
    expect(application.propertyType).toBe('co_op');
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reasons).toContain('ineligible_property_type');
  });
});
```

- [ ] **Step 3: Run the step unit test to verify it passes**

Run: `pnpm --filter web test intake.steps`
Expected: PASS — 2 tests green. (No "module not found"; the step file exists from Step 1.)

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: no errors. The step arg/return shapes match the `@cema/agents-intake` types (`NormalizedApplication`, `EligibilityResult`, `IneligibilityReason[]`, `SavingsEstimate`).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/agents/intake/intake.steps.ts apps/web/lib/agents/intake/intake.steps.test.ts
git commit -S -m "$(cat <<'EOF'
feat(web): add durable WDK steps for the Intake Agent

Three 'use step' boundaries (fetch+evaluate, emit-evaluated, create-deal),
each rebuilding IntakeDeps internally because it can't cross the durable
boundary (functions + a class instance are non-serializable). Pure logic +
DB writes live in the steps (full Node); PII-safe console.logs only.
Unit-tests fetchAndEvaluateStep over fixture data (no DB).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: The workflow orchestrator + the orchestration unit test (the TDD heart)

This is the behavioral contract of PR-B: the workflow sequences the steps exactly as `runIntake` does — `fetch+evaluate → emit evaluated → (eligible?) create deal` — with the audit-split and the ineligible short-circuit. The test mocks the steps and asserts the **orchestration**, so it needs neither Neon nor the WDK backend.

**Files:**

- Test: `apps/web/lib/agents/intake/intake.workflow.test.ts`
- Create: `apps/web/lib/agents/intake/intake.workflow.ts`

- [ ] **Step 1: Write the failing orchestration test**

Create `apps/web/lib/agents/intake/intake.workflow.test.ts`:

```typescript
import { FixtureLosAdapter, checkEligibility } from '@cema/agents-intake';
import type { SavingsEstimate } from '@cema/agents-intake';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as steps from './intake.steps';
import { intakeWorkflow } from './intake.workflow';

// Auto-mock the steps module: each export becomes a vi.fn(). Under the default
// config (no @workflow/vitest plugin) the directives are inert, so the workflow
// runs as a plain async fn calling the mocked steps — pure orchestration, no DB.
vi.mock('./intake.steps');

const adapter = new FixtureLosAdapter();

/** Build a realistic fetchAndEvaluateStep return from the real fixture + real eligibility. */
async function fixtureEvaluation(externalId: string) {
  const application = await adapter.getApplication(externalId);
  return { application, eligibility: checkEligibility(application) };
}

const FAKE_SAVINGS: SavingsEstimate = {
  assignedUpb: 400_000,
  appliedRate: 0.02,
  taxSaved: 8_000,
  fees: 1_000,
  netSavings: 7_000,
  isPlaceholderRate: true,
};

describe('intakeWorkflow orchestration', () => {
  beforeEach(() => {
    vi.mocked(steps.emitEvaluatedStep).mockResolvedValue(undefined);
    vi.mocked(steps.createDealStep).mockResolvedValue({
      dealId: 'DEAL-FIX-ELIG-SF',
      savings: FAKE_SAVINGS,
    });
  });

  it('eligible: emits the evaluated audit, THEN creates the deal, returning dealId + savings', async () => {
    const evaluation = await fixtureEvaluation('FIX-ELIG-SF');
    vi.mocked(steps.fetchAndEvaluateStep).mockResolvedValue(evaluation);

    const result = await intakeWorkflow('FIX-ELIG-SF', 'org-1', 'user-1');

    expect(steps.fetchAndEvaluateStep).toHaveBeenCalledWith('FIX-ELIG-SF');
    expect(steps.emitEvaluatedStep).toHaveBeenCalledWith({
      organizationId: 'org-1',
      actorUserId: 'user-1',
      externalId: 'FIX-ELIG-SF',
      eligible: true,
      reasons: [],
    });
    expect(steps.createDealStep).toHaveBeenCalledWith({
      organizationId: 'org-1',
      actorUserId: 'user-1',
      application: evaluation.application,
    });

    // Audit-split ordering: intake.evaluated is emitted BEFORE the deal is created
    // (so an evaluated decision survives a later create failure — same contract as
    // runIntake). Proven by invocation order.
    expect(vi.mocked(steps.emitEvaluatedStep).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(steps.createDealStep).mock.invocationCallOrder[0],
    );

    expect(result.eligibility.eligible).toBe(true);
    expect(result.dealId).toBe('DEAL-FIX-ELIG-SF');
    expect(result.savings).toEqual(FAKE_SAVINGS);
    expect(result.externalId).toBe('FIX-ELIG-SF');
  });

  it('ineligible: emits the evaluated audit once and NEVER creates a deal', async () => {
    const evaluation = await fixtureEvaluation('FIX-INELIG-COOP');
    vi.mocked(steps.fetchAndEvaluateStep).mockResolvedValue(evaluation);

    const result = await intakeWorkflow('FIX-INELIG-COOP', 'org-1', 'user-1');

    expect(steps.emitEvaluatedStep).toHaveBeenCalledTimes(1);
    expect(steps.createDealStep).not.toHaveBeenCalled();
    expect(result.eligibility.eligible).toBe(false);
    expect(result.dealId).toBeNull();
    expect(result.savings).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter web test intake.workflow`
Expected: FAIL — `Failed to resolve import "./intake.workflow"` (the workflow file does not exist yet).

- [ ] **Step 3: Write the workflow file**

Create `apps/web/lib/agents/intake/intake.workflow.ts`:

```typescript
/**
 * Durable WDK workflow for the Intake Agent (M11 PR-B, Shape B).
 *
 * Orchestration ONLY — runs in a sandboxed VM with no Node.js. It therefore
 * imports only the step references (durable boundaries) and a type-only
 * IntakeResult (erased at compile time), so the @cema/agents-intake barrel
 * (which pulls the AI SDK via narrative.ts) never enters the sandbox bundle.
 *
 * Mirrors runIntake's flow exactly (ADR 0013 records the deliberate divergence
 * from the design doc's "inject step.run via IntakeDeps", which WDK makes
 * infeasible): fetch+evaluate -> emit evaluated (every run) -> short-circuit if
 * ineligible -> create deal. Args are serializable strings; IntakeDeps is
 * rebuilt inside each step.
 */

import type { IntakeResult } from '@cema/agents-intake';

import { createDealStep, emitEvaluatedStep, fetchAndEvaluateStep } from './intake.steps';

export async function intakeWorkflow(
  externalId: string,
  organizationId: string,
  actorUserId: string,
): Promise<IntakeResult> {
  'use workflow';

  const { application, eligibility } = await fetchAndEvaluateStep(externalId);

  await emitEvaluatedStep({
    organizationId,
    actorUserId,
    externalId,
    eligible: eligibility.eligible,
    reasons: eligibility.reasons,
  });

  if (!eligibility.eligible) {
    return { externalId, eligibility, savings: null, dealId: null };
  }

  const { dealId, savings } = await createDealStep({ organizationId, actorUserId, application });

  return { externalId, eligibility, savings, dealId };
}
```

- [ ] **Step 4: Run the orchestration test to verify it passes**

Run: `pnpm --filter web test intake.workflow`
Expected: PASS — 2 tests green (eligible path creates the deal after the audit; ineligible path short-circuits with no deal).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: no errors. The workflow's return shape satisfies `IntakeResult` (`{ externalId; eligibility; savings: SavingsEstimate | null; dealId: string | null }`).

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/agents/intake/intake.workflow.ts apps/web/lib/agents/intake/intake.workflow.test.ts
git commit -S -m "$(cat <<'EOF'
feat(web): add durable intake workflow orchestrating the three steps

One 'use workflow' fn mirroring runIntake's flow (fetch+evaluate -> emit
evaluated -> short-circuit if ineligible -> create deal). Imports only the
step refs + a type-only IntakeResult, so the sandboxed VM never bundles the
AI-SDK-importing @cema/agents-intake barrel. The orchestration unit test
(vi.mock'd steps, no DB/backend) is the behavioral guard: audit-split
ordering + ineligible short-circuit.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: The dormant durable Server Action

A `'use server'` action that starts the workflow and awaits its completion, preserving the synchronous `Promise<IntakeResult>` contract. It **duplicates** the Clerk org/user resolution block from `run-intake-action.ts` rather than refactoring it — the existing traced action must not be touched/regressed (B7), and a shared extraction is out of PR-B's scope. No UI wires this action in this PR (dormant); it exists so the durable path is callable and typechecked/built.

**Files:**

- Create: `apps/web/lib/agents/intake/run-intake-durable-action.ts`

- [ ] **Step 1: Write the durable Server Action**

Create `apps/web/lib/agents/intake/run-intake-durable-action.ts`:

```typescript
'use server';

import { type IntakeResult } from '@cema/agents-intake';
import { getCurrentOrganizationId, getCurrentUser } from '@cema/auth';
import { getDb, organizations, users } from '@cema/db';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { start } from 'workflow/api';

import { intakeWorkflow } from './intake.workflow';

/**
 * Durable variant of runIntakeFromLos (M11 PR-B). Resolves the Clerk org/user to
 * internal ids (the workflow takes only serializable strings — it cannot receive
 * IntakeDeps), then runs the Intake flow as a WDK durable workflow.
 *
 * `start()` returns immediately; `run.returnValue` resolves with the workflow's
 * IntakeResult once it completes, so this action keeps the same synchronous
 * Promise<IntakeResult> contract the caller expects.
 *
 * DORMANT in this PR: no UI calls it yet. The ADR-0011-traced runIntakeFromLos
 * stays the live path. This action is the durable seam, proven by the Neon-gated
 * integration test, ready to swap behind a flag once a WDK backend is provisioned.
 */
export async function runIntakeFromLosDurable(externalId: string): Promise<IntakeResult> {
  const clerkOrgId = await getCurrentOrganizationId();
  const clerkUser = await getCurrentUser();
  if (!clerkUser) {
    throw new Error('Not authenticated');
  }

  const db = getDb();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) {
    throw new Error('Organization not synced yet');
  }
  const user = await db.query.users.findFirst({
    where: eq(users.clerkUserId, clerkUser.id),
  });
  if (!user) {
    throw new Error('User not synced yet');
  }

  const run = await start(intakeWorkflow, [externalId, org.id, user.id]);
  const result = await run.returnValue;

  if (result.dealId) {
    revalidatePath('/deals');
  }
  return result;
}
```

> **Verify against the Task-1 docs:** if `run.returnValue` is loosely typed (e.g. `unknown`/`any` from the handle), assert it: `const result = (await run.returnValue) as IntakeResult;`. If `start`'s signature differs (e.g. takes an options object or positional args rather than an array), match the bundled `start.mdx`. The Clerk-resolution block is copied verbatim from `run-intake-action.ts` — keep it identical so the two paths stay equivalent.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: no errors. `start(intakeWorkflow, [...])` accepts the workflow fn + a serializable string-tuple; `run.returnValue` resolves to `IntakeResult` (or is cast per the note).

- [ ] **Step 3: Build (the WDK compile gate over real workflow code)**

Run: `pnpm --filter web build`
Expected: a successful production build — now compiling an actual `'use workflow'` + `'use step'` graph through `withWorkflow`. (Still no backend/OIDC needed: that's runtime.) If the build complains about a missing route handler or registration, the Task-1 docs name the fix; apply it and re-run.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/agents/intake/run-intake-durable-action.ts
git commit -S -m "$(cat <<'EOF'
feat(web): add dormant durable Intake Server Action (start + returnValue)

runIntakeFromLosDurable resolves Clerk org/user then runs the intake flow
via WDK start(); awaiting run.returnValue preserves the synchronous
Promise<IntakeResult> contract. Dormant (no UI caller) — the ADR-0011
traced runIntakeFromLos stays live; this is the durable seam. `next build`
now compiles a real use-workflow/use-step graph through withWorkflow.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Neon-gated `@workflow/vitest` integration test + its config + script

Proves the **real** durable path: `start(intakeWorkflow, [...])` → steps execute (hitting real Neon via `buildIntakeDeps` → `withRls`) → `run.returnValue` resolves. Runs **in-process** via the `@workflow/vitest` plugin (no server/cloud backend), and is **Neon-gated** (`describe.skipIf(!DATABASE_URL)`) because the steps do real DB writes. It lives under `tests/workflow/**`, which the default Vitest config excludes — so it never runs in required CI; it is the local/manual end-to-end proof.

**Files:**

- Modify: `apps/web/vitest.config.ts` (exclude `tests/workflow/**`)
- Create: `apps/web/vitest.integration.config.ts`
- Modify: `apps/web/package.json` (add `test:workflow` script)
- Test: `apps/web/tests/workflow/intake-durable.test.ts`

- [ ] **Step 1: Exclude `tests/workflow/**` from the default config\*\*

The current `apps/web/vitest.config.ts` is:

```typescript
import { config } from 'dotenv';
import { defineConfig } from 'vitest/config';

config({ path: '.env.local' });

export default defineConfig({
  test: {
    include: ['**/*.test.ts'],
    exclude: ['node_modules', 'tests/e2e/**'],
  },
});
```

Change the `exclude` line to:

```typescript
    exclude: ['node_modules', 'tests/e2e/**', 'tests/workflow/**'],
```

> Without this, `pnpm --filter web test` (the required Unit-tests check) would pick up the durable test under the **default** config — which has no `@workflow/vitest` plugin, so `start()`/`'use workflow'` wouldn't be wired. Excluding it keeps the required suite green and backend-free; the durable test runs only under the integration config below.

- [ ] **Step 2: Create the integration config**

Create `apps/web/vitest.integration.config.ts` (verify the `@workflow/vitest` import/export name against the Task-1 docs — `node_modules/@workflow/vitest`):

```typescript
import { config } from 'dotenv';
import { workflow } from '@workflow/vitest';
import { defineConfig } from 'vitest/config';

config({ path: '.env.local' });

// The @workflow/vitest plugin compiles the 'use workflow'/'use step' directives
// and runs the durable engine IN-PROCESS (no server/cloud backend). Steps still
// perform real I/O, so these tests hit a real Neon branch and are Neon-gated.
export default defineConfig({
  plugins: [workflow()],
  test: {
    include: ['tests/workflow/**/*.test.ts'],
    testTimeout: 60_000,
  },
});
```

- [ ] **Step 3: Add the `test:workflow` script**

In `apps/web/package.json`, add to `"scripts"` (after the existing `"test"` line):

```json
    "test:workflow": "vitest run --config vitest.integration.config.ts",
```

- [ ] **Step 4: Write the Neon-gated durable integration test**

Create `apps/web/tests/workflow/intake-durable.test.ts` (seeding mirrors `tests/integration/intake-agent-rls.test.ts` exactly — `organizations` = `{id, clerkOrgId, name, slug}`, `users` = `{id, clerkUserId, email}`; cleanup deletes only `deals` because audit rows are immutable under the §10.5 trigger and reference org/user under RESTRICT):

```typescript
/**
 * Intake Agent — durable WDK path integration proof (M11 PR-B).
 *
 * Runs the real durable workflow in-process via @workflow/vitest: start() ->
 * steps execute against a real Neon branch (buildIntakeDeps -> withRls) ->
 * run.returnValue resolves. Proves the Shape-B durable path produces the same
 * outcome as runIntake: eligible -> Deal created; ineligible -> no Deal.
 *
 * Neon-gated (skipIf no DATABASE_URL), like the sibling RLS suite. NOT in
 * required CI — it lives under tests/workflow/**, which the default vitest
 * config excludes; run it locally with `pnpm --filter web test:workflow`.
 */

import { getDb, organizations, users } from '@cema/db';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { start } from 'workflow/api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { intakeWorkflow } from '../../lib/agents/intake/intake.workflow';

const ORG_ID = crypto.randomUUID();
const USER_ID = crypto.randomUUID();

const skip = !process.env.DATABASE_URL;

function getNeonSql(): NeonQueryFunction<false, false> {
  return neon(process.env.DATABASE_URL!);
}

describe.skipIf(skip)('Intake Agent — durable WDK path', () => {
  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(organizations)
      .values({
        id: ORG_ID,
        clerkOrgId: `org_durable_${ORG_ID}`,
        name: 'Org (Durable Intake)',
        slug: `durable-${ORG_ID}`,
      })
      .onConflictDoNothing();
    await db
      .insert(users)
      .values({
        id: USER_ID,
        clerkUserId: `user_durable_${USER_ID}`,
        email: `durable-${USER_ID}@example.invalid`,
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    // Reclaim only trigger-free deals rows; audit_events are immutable (§10.5)
    // and pin org/user under ON DELETE RESTRICT — all left behind intentionally,
    // kept collision-free by the per-run-unique ids.
    const nsql = getNeonSql();
    await nsql`DELETE FROM deals WHERE organization_id = ${ORG_ID}`;
  });

  it('eligible application runs durably and returns a dealId + savings', async () => {
    const run = await start(intakeWorkflow, ['FIX-ELIG-SF', ORG_ID, USER_ID]);
    const result = await run.returnValue;

    expect(result.eligibility.eligible).toBe(true);
    expect(result.dealId).toBeTruthy();
    expect(result.savings).not.toBeNull();
    expect(result.savings?.assignedUpb).toBe(400_000); // FIX-ELIG-SF existingUpb
  });

  it('ineligible application runs durably, returns no deal', async () => {
    const run = await start(intakeWorkflow, ['FIX-INELIG-COOP', ORG_ID, USER_ID]);
    const result = await run.returnValue;

    expect(result.eligibility.eligible).toBe(false);
    expect(result.dealId).toBeNull();
    expect(result.savings).toBeNull();
  });
});
```

- [ ] **Step 5: Run the durable integration test**

Run: `pnpm --filter web test:workflow`
Expected:

- **With `DATABASE_URL` in `.env.local`** (desktop/laptop): 2 tests green — the durable engine runs in-process and the steps write to Neon.
- **Without `DATABASE_URL`** (or running from cloud/mobile): the suite **skips green** (`describe.skipIf`). That is an acceptable pass for this task; record that the live run is deferred to a desktop session.

> If the `@workflow/vitest` plugin fails to bundle the step dep graph (`buildIntakeDeps → withRls → @cema/db`), see Troubleshooting — do **not** block the PR on it; the Task-3 orchestration test is the authoritative behavioral guard and this test is excluded from required CI.

- [ ] **Step 6: Confirm the default suite still excludes the durable test**

Run: `pnpm --filter web test`
Expected: the existing apps/web suite **plus the 4 new unit tests** (2 from `intake.steps.test.ts` + 2 from `intake.workflow.test.ts`) all green; the durable test under `tests/workflow/**` is **not** collected (excluded in Step 1). Baseline before PR-B was 248 passed + 2 skipped → now ≈252 passed + 2 skipped.

- [ ] **Step 7: Commit**

```bash
git add apps/web/vitest.config.ts apps/web/vitest.integration.config.ts apps/web/package.json apps/web/tests/workflow/intake-durable.test.ts pnpm-lock.yaml
git commit -S -m "$(cat <<'EOF'
test(web): Neon-gated @workflow/vitest durable integration proof

Adds a separate vitest integration config (workflow() plugin, in-process,
no backend) + test:workflow script + the durable path test: start() ->
steps hit real Neon -> run.returnValue. Neon-gated (skipIf no DATABASE_URL)
and excluded from the default suite (tests/workflow/**), so required CI
stays green and backend-free. Mirrors the RLS suite's seeding/cleanup.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: ADR 0013, CLAUDE.md updates, full gate, push + PR

**Files:**

- Create: `docs/adr/0013-wdk-durable-wrap.md`
- Modify: `CLAUDE.md` (§2 carry-over #3 → RESOLVED; §4 package-name; counts)

- [ ] **Step 1: Write ADR 0013**

Create `docs/adr/0013-wdk-durable-wrap.md`:

```markdown
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
proven by the Neon-gated integration test, ready to swap behind a flag once a WDK
backend + `VERCEL_OIDC_TOKEN` are provisioned (Connor-owned runtime). Because the
durable path doesn't touch `@opentelemetry/api`, the ADR-0011 spans on
`runIntakeFromLos` are untouched. Tracing the durable steps (span-per-step) is a
carry-over, folding into the model-call-tracing work alongside the AI-Gateway slice.

### 5. Replay idempotency for free; cross-run dedup out of scope

WDK persists step results, so a crash-and-resume **replays** completed steps from
cache — `createDealStep` won't double-insert on resume. This satisfies design-doc
Decision 3 with **zero new migrations**. Cross-_run_ dedup (two `start()` calls
for one `externalId`) is unchanged from `runIntake` today and out of scope (would
need a DB uniqueness constraint = a migration).

### 6. Testing — two tiers, neither requiring a backend in CI

- **Orchestration unit test** (`intake.workflow.test.ts`, default config,
  `vi.mock`'d steps): the behavioral guard for the sequence/short-circuit/
  audit-split. No DB, no backend. **This is required-CI green.**
- **Durable integration test** (`tests/workflow/intake-durable.test.ts`,
  `@workflow/vitest`, in-process): the real `start()`→`run.returnValue` proof;
  steps hit real Neon → **Neon-gated** and **excluded from required CI** (lives
  under `tests/workflow/**`). `vi.mock` does not work under the plugin (esbuild
  bundles step deps), which is why orchestration assertions live in the unit test.

### 7. Package name reconciled to `workflow`

The flow uses the `workflow` package (`workflow`, `workflow/api`, `workflow/next`)

- `@workflow/vitest`, per the installed Vercel plugin docs. CLAUDE.md §4 + the M11
  design doc had said `@vercel/workflow`; §4 is corrected to the confirmed name.

---

## What shipped

| File                                                      | Change                                                                     |
| --------------------------------------------------------- | -------------------------------------------------------------------------- |
| `apps/web/lib/agents/intake/intake.steps.ts`              | **New.** 3 `'use step'` boundaries; deps rebuilt internally; PII-safe logs |
| `apps/web/lib/agents/intake/intake.steps.test.ts`         | **New.** `fetchAndEvaluateStep` unit test (fixture data, no DB)            |
| `apps/web/lib/agents/intake/intake.workflow.ts`           | **New.** `'use workflow'` orchestrator; imports only steps + type          |
| `apps/web/lib/agents/intake/intake.workflow.test.ts`      | **New.** Orchestration unit test (mocked steps) — the behavioral guard     |
| `apps/web/lib/agents/intake/run-intake-durable-action.ts` | **New.** Dormant `'use server'` action: `start()` + `run.returnValue`      |
| `apps/web/tests/workflow/intake-durable.test.ts`          | **New.** Neon-gated `@workflow/vitest` in-process durable proof            |
| `apps/web/vitest.integration.config.ts`                   | **New.** Separate config w/ `workflow()` plugin                            |
| `apps/web/vitest.config.ts`                               | `exclude` += `tests/workflow/**`                                           |
| `apps/web/next.config.ts`                                 | wrapped in `withWorkflow(...)`                                             |
| `apps/web/package.json`                                   | `+ workflow`, `+ @workflow/vitest` (dev), `+ test:workflow`                |

No new DB migrations.

---

## Consequences

**Positive**

- The Intake flow is now durable: crash-resilient + replay-idempotent across long-lived deals, with no double-write on resume.
- Required CI stays green with no secrets and no WDK backend (the durable proof is the local Neon-gated `test:workflow`).
- The durable seam is ready to go live behind a flag once a backend + OIDC are provisioned.

**Negative / tradeoffs**

- Orchestration is duplicated between `runIntake` (package) and `intakeWorkflow` (app) — two shapes to keep in sync until one is retired. Mitigated: both delegate to the same pure functions + `buildIntakeDeps`.
- The durable action is dormant (unverified against a real backend) until Connor provisions one.
- `@workflow/vitest` esbuild-bundles step deps, so `vi.mock` is unavailable there — orchestration assertions are forced into the (good) unit test; the integration test is outcome-only.

---

## Carry-overs

1. **Provision a WDK backend + `VERCEL_OIDC_TOKEN`** (Connor) — then flip a flag to route `runIntakeFromLos` → `runIntakeFromLosDurable` and verify in a preview deploy.
2. **Trace the durable steps** — span-per-step inside the durable execution; folds into the model-call-tracing / AI-Gateway observability work.
3. **Cross-run dedup** — if business rules require it, add a DB uniqueness constraint on `(organization_id, external_id)` for intake deals (a migration).
4. **Retire the duplication** — once the durable path is live and trusted, decide whether `runIntake` or `intakeWorkflow` is the single source and collapse the other.
```

- [ ] **Step 2: Update CLAUDE.md (§2 carry-over #3 RESOLVED, §4 package name, counts)**

In `CLAUDE.md`, make these edits:

(a) **§2 carry-over #3** — change:

```markdown
3. **WDK wrap:** wrap `runIntake` in `workflow()` once `@vercel/workflow` is installed; each `await` becomes a `step.run(...)` (boundaries designed 1:1).
```

to:

```markdown
3. **WDK wrap — RESOLVED (2026-05-29, ADR 0013).** `intakeWorkflow` (app-layer `'use workflow'`) wraps the intake flow as three `'use step'` boundaries reached through a dormant `runIntakeFromLosDurable` Server Action (`start()` + `run.returnValue`). "Shape B" diverges from design-doc Decision 1 (WDK has no injectable step runner; `IntakeDeps` isn't serializable) — the workflow takes serializable strings + rebuilds deps inside steps. Package is `workflow` (not `@vercel/workflow`). Required CI green with no backend; the live proof is the Neon-gated `pnpm --filter web test:workflow`. Still open: provision a WDK backend + `VERCEL_OIDC_TOKEN`, then flip the live path behind a flag; trace the durable steps.
```

(b) **§4 tech-stack table** — the "Durable workflows" row currently reads:

```markdown
| **Durable workflows** | Vercel Workflow DevKit (WDK) primary + Inngest fallback | 75-day CEMA lifecycle requires durability |
```

Append the confirmed package name to the "Why" column (so future sessions don't re-litigate `@vercel/workflow`):

```markdown
| **Durable workflows** | Vercel Workflow DevKit (WDK) primary + Inngest fallback | 75-day CEMA lifecycle requires durability — pkg is `workflow` (`workflow/api`, `workflow/next`) + `@workflow/vitest`, confirmed M11 PR-B / ADR 0013 |
```

(c) **§2 "Code:" line counts** — find the `- **Code:**` line (PR-A merged first, so it already reads `20 workspace packages` including `@cema/observability`). Update it to reflect PR-B: still 20 packages (PR-B adds no package), and the apps/web test count rises by the 4 new unit tests (the 2 Neon-gated durable tests are excluded from the default run). Apply the **delta** ("+4 apps/web unit tests: `intake.steps.test.ts` ×2 + `intake.workflow.test.ts` ×2; +1 Neon-gated `@workflow/vitest` durable integration file under `tests/workflow/`, excluded from the default suite") on top of whatever exact totals PR-A left — read the line first and edit it in place rather than hard-coding a number this plan can't know post-PR-A.

> Do **not** touch `docs/superpowers/specs/*.md` (hard rule #11). These are CLAUDE.md + ADR edits only.

- [ ] **Step 3: Format docs so Lint's `format:check` passes**

Run: `pnpm format`
Expected: Prettier normalizes this plan + the ADR + CLAUDE.md. `pnpm format:check` (part of Lint) covers **all** `*.md`, and lint-staged formats only _staged_ files — so run repo-wide `format` to avoid the Lint job failing on an unformatted doc (this caused the M9 admin-bypass; CLAUDE.md §19).

- [ ] **Step 4: Run the full required-check gate locally**

Run: `pnpm --filter web typecheck && pnpm --filter web lint && pnpm --filter web test && pnpm --filter web build`
Expected: all four green — these mirror the required CI checks (`Typecheck`, `Lint`, `Unit tests`, `Build`). The durable test under `tests/workflow/**` is excluded from `pnpm --filter web test`; `test:workflow` is **not** part of this gate (it's local/Neon-gated, not required CI).

> If `pnpm --filter web lint` flags the `'use workflow'`/`'use step'` directives (B8 contingency), add a single `// eslint-disable-next-line <exact-rule-name-from-the-error>` directly above the flagged directive — do not broaden the disable. Re-run lint to confirm.

- [ ] **Step 5: Commit**

```bash
git add docs/adr/0013-wdk-durable-wrap.md CLAUDE.md docs/superpowers/plans/2026-05-29-m11-pr-b-wdk-durable-wrap.md
git commit -S -m "$(cat <<'EOF'
docs(adr): record ADR 0013 WDK durable wrap + close carry-over #3

ADR 0013 documents Shape B (workflow over serializable strings; deps
rebuilt in steps), the divergence from design-doc Decision 1, the dormant
durable action, replay idempotency w/ zero migrations, the two-tier test
strategy, and the `workflow` package-name reconciliation. CLAUDE.md §2
carry-over #3 -> RESOLVED, §4 package name confirmed, counts updated.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Push the branch and open the PR**

```bash
git push -u origin feat/m11-wdk-durable-wrap
gh pr create --title "feat(m11): WDK durable wrap of the Intake Agent (PR-B)" --body "$(cat <<'EOF'
## Summary
- Wrap the Intake flow in a WDK durable workflow: `intake.workflow.ts` (`'use workflow'`) orchestrates three `'use step'` boundaries (`intake.steps.ts`), reached through a dormant `runIntakeFromLosDurable` Server Action (`start()` + `run.returnValue`). Closes ADR 0010 carry-over #3.
- "Shape B": the workflow takes serializable strings and rebuilds `IntakeDeps` inside each step (WDK can't serialize functions/class instances, and has no injectable step runner — a deliberate divergence from the design doc's Decision 1, recorded in ADR 0013).
- Behavior identical to `runIntake`; the ADR-0011-traced `runIntakeFromLos` stays the live path (the durable action is dormant until a WDK backend is provisioned).
- Two-tier tests: orchestration unit test (mocked steps, required-CI green) + Neon-gated `@workflow/vitest` in-process durable proof (excluded from required CI).
- Records ADR 0013.

## Test plan
- [ ] `pnpm --filter web test intake.steps` — 2 green
- [ ] `pnpm --filter web test intake.workflow` — 2 green (orchestration guard)
- [ ] `pnpm --filter web typecheck && pnpm --filter web lint && pnpm --filter web build` — all green
- [ ] `pnpm --filter web test` — default suite + 4 new unit tests green; `tests/workflow/**` excluded
- [ ] (local, Neon) `pnpm --filter web test:workflow` — 2 green with `DATABASE_URL`; skips green without

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
gh pr merge --auto --squash --delete-branch
```

> **Auth check before push (CLAUDE.md §18.2):** `gh auth status` — `hicklax13` is a collaborator (push/PR/merge OK). Confirm `git config user.email` is Connor's. Auto-merge lands the PR once the four required checks pass. **Sequencing (B10):** cut this branch from `main` only _after_ PR-A has merged, so the CLAUDE.md count edits in Step 2 layer on PR-A's (which added `@cema/observability`).

---

## Troubleshooting (read if a task snags — do not block the mergeable core on the integration test)

- **`pnpm add workflow` 404s** → the package is `@vercel/workflow` (B1). Install that + the scoped vitest companion the docs name; rewrite `from 'workflow...'` imports accordingly; correct CLAUDE.md §4 (Task 6) to the real name.
- **`withWorkflow` import path differs** → match `node_modules/workflow/docs/getting-started/next.mdx`. Some versions export it from `workflow/next`, others want an options arg or an `npx workflow init`-generated route handler. Apply what the installed docs say and fold it into Task 1's commit.
- **`start` / `run.returnValue` shape differs** → match `node_modules/workflow/docs/api-reference/workflow-api/start.mdx`. If `returnValue` is loosely typed, cast: `(await run.returnValue) as IntakeResult`. If `start` wants an options object, adjust the call in Task 4 + the Task-5 test together.
- **`@workflow/vitest` fails to bundle the step dep graph** (`buildIntakeDeps → withRls → @cema/db` Neon driver) — **the highest residual risk (B11).** This blocks only the Task-5 integration test, which is **excluded from required CI**. The Task-3 orchestration unit test remains the authoritative behavioral guard. Options, in order: (a) confirm `.env.local` has `DATABASE_URL` (a missing var makes the suite skip, not fail); (b) if it's a true bundling error, reduce the integration test to assert the workflow resolves without the DB write, or defer it as an ADR-0013 carry-over; (c) do **not** add `@cema/db` to any sandbox/externalization list to "fix" it without understanding the cause — raise it instead. Merge the PR on the green required checks regardless.
- **Lint flags the directives** (B8) → single-line `eslint-disable-next-line` with the exact rule name from the error, directly above the directive. Never broaden.
- **`next build` asks for a backend/route registration** → that's a Task-1 docs item (getting-started); compilation itself should not need a running backend. If a build-time registration file is required, generate it per the docs and add it to Task 1.

---

## Self-Review (author's checklist — run after writing; not a step to delegate)

**Spec coverage** — PR-B goal = "wrap `runIntake` in a WDK durable workflow." Task 1 installs/wires WDK; Task 2 builds the three steps; Task 3 builds the orchestrating workflow (the behavioral heart); Task 4 adds the durable Server Action; Task 5 proves it end-to-end (Neon-gated); Task 6 documents (ADR 0013) + closes CLAUDE.md carry-over #3. The design doc's four PR-B decisions are each addressed: Decision 1 (durability) via Shape B with the divergence recorded; Decision 2 (sync contract) via `run.returnValue`; Decision 3 (idempotency, zero migrations) via step memoization; Decision 4 (OTel) explicitly sidestepped + carried over. ✅

**Type/signature consistency** — `intakeWorkflow(externalId, organizationId, actorUserId): Promise<IntakeResult>` is defined once (Task 3) and called with that exact arity in the Task-4 action and the Task-5 test. The three step signatures defined in Task 2 — `fetchAndEvaluateStep(externalId): Promise<{application; eligibility}>`, `emitEvaluatedStep({organizationId, actorUserId, externalId, eligible, reasons}): Promise<void>`, `createDealStep({organizationId, actorUserId, application}): Promise<{dealId; savings}>` — match exactly how the Task-3 workflow calls them and how the Task-3 test mocks them (`fetchAndEvaluateStep` returns `{application, eligibility}`; `createDealStep` resolves `{dealId, savings}`). Step arg/return types reference the real `@cema/agents-intake` exports (`NormalizedApplication`, `EligibilityResult`, `IneligibilityReason[]`, `SavingsEstimate`, `IntakeResult`) verified against `types.ts`. Seeding columns (`organizations` `{id, clerkOrgId, name, slug}`; `users` `{id, clerkUserId, email}`) match `intake-agent-rls.test.ts` verbatim. ✅

**Placeholder scan** — every code step shows a complete file or an exact before/after block; every run step has an exact command + expected outcome. The genuine version-specific unknowns (package name `workflow` vs `@vercel/workflow`; `withWorkflow` shape; `start`/`run.returnValue` typing; whether init/a route handler is needed) are each flagged with a "verify against the Task-1 bundled docs" gate and a concrete fallback — not left vague. ✅

**Mergeability** — required checks `{Lint, Typecheck, Unit tests, Build}` are all satisfiable with no env vars and no WDK backend (B8): the durable test is excluded from the default suite; the action/workflow are dormant; `next build` compiles without a backend. The de-risk build gate is front-loaded into Task 1. ✅
