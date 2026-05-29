# M11 PR-A: AI Gateway Adoption + `@cema/observability` Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route both of the repo's LLM call sites (the Intake Agent's savings narrative and `@cema/search`'s query classifier) through Vercel AI Gateway, trace those model calls as OpenTelemetry spans, and extract the shared `withChildSpan` helper into a new `@cema/observability` package.

**Architecture:** The repo is on AI SDK v4 (`ai@^4.0.0` + `@ai-sdk/anthropic@^1.0.0`). Native Gateway routing requires AI SDK v5+ (it returns a `LanguageModelV2`, which v4's `generateText`/`generateObject` reject). To stay on v4 — keeping this slice small and reversible — we route through the Gateway's **Anthropic-compatible Messages API** by pointing `createAnthropic({ baseURL, apiKey })` at `https://ai-gateway.vercel.sh/v1`. This is a one-line provider-construction change per call site, fully behind the existing env gate. Separately, instrumenting `@cema/search` makes it the **second** traced surface in the monorepo, which fires the ADR 0011 Decision 2 extraction trigger: we lift `withChildSpan` (and only that — minimal honest surface) out of the intake orchestrator into `@cema/observability`, with the `tracer` passed as a parameter so each package keeps its own instrumentation scope. Two new model-call spans (`intake.draft_narrative`, `search.classify_query`) carry PII-safe attributes only (model id + token counts + non-PII classifications), enforced by trace tests that mock the `ai` SDK.

**Tech Stack:** TypeScript (strict), Vercel AI SDK v4 (`ai`, `@ai-sdk/anthropic`), `@opentelemetry/api` (instrumentation), `@opentelemetry/sdk-trace-base` (test-only in-memory exporter), Vitest, pnpm workspaces + Turborepo.

---

## Background & Constraints (read before starting)

- **No SDK upgrade.** Do not bump `ai` or `@ai-sdk/anthropic`. The whole point of the baseURL approach is to avoid the v4→v5 migration. If you find yourself editing `generateText`/`generateObject` call shapes, stop — the only change is which provider instance is passed to `model:`.
- **AI SDK v4 usage field names.** `generateText`/`generateObject` return `usage: { promptTokens, completionTokens, totalTokens }`. (v5 renamed these to `inputTokens`/`outputTokens` — do **not** use those names here.)
- **PII on spans is forbidden (CLAUDE.md hard rule #3 / §10.3).** Spans are logs. Model spans may carry the model id, token counts, and non-PII classifications (`search.intent`, `search.confidence`) — **never** the query text, extracted entity values, borrower figures, or prompt/response bodies. The trace tests assert this with allowlists + substring denylists; do not weaken them.
- **Auth: API-key path only for this PR.** Use `AI_GATEWAY_API_KEY` → `createAnthropic({ apiKey })` (sent as `x-api-key`). OIDC keyless production auth is **deferred** — a baseURL override does not auto-read `VERCEL_OIDC_TOKEN` the way the native provider does. This is a documented carry-over in ADR 0012, not a gap to fix here.
- **Gate flip is intentional.** The narrative gate moves from `ANTHROPIC_API_KEY` to `AI_GATEWAY_API_KEY`. The classifier stays ungated (it has no env gate today and gains none).
- **Commits are signed.** Every commit uses `-S` and the co-author trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Local `git log --show-signature` printing "No signature" is a known SSH-signing display artifact — GitHub verifies server-side (CLAUDE.md §2).
- **Branch:** `feat/m11-ai-gateway-observability` off latest `main`.
- **Required CI checks:** exactly `{Lint, Typecheck, Unit tests, Build}`. `pnpm format:check` covers all `*.md` — run `pnpm format` before the final commit so this doc and the ADR don't trip Lint.

---

## File Structure

**New package — `packages/observability/`** (auto-discovered by `pnpm-workspace.yaml`'s `packages/*` glob):

- `packages/observability/package.json` — manifest for `@cema/observability`; deps `@opentelemetry/api`, devDeps mirror `@cema/cache` + `@opentelemetry/sdk-trace-base`.
- `packages/observability/tsconfig.json` — extends `@cema/config/tsconfig/node.json` (copy of the cache package's).
- `packages/observability/src/span.ts` — the lifted `withChildSpan<T>(tracer, name, fn)` helper. One responsibility: wrap one async boundary in a child span, record exceptions, end the span.
- `packages/observability/src/index.ts` — `export { withChildSpan } from './span';`.
- `packages/observability/src/span.test.ts` — unit tests for the helper using an in-memory exporter (no context manager needed).

**Modified — Intake Agent:**

- `packages/agents/intake/package.json` — `+ "@cema/observability": "workspace:*"` dependency.
- `packages/agents/intake/src/orchestrator.ts` — delete the local `withChildSpan` (lines 15–28), import it from `@cema/observability`, prepend `tracer,` to the three call sites.
- `packages/agents/intake/src/narrative.ts` — route through the Gateway provider; flip the gate to `AI_GATEWAY_API_KEY`; wrap the model call in an `intake.draft_narrative` span.
- `packages/agents/intake/src/narrative.trace.test.ts` — **new.** Mocks `ai`'s `generateText`; asserts the span name + PII-safe attribute allowlist.
- `packages/agents/intake/evals/savings-narrative.eval.ts` — update the gate check + the "must be set" error message from `ANTHROPIC_API_KEY` to `AI_GATEWAY_API_KEY`.

**Modified — Search:**

- `packages/search/package.json` — `+ @opentelemetry/api`, `+ @cema/observability` (deps); `+ @opentelemetry/sdk-trace-base` (devDep).
- `packages/search/src/classifier.ts` — route through the Gateway provider; wrap the model call in a `search.classify_query` span.
- `packages/search/src/classifier.trace.test.ts` — **new.** Mocks `ai`'s `generateObject`; asserts the span + that query text / entity values never appear as attributes + that the empty-query short-circuit produces no span.

**Modified — cross-cutting:**

- `.env.example` — correct the stale M5 comment (`AI_GATEWAY_API_KEY` already exists on line 53; it now powers both LLM surfaces).
- `CLAUDE.md` — §2 M10 carry-over #2 (AI-Gateway adoption) → RESOLVED; package count 19 → 20 (`+ @cema/observability`); the M10 narrative-routing sentence + "Next step" line updated; Changelog row. **PR-B is sequenced to branch off a `main` that already reads "20 packages" — this edit is the handoff it depends on (PR-B B10).**
- `docs/adr/0012-ai-gateway-adoption.md` — **new.** Records the decisions below.

---

## Task 1: Create the `@cema/observability` package

**Files:**

- Create: `packages/observability/package.json`
- Create: `packages/observability/tsconfig.json`
- Create: `packages/observability/src/span.ts`
- Create: `packages/observability/src/index.ts`
- Test: `packages/observability/src/span.test.ts`

> **Ordering note:** the manifest + `pnpm install` must come _before_ the test, or the test fails on "Cannot find package '@cema/observability'" (module resolution) instead of the intended "span.ts not implemented" reason. This is the one deliberate bend in the test-first rule — the scaffolding is infrastructure, not behavior.

- [ ] **Step 1: Create the package manifest**

Create `packages/observability/package.json`:

```json
{
  "name": "@cema/observability",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@opentelemetry/api": "^1.9.0"
  },
  "devDependencies": {
    "@cema/config": "workspace:*",
    "@opentelemetry/sdk-trace-base": "^2.0.0",
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create the tsconfig**

Create `packages/observability/tsconfig.json` (identical to the `@cema/cache` template):

```json
{
  "extends": "@cema/config/tsconfig/node.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "noEmit": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Install so the workspace links the new package**

Run: `pnpm install`
Expected: completes cleanly; `node_modules/@cema/observability` symlink now exists. (You may see `+ @cema/observability` or a lockfile update in the output.)

- [ ] **Step 4: Write the failing test**

Create `packages/observability/src/span.test.ts`:

```typescript
import { SpanStatusCode } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { withChildSpan } from './span';

describe('withChildSpan', () => {
  const exporter = new InMemorySpanExporter();
  // No context manager: each test starts one self-contained span and reads it
  // back from the exporter. startActiveSpan still creates + activates the span
  // for the callback; we just don't need parent/child nesting here.
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  let tracer: ReturnType<BasicTracerProvider['getTracer']>;

  beforeAll(() => {
    tracer = provider.getTracer('test');
  });

  afterEach(() => {
    exporter.reset();
  });

  it('runs fn inside a named span and returns its value', async () => {
    const result = await withChildSpan(tracer, 'unit.op', () => Promise.resolve(42));
    expect(result).toBe(42);

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]?.name).toBe('unit.op');
    expect(spans[0]?.status.code).toBe(SpanStatusCode.UNSET);
  });

  it('passes the live span to fn so it can set attributes', async () => {
    await withChildSpan(tracer, 'unit.attr', (span) => {
      span.setAttribute('unit.flag', true);
      return Promise.resolve();
    });

    const spans = exporter.getFinishedSpans();
    expect(spans[0]?.attributes['unit.flag']).toBe(true);
  });

  it('records the exception, marks ERROR, ends the span, and rethrows', async () => {
    await expect(
      withChildSpan(tracer, 'unit.boom', () => Promise.reject(new Error('kaboom'))),
    ).rejects.toThrow(/kaboom/);

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]?.status.code).toBe(SpanStatusCode.ERROR);
    expect(spans[0]?.events.some((e) => e.name === 'exception')).toBe(true);
    expect(spans[0]?.ended).toBe(true);
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `pnpm --filter @cema/observability test`
Expected: FAIL — `Failed to resolve import "./span"` / "Cannot find module './span'" (the implementation file does not exist yet).

- [ ] **Step 6: Write the minimal implementation**

Create `packages/observability/src/span.ts`:

```typescript
import { SpanStatusCode, type Span, type Tracer } from '@opentelemetry/api';

/**
 * Wrap one async boundary in a child span: record any exception on the span,
 * mark it ERROR, and always end it. Lifted verbatim from the Intake Agent's
 * orchestrator when `@cema/search` became the second instrumented surface
 * (ADR 0011 Decision 2 trigger). The `tracer` is a parameter — not a module
 * singleton — so each consumer keeps its own instrumentation scope; the active
 * `span` is handed to `fn` so model spans can set attributes without needing a
 * context manager wired up.
 */
export function withChildSpan<T>(
  tracer: Tracer,
  name: string,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    try {
      return await fn(span);
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      throw err;
    } finally {
      span.end();
    }
  });
}
```

- [ ] **Step 7: Create the barrel export**

Create `packages/observability/src/index.ts`:

```typescript
export { withChildSpan } from './span';
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm --filter @cema/observability test`
Expected: PASS — 3 tests green.

- [ ] **Step 9: Typecheck the new package**

Run: `pnpm --filter @cema/observability typecheck`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add packages/observability/package.json packages/observability/tsconfig.json packages/observability/src/span.ts packages/observability/src/index.ts packages/observability/src/span.test.ts pnpm-lock.yaml
git commit -S -m "$(cat <<'EOF'
feat(observability): extract withChildSpan into @cema/observability

ADR 0011 Decision 2 trigger fires now that @cema/search becomes the
second instrumented surface. Lift only withChildSpan (minimal honest
surface); tracer is a parameter so each package keeps its own scope,
and the live span is passed to the callback for attribute-setting.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Adopt `@cema/observability` in the Intake orchestrator

This is a **refactor-under-test**: the orchestrator's existing 82 tests (including the 6 in `orchestrator.trace.test.ts`) are the guard. No test changes — if they stay green, the extraction is behavior-preserving.

**Files:**

- Modify: `packages/agents/intake/package.json` (add dependency)
- Modify: `packages/agents/intake/src/orchestrator.ts:15-28` (remove local helper), `:60-62`, `:76-83`, `:93-95` (call sites)

- [ ] **Step 1: Add the workspace dependency**

In `packages/agents/intake/package.json`, add to `"dependencies"` (keep alphabetical: it sorts before `@opentelemetry/api`):

```json
    "@cema/observability": "workspace:*",
```

The resulting `"dependencies"` block:

```json
  "dependencies": {
    "@ai-sdk/anthropic": "^1.0.0",
    "@cema/observability": "workspace:*",
    "@opentelemetry/api": "^1.9.0",
    "ai": "^4.0.0"
  },
```

- [ ] **Step 2: Install to link the dependency**

Run: `pnpm install`
Expected: completes cleanly; `packages/agents/intake/node_modules/@cema/observability` symlink resolves.

- [ ] **Step 3: Run the intake tests to confirm the green baseline before refactoring**

Run: `pnpm --filter @cema/agents-intake test`
Expected: PASS — 82 tests across 7 files (this is the baseline the refactor must preserve).

- [ ] **Step 4: Remove the local helper and import the shared one**

In `packages/agents/intake/src/orchestrator.ts`, change the imports at the top. Replace:

```typescript
import { SpanStatusCode, type Span, trace } from '@opentelemetry/api';

import { checkEligibility } from './eligibility';
```

with:

```typescript
import { SpanStatusCode, type Span, trace } from '@opentelemetry/api';

import { withChildSpan } from '@cema/observability';

import { checkEligibility } from './eligibility';
```

Then **delete** the entire local `withChildSpan` definition (the doc comment + function, lines 15–28):

```typescript
/** Wrap one awaited boundary in a child span, recording failures on it before rethrow. */
function withChildSpan<T>(name: string, fn: () => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    try {
      return await fn();
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      throw err;
    } finally {
      span.end();
    }
  });
}
```

> The module-level `const tracer = trace.getTracer('@cema/agents-intake');` **stays** — `runIntake` still uses it for the parent `intake.run` span. `SpanStatusCode` and `Span` stay imported (still used in `runIntake`'s own try/catch and signature).

- [ ] **Step 5: Update the three call sites to pass the tracer**

The shared helper's signature is `withChildSpan(tracer, name, fn)` and `fn` now receives the span. The three intake call sites don't use the span argument, so the only change is prepending `tracer,`.

At `orchestrator.ts` ~line 60, change:

```typescript
const application = await withChildSpan('intake.fetch_application', () =>
  deps.adapter.getApplication(externalId),
);
```

to:

```typescript
const application = await withChildSpan(tracer, 'intake.fetch_application', () =>
  deps.adapter.getApplication(externalId),
);
```

At ~line 76, change:

```typescript
      await withChildSpan('intake.emit_audit', () =>
        deps.emitAudit({
```

to:

```typescript
      await withChildSpan(tracer, 'intake.emit_audit', () =>
        deps.emitAudit({
```

At ~line 93, change:

```typescript
const { dealId } = await withChildSpan('intake.create_deal', () =>
  deps.createDeal({ application, savings }),
);
```

to:

```typescript
const { dealId } = await withChildSpan(tracer, 'intake.create_deal', () =>
  deps.createDeal({ application, savings }),
);
```

> The callbacks `() => deps.adapter.getApplication(...)` stay zero-arg — the new `fn: (span) => ...` signature is satisfied by a function that simply ignores the span. No other edits.

- [ ] **Step 6: Run the intake tests to verify behavior is preserved**

Run: `pnpm --filter @cema/agents-intake test`
Expected: PASS — same 82 tests green. In particular `orchestrator.trace.test.ts` still sees `intake.run` + 3 child spans nesting correctly, proving the shared helper behaves identically to the deleted local one.

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @cema/agents-intake typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/agents/intake/package.json packages/agents/intake/src/orchestrator.ts pnpm-lock.yaml
git commit -S -m "$(cat <<'EOF'
refactor(intake): use @cema/observability withChildSpan

Replace the orchestrator's local withChildSpan with the extracted shared
helper, passing the package tracer explicitly. The 82 intake tests
(incl. orchestrator.trace.test.ts) are the refactor guard — no test
changes, behavior preserved.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Route the Intake narrative through the Gateway + flip the gate + add the `intake.draft_narrative` span

> **Flagged unknown (carry to ADR 0012):** `GATEWAY_MODEL = 'anthropic/claude-sonnet-4.6'` is the creator/model slug for the Gateway catalog. It cannot be verified until `AI_GATEWAY_API_KEY` is provisioned (a Connor-owned gating item). The direct-provider id is `claude-sonnet-4-6` (dashes). If the live catalog rejects the slug, this single `const` is the only thing to change — the trace test asserts the _configured_ value, not a live call, so it stays green regardless.

> **Import ordering:** the repo separates third-party imports from relative imports with a blank line (see the original `narrative.ts`). Group new imports third-party → `@cema/*` → relative. If `pnpm lint` reports a different `import/order`, the ordering is not load-bearing — re-run lint with `--fix`.

**Files:**

- Modify: `packages/agents/intake/src/narrative.ts` (full rewrite below)
- Test: `packages/agents/intake/src/narrative.trace.test.ts` (new)
- Modify: `packages/agents/intake/src/narrative.test.ts` (**gap fix** — the existing 10-test suite stubs `ANTHROPIC_API_KEY` and mocks the old `anthropic` export; both must flip with the rewrite. See Step 4b.)
- Modify: `packages/agents/intake/evals/run.mjs:5,16` (skip-gate)
- Modify: `packages/agents/intake/evals/savings-narrative.eval.ts:40-45` (null-check message)

- [ ] **Step 1: Write the failing trace test**

Create `packages/agents/intake/src/narrative.trace.test.ts`:

```typescript
import { trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { generateText } from 'ai';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { draftSavingsNarrative, isLlmConfigured } from './narrative';
import type { NormalizedApplication, SavingsEstimate } from './types';

// Mock the model call (no network) and the prompt builder (no fixture needed —
// the prompt never reaches the span, so its contents are irrelevant to this test).
vi.mock('ai', () => ({ generateText: vi.fn() }));
vi.mock('./prompts/savings-narrative', () => ({
  buildSavingsNarrativePrompt: () => 'PROMPT (carries borrower figures; never reaches a span)',
}));

/** Dollar-field substrings that must never appear as a span attribute key (hard rule #3). */
const FORBIDDEN_KEY_SUBSTRINGS = [
  'existingUpb',
  'existing_upb',
  'newLoanAmount',
  'new_loan_amount',
  'assignedUpb',
  'assigned_upb',
  'appliedRate',
  'applied_rate',
  'taxSaved',
  'tax_saved',
  'fees',
  'netSavings',
  'net_savings',
];

describe('draftSavingsNarrative tracing', () => {
  const exporter = new InMemorySpanExporter();
  // No context manager: a single, self-contained span per call — startActiveSpan
  // still hands the live span to the callback (which is what we assert on).
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });

  beforeAll(() => {
    process.env.AI_GATEWAY_API_KEY = 'test-key';
    trace.setGlobalTracerProvider(provider);
  });

  afterEach(() => {
    exporter.reset();
    vi.mocked(generateText).mockReset();
  });

  afterAll(async () => {
    await provider.shutdown();
    trace.disable();
    delete process.env.AI_GATEWAY_API_KEY;
  });

  it('reads the gate from AI_GATEWAY_API_KEY', () => {
    expect(isLlmConfigured()).toBe(true);
  });

  it('emits intake.draft_narrative with model + token attributes only', async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: '  Your CEMA could save you on recording tax.  ',
      usage: { promptTokens: 120, completionTokens: 60, totalTokens: 180 },
    } as never);

    const out = await draftSavingsNarrative({} as NormalizedApplication, {} as SavingsEstimate);
    expect(out).toBe('Your CEMA could save you on recording tax.');

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const span = spans[0];
    expect(span?.name).toBe('intake.draft_narrative');
    expect(span?.attributes['gen_ai.request.model']).toBe('anthropic/claude-sonnet-4.6');
    expect(span?.attributes['gen_ai.usage.input_tokens']).toBe(120);
    expect(span?.attributes['gen_ai.usage.output_tokens']).toBe(60);

    // Key allowlist + dollar-figure denylist.
    const allowed = new Set([
      'gen_ai.request.model',
      'gen_ai.usage.input_tokens',
      'gen_ai.usage.output_tokens',
    ]);
    for (const key of Object.keys(span?.attributes ?? {})) {
      expect(allowed.has(key), `unexpected attribute "${key}"`).toBe(true);
      for (const forbidden of FORBIDDEN_KEY_SUBSTRINGS) {
        expect(key.includes(forbidden), `PII key "${key}"`).toBe(false);
      }
    }
    // The model's output text must never be attached as an attribute value.
    for (const value of Object.values(span?.attributes ?? {}).map(String)) {
      expect(value.includes('save you on recording tax')).toBe(false);
    }
  });

  it('returns null and opens no span when the gate is off', async () => {
    delete process.env.AI_GATEWAY_API_KEY;
    const out = await draftSavingsNarrative({} as NormalizedApplication, {} as SavingsEstimate);
    expect(out).toBeNull();
    expect(exporter.getFinishedSpans()).toHaveLength(0);
    expect(vi.mocked(generateText)).not.toHaveBeenCalled();
    process.env.AI_GATEWAY_API_KEY = 'test-key'; // restore for afterAll symmetry
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @cema/agents-intake test narrative.trace`
Expected: FAIL — the span is named differently / does not exist and the gate still reads `ANTHROPIC_API_KEY`, so `isLlmConfigured()` is `false` under `AI_GATEWAY_API_KEY` (assertions fail). (`generateText` is mocked, so no network call occurs.)

- [ ] **Step 3: Rewrite `narrative.ts`**

Replace the entire contents of `packages/agents/intake/src/narrative.ts` with:

```typescript
/**
 * Borrower-facing CEMA savings narrative (spec §9.3 step 6, plan Task 7).
 *
 * This is the ONLY LLM-using surface of the Intake Agent — eligibility and
 * savings stay deterministic (legal correctness over model judgment). The
 * narrative is additive and env-gated: when no Gateway key is configured the
 * agent runs end-to-end and simply emits no narrative (plan Decision 3).
 *
 * Routed through the Vercel AI Gateway's Anthropic-compatible Messages API
 * (ADR 0012): `createAnthropic` points at the Gateway baseURL so we keep AI SDK
 * v4 (native Gateway routing requires v5+). The model call is wrapped in an
 * `intake.draft_narrative` span carrying only the model id + token counts —
 * never the prompt, the response, or any borrower figure (hard rule #3).
 */

import { createAnthropic } from '@ai-sdk/anthropic';
import { trace } from '@opentelemetry/api';
import { generateText } from 'ai';

import { withChildSpan } from '@cema/observability';

import { buildSavingsNarrativePrompt } from './prompts/savings-narrative';
import type { NormalizedApplication, SavingsEstimate } from './types';

/** Vercel AI Gateway, Anthropic-compatible endpoint (provider baseURL convention → `/v1`). */
const GATEWAY_BASE_URL = 'https://ai-gateway.vercel.sh/v1';

/**
 * Gateway model slug (creator/model form). Confirm against the live Gateway model
 * catalog once `AI_GATEWAY_API_KEY` is provisioned — the catalog slug may differ
 * (the direct-provider id is `claude-sonnet-4-6`, dashes). See ADR 0012 carry-over.
 */
const GATEWAY_MODEL = 'anthropic/claude-sonnet-4.6';

const tracer = trace.getTracer('@cema/agents-intake');

/** True when a Gateway key is present — the gate that turns narrative drafting on. */
export function isLlmConfigured(): boolean {
  return !!process.env.AI_GATEWAY_API_KEY;
}

/**
 * Draft a plain-language savings narrative for an eligible application.
 *
 * Returns `null` ONLY when the LLM is unconfigured (the narrative is an optional
 * enhancement, never a hard dependency). A configured-but-failed model call is
 * allowed to throw — `null` means "off", not "broken" — so the caller at the app
 * boundary can record the failure (e.g. Sentry) instead of silently dropping it.
 */
export async function draftSavingsNarrative(
  application: NormalizedApplication,
  savings: SavingsEstimate,
): Promise<string | null> {
  if (!isLlmConfigured()) {
    return null;
  }

  return withChildSpan(tracer, 'intake.draft_narrative', async (span) => {
    span.setAttribute('gen_ai.request.model', GATEWAY_MODEL);

    const gateway = createAnthropic({
      baseURL: GATEWAY_BASE_URL,
      apiKey: process.env.AI_GATEWAY_API_KEY,
    });

    const { text, usage } = await generateText({
      model: gateway(GATEWAY_MODEL),
      prompt: buildSavingsNarrativePrompt(application, savings),
    });

    if (usage) {
      span.setAttribute('gen_ai.usage.input_tokens', usage.promptTokens);
      span.setAttribute('gen_ai.usage.output_tokens', usage.completionTokens);
    }

    return text.trim();
  });
}
```

- [ ] **Step 4: Run the trace test to verify it passes**

Run: `pnpm --filter @cema/agents-intake test narrative.trace`
Expected: PASS — 3 tests green.

- [ ] **Step 4b: Gap fix — update the existing `narrative.test.ts`**

The original 10-test `narrative.test.ts` predates this rewrite: it stubs `ANTHROPIC_API_KEY` and mocks the SDK's old `anthropic` export. The rewrite breaks both, so make two coordinated edits:

1. **Mock:** swap the `@ai-sdk/anthropic` mock from `anthropic` to the two-level `createAnthropic` factory the new code calls (`createAnthropic(config)` → `gateway(modelId)` → model object):

```typescript
vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => () => ({ modelId: 'anthropic/claude-sonnet-4.6' })),
}));
```

2. **Gate env var:** flip every `vi.stubEnv('ANTHROPIC_API_KEY', …)` → `vi.stubEnv('AI_GATEWAY_API_KEY', …)` (2 in the `isLlmConfigured` block, 4 in the `draftSavingsNarrative` block) and update the two `isLlmConfigured` test titles to name `AI_GATEWAY_API_KEY`. The 4 `buildSavingsNarrativePrompt` tests are unchanged (no model key, no SDK).

Re-run `pnpm --filter @cema/agents-intake test narrative` → 13 green (10 + 3).

- [ ] **Step 5: Flip the eval skip-gate in `run.mjs`**

In `packages/agents/intake/evals/run.mjs`, change line 16:

```javascript
const REQUIRED_KEYS = ['BRAINTRUST_API_KEY', 'ANTHROPIC_API_KEY'];
```

to:

```javascript
const REQUIRED_KEYS = ['BRAINTRUST_API_KEY', 'AI_GATEWAY_API_KEY'];
```

And update the doc comment on line 5:

```javascript
 * The eval makes a live model call (ANTHROPIC_API_KEY) AND logs to Braintrust
```

to:

```javascript
 * The eval makes a live model call (AI_GATEWAY_API_KEY) AND logs to Braintrust
```

- [ ] **Step 6: Flip the null-check message in `savings-narrative.eval.ts`**

In `packages/agents/intake/evals/savings-narrative.eval.ts`, replace the comment + error (lines 40-45):

```typescript
// run.mjs guarantees ANTHROPIC_API_KEY is set before this file executes, so a
// null here is misconfiguration — not the "LLM intentionally off" signal that
// null means in the deterministic write path.
throw new Error(
  'draftSavingsNarrative returned null — ANTHROPIC_API_KEY must be set to run this eval.',
);
```

with:

```typescript
// run.mjs guarantees AI_GATEWAY_API_KEY is set before this file executes, so a
// null here is misconfiguration — not the "LLM intentionally off" signal that
// null means in the deterministic write path.
throw new Error(
  'draftSavingsNarrative returned null — AI_GATEWAY_API_KEY must be set to run this eval.',
);
```

- [ ] **Step 7: Run the full intake package test suite**

Run: `pnpm --filter @cema/agents-intake test`
Expected: PASS — 85 tests (the prior 82 + 3 new narrative-trace tests). The existing `scorers.test.ts` is unaffected (pure functions, no model key).

- [ ] **Step 8: Typecheck**

Run: `pnpm --filter @cema/agents-intake typecheck`
Expected: no errors. (`createAnthropic` returns a v1 provider whose `gateway(modelId)` yields a `LanguageModelV1` — accepted by `ai@4`'s `generateText`.)

- [ ] **Step 9: Commit**

```bash
git add packages/agents/intake/src/narrative.ts packages/agents/intake/src/narrative.trace.test.ts packages/agents/intake/src/narrative.test.ts packages/agents/intake/evals/run.mjs packages/agents/intake/evals/savings-narrative.eval.ts
git commit -S -m "$(cat <<'EOF'
feat(intake): route savings narrative through AI Gateway + trace the model call

createAnthropic points at the Gateway's Anthropic-compatible endpoint
(keeps AI SDK v4; native routing needs v5). Gate flips ANTHROPIC_API_KEY
-> AI_GATEWAY_API_KEY across narrative.ts, its unit test, run.mjs, and
the eval message. New intake.draft_narrative span carries model id +
token counts only (no prompt/response/figures); narrative.trace.test.ts
enforces the PII-safe allowlist.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Route the Search classifier through the Gateway + add the `search.classify_query` span

`@cema/search` becomes the **second** instrumented surface — the change that justified Task 1's extraction. The classifier is **ungated** (it has no env gate today and gains none): an unconfigured key throws at call time, exactly as the direct provider did.

**Files:**

- Modify: `packages/search/package.json` (add deps)
- Modify: `packages/search/src/classifier.ts` (full rewrite below)
- Test: `packages/search/src/classifier.trace.test.ts` (new)
- Modify: `packages/search/src/classifier.test.ts` (**gap fix** — the existing 4-test suite mocks the old `anthropic` export; it must swap to the `createAnthropic` factory. No env flip: the classifier is ungated, so these tests never stubbed a key. See Step 5b.)

- [ ] **Step 1: Add dependencies to `packages/search/package.json`**

Set `"dependencies"` and `"devDependencies"` to:

```json
  "dependencies": {
    "ai": "^4.0.0",
    "@ai-sdk/anthropic": "^1.0.0",
    "@cema/observability": "workspace:*",
    "@opentelemetry/api": "^1.9.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@cema/config": "workspace:*",
    "@opentelemetry/sdk-trace-base": "^2.0.0",
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
```

- [ ] **Step 2: Install to link the new deps**

Run: `pnpm install`
Expected: completes cleanly; `@cema/observability`, `@opentelemetry/api`, and the `@opentelemetry/sdk-trace-base` devDep resolve in `packages/search`.

- [ ] **Step 3: Write the failing trace test**

Create `packages/search/src/classifier.trace.test.ts`:

```typescript
import { trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { generateObject } from 'ai';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { classifyQueryIntent } from './classifier';

vi.mock('ai', () => ({ generateObject: vi.fn() }));

describe('classifyQueryIntent tracing', () => {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });

  beforeAll(() => {
    process.env.AI_GATEWAY_API_KEY = 'test-key';
    trace.setGlobalTracerProvider(provider);
  });

  afterEach(() => {
    exporter.reset();
    vi.mocked(generateObject).mockReset();
  });

  afterAll(async () => {
    await provider.shutdown();
    trace.disable();
    delete process.env.AI_GATEWAY_API_KEY;
  });

  it('emits search.classify_query with only non-PII attributes', async () => {
    vi.mocked(generateObject).mockResolvedValue({
      object: {
        intent: 'action',
        confidence: 0.92,
        entities: [{ value: 'Acme Holdings LLC', type: 'org' }],
      },
    } as never);

    const query = 'call the borrower at Acme Holdings LLC tomorrow';
    const result = await classifyQueryIntent(query);
    expect(result.intent).toBe('action');

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const span = spans[0];
    expect(span?.name).toBe('search.classify_query');
    expect(span?.attributes['gen_ai.request.model']).toBe('anthropic/claude-sonnet-4.6');
    expect(span?.attributes['search.intent']).toBe('action');
    expect(span?.attributes['search.confidence']).toBe(0.92);

    // Exactly the three vetted keys — nothing else.
    expect(new Set(Object.keys(span?.attributes ?? {}))).toEqual(
      new Set(['gen_ai.request.model', 'search.intent', 'search.confidence']),
    );

    // PII guard: neither the raw query nor any extracted entity value may appear
    // as an attribute value (spans are logs — hard rule #3).
    for (const value of Object.values(span?.attributes ?? {}).map(String)) {
      expect(value.includes(query)).toBe(false);
      expect(value.includes('Acme Holdings LLC')).toBe(false);
    }
  });

  it('short-circuits an empty query without opening a span', async () => {
    const result = await classifyQueryIntent('   ');
    expect(result).toEqual({ intent: 'search', confidence: 1, entities: [] });
    expect(exporter.getFinishedSpans()).toHaveLength(0);
    expect(vi.mocked(generateObject)).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm --filter @cema/search test classifier.trace`
Expected: FAIL — no `search.classify_query` span is emitted yet (the current classifier creates no span), so `spans` is empty.

- [ ] **Step 5: Rewrite `classifier.ts`**

Replace the entire contents of `packages/search/src/classifier.ts` with:

```typescript
import { createAnthropic } from '@ai-sdk/anthropic';
import { trace } from '@opentelemetry/api';
import { generateObject } from 'ai';
import { z } from 'zod';

import { withChildSpan } from '@cema/observability';

/** Vercel AI Gateway, Anthropic-compatible endpoint (ADR 0012) — keeps us on AI SDK v4. */
const GATEWAY_BASE_URL = 'https://ai-gateway.vercel.sh/v1';

/** Confirm against the live Gateway catalog once provisioned (ADR 0012 carry-over). */
const GATEWAY_MODEL = 'anthropic/claude-sonnet-4.6';

const tracer = trace.getTracer('@cema/search');

export type QueryIntent = 'search' | 'action' | 'analytics';

export interface QueryClassification {
  intent: QueryIntent;
  confidence: number;
  entities: Array<{ value: string; type: 'org' | 'person' | 'date' | 'deal' | 'other' }>;
}

const ClassificationSchema = z.object({
  intent: z.enum(['search', 'action', 'analytics']),
  confidence: z.number().min(0).max(1),
  entities: z.array(
    z.object({
      value: z.string(),
      type: z.enum(['org', 'person', 'date', 'deal', 'other']),
    }),
  ),
});

export async function classifyQueryIntent(query: string): Promise<QueryClassification> {
  if (!query.trim()) {
    return { intent: 'search', confidence: 1, entities: [] };
  }

  return withChildSpan(tracer, 'search.classify_query', async (span) => {
    span.setAttribute('gen_ai.request.model', GATEWAY_MODEL);

    const gateway = createAnthropic({
      baseURL: GATEWAY_BASE_URL,
      apiKey: process.env.AI_GATEWAY_API_KEY,
    });

    const result = await generateObject({
      model: gateway(GATEWAY_MODEL),
      schema: ClassificationSchema,
      prompt: `You are classifying a query against a CEMA mortgage processor workspace.

Classify into one of:
  - "search": find existing communications, documents, contacts, or deals
  - "action": perform an operation (call, send email, schedule)
  - "analytics": aggregate data (counts, averages, trends)

Extract named entities.

Query: ${query}

Respond with a JSON object matching the schema. Most queries are 'search'.`,
    });

    // Only the non-PII classification lands on the span — never the query text
    // or the extracted entity values (hard rule #3 / spans are logs).
    span.setAttribute('search.intent', result.object.intent);
    span.setAttribute('search.confidence', result.object.confidence);

    return result.object;
  });
}
```

- [ ] **Step 5b: Gap fix — update the existing `classifier.test.ts`**

The original 4-test `classifier.test.ts` mocks the SDK's old `anthropic` export; the rewrite calls `createAnthropic` instead, so swap the mock to the two-level factory. The `generateObject` mock and all four assertions are unchanged (no env stub — the classifier is ungated):

```typescript
vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => () => ({ modelId: 'anthropic/claude-sonnet-4.6' })),
}));
```

Re-run `pnpm --filter @cema/search test classifier` → both files green (4 unit + 2 trace).

- [ ] **Step 6: Run the trace test to verify it passes**

Run: `pnpm --filter @cema/search test classifier.trace`
Expected: PASS — 2 tests green (span emitted with the allowlisted attributes; empty-query short-circuit emits no span).

- [ ] **Step 7: Run the full search package suite + typecheck**

Run: `pnpm --filter @cema/search test && pnpm --filter @cema/search typecheck`
Expected: PASS — all search tests green, no type errors.

- [ ] **Step 8: Commit**

```bash
git add packages/search/package.json packages/search/src/classifier.ts packages/search/src/classifier.trace.test.ts packages/search/src/classifier.test.ts pnpm-lock.yaml
git commit -S -m "$(cat <<'EOF'
feat(search): route query classifier through AI Gateway + trace it

Second instrumented surface (the @cema/observability extraction trigger):
classifyQueryIntent now routes via the Gateway's Anthropic-compatible
endpoint and emits a search.classify_query span carrying only model id +
intent + confidence. classifier.trace.test.ts proves the query text and
extracted entity values never land on the span, and that the empty-query
short-circuit stays span-less.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Cross-cutting — `.env.example` comment, ADR 0012, full-suite gate

**Files:**

- Modify: `.env.example:52-55` (fix the stale M5 comment)
- Modify: `CLAUDE.md` (§2 carry-over #2 → RESOLVED, package count 19→20, narrative sentence, Next-step line, Changelog row)
- Create: `docs/adr/0012-ai-gateway-adoption.md`

- [ ] **Step 1: Fix the stale `.env.example` comment**

`AI_GATEWAY_API_KEY` already exists on line 53; the M5 comment on line 55 is now wrong (the classifier no longer uses `ANTHROPIC_API_KEY` directly). Replace lines 52-55:

```bash
# ─── AI Gateway + Providers ─────────────────────────────────────
AI_GATEWAY_API_KEY=
ANTHROPIC_API_KEY=
# M5: ANTHROPIC_API_KEY powers @cema/search query classifier (claude-sonnet-4-6)
```

with:

```bash
# ─── AI Gateway + Providers ─────────────────────────────────────
# AI_GATEWAY_API_KEY routes BOTH LLM surfaces — the Intake savings narrative and
# the @cema/search query classifier — through the Vercel AI Gateway's
# Anthropic-compatible endpoint (ADR 0012). Sent as the x-api-key header.
AI_GATEWAY_API_KEY=
# ANTHROPIC_API_KEY is no longer read by app code post-ADR-0012 (the Gateway holds
# the upstream provider credential); kept for direct-provider fallback / debugging.
ANTHROPIC_API_KEY=
```

- [ ] **Step 2: Write ADR 0012**

Create `docs/adr/0012-ai-gateway-adoption.md`:

```markdown
# ADR 0012: AI Gateway adoption + model-call tracing + `@cema/observability`

**Status:** Accepted (shipped 2026-05-29)
**Author:** M11 PR-A (Claude Opus 4.8 + Connor Hickey)
**Supersedes:** None
**Superseded by:** None
**Relates to:** ADR 0010 carry-over #2 (AI-Gateway adoption); ADR 0011 Decision 2 (`@cema/observability` extraction trigger)

---

## Context

ADR 0010 shipped the Intake Agent with its savings narrative calling Anthropic
**directly** (`anthropic('claude-sonnet-4-6')` on `ANTHROPIC_API_KEY`) — a flagged,
reversible deviation from CLAUDE.md §4, which mandates all model calls route through
the **Vercel AI Gateway** (model routing, cost tracking, failover). The repo's only
other LLM call site — `@cema/search`'s query classifier — has the same deviation.
This slice pays both down and, because instrumenting `@cema/search` makes it the
**second** traced surface, it also fires the ADR 0011 Decision 2 extraction trigger.

---

## Decision

### 1. Route via the Gateway's Anthropic-compatible endpoint — no AI SDK upgrade

The repo is on **AI SDK v4** (`ai@^4.0.0` + `@ai-sdk/anthropic@^1.0.0`). Native
Gateway routing (a bare `'anthropic/...'` model string, or the `@ai-sdk/gateway`
provider) returns a `LanguageModelV2`, which v4's `generateText`/`generateObject`
reject — it needs **AI SDK v5+**. Rather than balloon this slice into a 4→5
migration, we route through the Gateway's **Anthropic-compatible Messages API** by
pointing `createAnthropic({ baseURL: 'https://ai-gateway.vercel.sh/v1', apiKey })`
at the Gateway. The call shape is unchanged; only the provider instance differs.
This delivers PR-A's goal (centralized routing + cost tracking + Vercel
Observability) at the cost of one `const` per call site.

### 2. API-key auth now; OIDC deferred

Auth uses `AI_GATEWAY_API_KEY` → `createAnthropic({ apiKey })` (sent as `x-api-key`).
The Gateway also supports keyless **OIDC** (`VERCEL_OIDC_TOKEN`) in production, but a
`baseURL` override does not auto-read that token the way the native provider does.
OIDC is deferred to the eventual AI SDK v5/v6 upgrade (carry-over below).

### 3. Model calls are traced; attributes are PII-safe

Each call site wraps its model call in a child span — `intake.draft_narrative` and
`search.classify_query` — via the shared `withChildSpan` helper. Attributes follow
the OpenTelemetry GenAI semantic conventions and carry **only** non-PII signal:
`gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`,
and (classifier only) `search.intent` + `search.confidence`. They **never** carry
the prompt, the response text, the raw query, or extracted entity values. Two trace
tests enforce this with key allowlists + value/substring denylists — the same
executable-contract pattern as `orchestrator.trace.test.ts` (ADR 0011 Decision 4).

### 4. `@cema/observability` extracted (the 20th workspace package)

ADR 0011 Decision 2 set the trigger: extract the shared tracing helper when a
**second** package needs instrumentation. That moment is now. We lift **only**
`withChildSpan` (minimal honest surface) into `packages/observability`, with the
`tracer` passed as a parameter (each package keeps its own instrumentation scope)
and the live `span` handed to the callback (so model spans set attributes without a
context manager). The intake orchestrator's 82 tests are the refactor guard.

The Gateway-provider construction stays **inline** at each call site (no premature
`@cema/ai` package) — extract that on the _third_ consumer, mirroring this trigger.

---

## What shipped

| File                                                                                            | Change                                                                                           |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `packages/observability/{package.json,tsconfig.json,src/span.ts,src/index.ts,src/span.test.ts}` | **New.** `@cema/observability` — `withChildSpan(tracer, name, fn)` + 3 unit tests                |
| `packages/agents/intake/src/orchestrator.ts`                                                    | Local `withChildSpan` removed; imported from `@cema/observability`; 3 call sites pass `tracer`   |
| `packages/agents/intake/src/narrative.ts`                                                       | Gateway provider; gate `ANTHROPIC_API_KEY` → `AI_GATEWAY_API_KEY`; `intake.draft_narrative` span |
| `packages/agents/intake/src/narrative.trace.test.ts`                                            | **New.** 3 tests: gate, span + allowlist, gate-off no-span                                       |
| `packages/agents/intake/evals/{run.mjs,savings-narrative.eval.ts}`                              | Skip-gate + null-check message flipped to `AI_GATEWAY_API_KEY`                                   |
| `packages/search/src/classifier.ts`                                                             | Gateway provider; `search.classify_query` span                                                   |
| `packages/search/src/classifier.trace.test.ts`                                                  | **New.** 2 tests: span + PII guard, empty-query no-span                                          |
| `packages/search/package.json`, `packages/agents/intake/package.json`                           | `+ @cema/observability`; search `+ @opentelemetry/api` + sdk-trace-base devDep                   |
| `.env.example`                                                                                  | M5 comment corrected — `AI_GATEWAY_API_KEY` now powers both LLM surfaces                         |

No new DB migrations.

---

## Consequences

**Positive**

- CLAUDE.md §4's "route via the Gateway" mandate is satisfied for both LLM call sites; cost/usage now lands in Vercel Observability.
- Model calls are traced PII-safely, enforced by test.
- `@cema/observability` exists for the next instrumented surface at the cost of an import.

**Negative / tradeoffs**

- The compatibility-endpoint path is not the SDK-native provider; it carries no automatic OIDC and no provider-agnostic model strings until the AI SDK v5/v6 upgrade.
- The Gateway is inert without `AI_GATEWAY_API_KEY` — narrative is gated off; the classifier throws if called unconfigured (unchanged from the direct-provider behavior).
- A duplicated `createAnthropic({ baseURL, apiKey })` block lives at two call sites until a third consumer justifies an `@cema/ai` wrapper.

---

## Carry-overs

1. **Verify `GATEWAY_MODEL` against the live catalog** once `AI_GATEWAY_API_KEY` is provisioned — the slug `anthropic/claude-sonnet-4.6` is unconfirmed (direct-provider id is `claude-sonnet-4-6`).
2. **Native Gateway provider on the AI SDK v5/v6 upgrade** — drop the baseURL shim for the first-class provider; adopt OIDC keyless auth then.
3. **WDK wrap (M11 PR-B)** — the durable-workflow wrap of `runIntake` is a separate, sequenced slice.
```

- [ ] **Step 3: Update CLAUDE.md §2 (status, carry-over #2, package count, Changelog)**

Every shipped slice keeps CLAUDE.md §2 honest and appends a Changelog row (see the M8/M9/M10/ADR-0011 rows). PR-A resolves ADR 0010 carry-over #2 and adds the 20th package, so §2 must say so — and **M11 PR-B is sequenced to branch off a `main` that already reads "20 packages"**, so this edit is the handoff PR-B depends on (PR-B background-constraint B10).

> **Read each target line first, then edit in place.** §2 is dense and may have drifted since this plan was written; match the live string, not the snapshot below.

**(a) Package count** — the `- **Code:**` line. Replace:

```text
- **Code:** 19 workspace packages (added `@cema/agents-intake` in M10) + 1 Next.js 16 app.
```

with:

```text
- **Code:** 20 workspace packages (added `@cema/agents-intake` in M10, `@cema/observability` in M11 PR-A) + 1 Next.js 16 app.
```

**(b) M10 carry-over #2** — mark it RESOLVED. Replace:

```text
  2. **AI-Gateway adoption slice:** route `draftSavingsNarrative` + the `@cema/search` query classifier through Vercel AI Gateway (spec §4 — model routing/cost/failover); both call `anthropic(...)` directly today. Reversible one-line change per call site behind the existing gate.
```

with:

```text
  2. **AI-Gateway adoption slice — RESOLVED (2026-05-29, ADR 0012).** Both LLM call sites (`draftSavingsNarrative` + the `@cema/search` query classifier) now route through the Vercel AI Gateway's Anthropic-compatible endpoint (`createAnthropic({ baseURL: 'https://ai-gateway.vercel.sh/v1' })` — keeps AI SDK v4; native `provider/model` routing needs v5). Both model calls are traced (`intake.draft_narrative`, `search.classify_query`, PII-safe). The narrative gate flipped `ANTHROPIC_API_KEY` → `AI_GATEWAY_API_KEY`. Still open: confirm the `anthropic/claude-sonnet-4.6` Gateway slug against the live catalog once `AI_GATEWAY_API_KEY` is provisioned; adopt the native Gateway provider + OIDC on the AI SDK v5/v6 upgrade.
```

**(c) M10 narrative sentence** (inside the M10 status paragraph). Replace:

```text
The **only** LLM surface is an additive, env-gated borrower savings narrative (`draftSavingsNarrative` via the **direct `anthropic('claude-sonnet-4-6')` provider** on `ANTHROPIC_API_KEY`, NOT AI Gateway — a flagged reversible deviation; `null` = off, configured-but-failed = throws).
```

with:

```text
The **only** LLM surface is an additive, env-gated borrower savings narrative (`draftSavingsNarrative`), routed through the **Vercel AI Gateway** on `AI_GATEWAY_API_KEY` as of M11 PR-A / ADR 0012 (`null` = off, configured-but-failed = throws).
```

**(d) Next-step clause** — leave the trailing `(**OTel tracing is now wired** …)` parenthetical intact; replace only this leading sentence:

```text
- **Next step:** M10 is closed; **M11 is not yet planned.** The highest-value follow-ups from ADR 0010 (do before/alongside M11): the **AI-Gateway adoption slice** (route the intake narrative + `@cema/search`'s classifier through the Gateway per spec §4 — both call the provider directly today); the **WDK wrap** once `@vercel/workflow` is installed.
```

with:

```text
- **Next step:** M10 is closed; **M11 is underway** (platform-debt paydown, ADR 0010 carry-overs #2 + #3, sequenced as two PRs). **M11 PR-A shipped** the **AI-Gateway adoption slice** (ADR 0012 — both LLM call sites now route through the Gateway, traced). Remaining: **M11 PR-B** — the **WDK durable wrap** of `runIntake` once `@vercel/workflow` is installed.
```

**(e) Changelog row** — append after the last existing row (the 2026-05-29 ADR-0011 row):

```text
| 2026-05-29 | M11 PR-A shipped (ADR 0012): both LLM call sites (intake savings narrative + `@cema/search` classifier) routed through the Vercel AI Gateway's Anthropic-compatible endpoint (AI SDK v4 retained); both model calls traced (`intake.draft_narrative`, `search.classify_query`, PII-safe); `withChildSpan` extracted into the new `@cema/observability` (20th package); narrative gate flipped `ANTHROPIC_API_KEY` → `AI_GATEWAY_API_KEY`; ADR 0010 carry-over #2 → RESOLVED | Claude Opus 4.8 + Connor |
```

**(f) Test-sum cluster** — the dense counts in the `- **Code:**` line ("~562 passing across 22 packages … package tests sum: 314 … the intake package's 82 across 7 files …") go stale. Rather than hand-recompute here (error-prone), recompute the line from the **actual `pnpm test` output of Step 5's gate**, applying these deltas: **+1 tested package** (`@cema/observability`); **intake 82 → 85** tests across **7 → 8** files (`narrative.trace.test.ts`); **search +2** (`classifier.trace.test.ts`); **observability +3** (`span.test.ts`, new file); **aggregate "~562 passing" → +8**.

- [ ] **Step 4: Format docs so Lint's `format:check` passes**

Run: `pnpm format`
Expected: Prettier rewrites any unformatted Markdown (this plan, the ADR). `pnpm format:check` covers all `*.md`, and lint-staged only formats _staged_ files — so run the repo-wide `format` to avoid the Lint job failing on an unformatted doc (this caused the M9 admin-bypass; CLAUDE.md §19).

- [ ] **Step 5: Run the full required-check gate locally**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all green. This mirrors the four required CI checks (`Typecheck`, `Lint`, `Unit tests`, `Build`). New totals: 20 workspace packages (`+ @cema/observability`); intake package 85 tests; search package +2; `@cema/observability` +3.

> If `pnpm lint` flags `import/order` on the edited files, re-run with `--fix` and re-stage — the grouping is cosmetic, not behavioral.

- [ ] **Step 6: Commit**

```bash
git add .env.example CLAUDE.md docs/adr/0012-ai-gateway-adoption.md docs/superpowers/plans/2026-05-29-m11-pr-a-ai-gateway-observability.md
git commit -S -m "$(cat <<'EOF'
docs(adr): record ADR 0012 AI Gateway adoption + close carry-over #2

ADR 0012 documents the v4-compatible Gateway routing (Anthropic-compatible
baseURL, no SDK upgrade), API-key auth (OIDC deferred), PII-safe model-call
tracing, and the @cema/observability extraction. CLAUDE.md §2 updated:
carry-over #2 → RESOLVED, package count 19 → 20, narrative/Next-step lines,
Changelog row. .env.example's stale M5 comment corrected.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 7: Push the branch and open the PR**

```bash
git push -u origin feat/m11-ai-gateway-observability
gh pr create --title "feat(m11): AI Gateway adoption + @cema/observability + model-call tracing" --body "$(cat <<'EOF'
## Summary
- Route both LLM call sites (Intake savings narrative + @cema/search query classifier) through the Vercel AI Gateway via its Anthropic-compatible endpoint — keeps the repo on AI SDK v4 (no v5 upgrade). Pays down ADR 0010 carry-over #2.
- Extract `withChildSpan` into a new `@cema/observability` package (ADR 0011 Decision 2 trigger: second instrumented surface).
- Trace both model calls (`intake.draft_narrative`, `search.classify_query`) with PII-safe attributes, enforced by trace tests.
- Records ADR 0012.

## Test plan
- [ ] `pnpm --filter @cema/observability test` — 3 green
- [ ] `pnpm --filter @cema/agents-intake test` — 85 green (82 + 3 narrative-trace)
- [ ] `pnpm --filter @cema/search test` — search suite + 2 classifier-trace green
- [ ] `pnpm typecheck && pnpm lint && pnpm build` — all green
- [ ] Gate flip verified: `run.mjs` + eval message reference `AI_GATEWAY_API_KEY`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
gh pr merge --auto --squash --delete-branch
```

> **Auth check before push (CLAUDE.md §18.2):** `gh auth status` — `hicklax13` is a collaborator and can push/PR/merge. Confirm `git config user.email` is Connor's. Auto-merge lands the PR once the four required checks pass.

---

## Self-Review (run after writing; this is the author's checklist, not a step to delegate)

**Spec coverage** — PR-A goal = "route both LLM call sites through the Gateway + trace those calls + extract observability." Task 3 (narrative) + Task 4 (classifier) cover both call sites; Tasks 3-4 add both model spans; Task 1 extracts `@cema/observability`; Task 2 adopts it. ✅

**Type/signature consistency** — `withChildSpan<T>(tracer: Tracer, name: string, fn: (span: Span) => Promise<T>): Promise<T>` is defined once in Task 1 and consumed with that exact arity in Tasks 2, 3, 4. The intake call sites in Task 2 pass zero-arg callbacks (valid: a `(span) => ...` parameter may be ignored). `usage.promptTokens`/`usage.completionTokens` are the AI SDK **v4** field names (not v5's `inputTokens`/`outputTokens`). `GATEWAY_MODEL`/`GATEWAY_BASE_URL` constants are identical strings in both `narrative.ts` and `classifier.ts`. ✅

**Placeholder scan** — every code step shows complete file contents or exact before/after blocks; every run step has an exact command + expected outcome. The one genuine unknown (`GATEWAY_MODEL` slug) is flagged as an isolated single-`const` change with a test that does not depend on a live call. ✅
