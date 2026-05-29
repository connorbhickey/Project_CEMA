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
