# Phase 1 Month 12 — Servicer Outreach Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@cema/agents-servicer-outreach` — the second Layer 3 agent — that automates the prior-servicer collateral-file chase (email-only, Phase 1) on a deterministic 5-touch business-day cadence, behind the same orchestration-agnostic blueprint as M10 Intake.

**Architecture:** A pure, I/O-free cadence core (`planOutreachCadence` + `nextOutreachAction`) decides _what to do next_ given injected touch-history; an orchestration-agnostic `runOutreach(dealId, deps)` wires that decision to a `ServicerChannelAdapter` send, an env-gated email drafter (template fallback, never null), and a split audit — all effects injected via `OutreachDeps`. App wiring resolves Clerk + RLS and reads the deal → servicer → CEMA-department chain. A dormant WDK `'use workflow'` seam maps the cadence onto `step.sleep` for the real multi-week loop.

**Tech Stack:** TypeScript (strict), Vitest, Vercel AI SDK v4 + `@ai-sdk/anthropic` routed through the Vercel AI Gateway, `@opentelemetry/api` (+ `@cema/observability` `withChildSpan`), Drizzle/Neon + Postgres RLS, `workflow` (WDK) + `@workflow/vitest`, Braintrust.

**Design doc:** [`docs/superpowers/plans/2026-05-29-phase-1-month-12-servicer-outreach-design.md`](2026-05-29-phase-1-month-12-servicer-outreach-design.md) — read it first.

**Blueprint to mirror (read before starting):** `packages/agents/intake/src/{orchestrator,narrative,types}.ts`, `packages/agents/intake/package.json`, `apps/web/lib/agents/intake/{deps,run-intake-action}.ts`, and the WDK files `apps/web/lib/agents/intake/intake.{workflow,steps}.ts`. M12 is the same shape with different nouns.

---

## Ground rules (apply to EVERY task)

- **Sign every commit** with `-S`; trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Conventional Commit subject, scope `m12`.
- **One PR per section below** (PR-1…PR-7). Branch `feat/m12-servicer-outreach[-<suffix>]` from latest `main`; open PR; enable auto-merge `gh pr merge <n> --auto --squash --delete-branch`.
- **Format-clean before commit.** Run `pnpm exec prettier --write <changed files>` so the "Auto-format" workflow no-ops — an unsigned `github-actions[bot]` auto-format commit re-blocks the `required_signatures` gate. (This is the documented M12-design-PR gotcha; see `merge-blocked-diagnosis` memory.)
- **Required CI = {Lint, Typecheck, Unit tests, Build}** only. GitGuardian / Vercel / Snyk / CodeRabbit / Playwright / CodeQL are non-blocking.
- **If a PR is BLOCKED + green + 0-approvals:** check the three gates in order — (1) every commit GitHub-`verified`, (2) all review threads resolved, (3) branch up to date with `main`. **NEVER `--admin`.**
- **PII hard-rule #3:** never put dollar figures, UPB, fees, borrower/servicer-rep names, addresses, account numbers, or email _bodies_ on OTel spans or in `console.log`. Spans carry only ids + booleans + classifications.
- **0 new migrations.** M12 reuses `communications` + `audit_events` + the `deals`/`existing_loans`/`servicers`/`servicer_cema_departments` read side.
- **TDD:** every step is one action (2-5 min): write failing test → run (fail) → implement → run (pass) → commit. Do not write implementation before its test.

---

## Architecture decisions (locked by the approved design)

- **★ Decision 1 — Cadence is a pure evaluator over injected touch-history.** `nextOutreachAction` takes `touchesSent` as an _input_, never reads storage. This makes re-evaluation (every run, and every WDK replay) reproducible and unit-testable with no DB/clock.
- **★ Decision 2 — Stable anchor.** The cadence `dueAt[]` is computed from a single anchor: the **earliest recorded outbound touch timestamp**, else `now()` on the very first run. `loadContext` derives it; the orchestrator never re-anchors mid-flight.
- **★ Decision 3 — Drafter NEVER returns null.** Unlike intake's `draftSavingsNarrative` (off-path; returns null when unconfigured, throws when configured-but-failed), the outreach drafter is _on the send path_. It falls back to a deterministic template both when unconfigured **and** when a configured model call fails (recording the exception + a `outreach.draft_fallback` attribute on the span). A late servicer follow-up must not fail because an additive polish step hiccupped.
- **★ Decision 4 — Split audit.** `outreach.planned` is emitted for **every** run (before any send) via `deps.emitAudit`; `outreach.touch_sent` is owned by `recordTouch`, written **co-transactionally** with the `communications` insert (mirrors intake's `createDeal` owning `deal.created`).
- **★ Decision 5 — Idempotency via the existing UNIQUE index.** Each touch writes `communications.vendorEventId = 'outreach:'+dealId+':touch:'+n` (unique index `communications_vendor_event_id_uidx`) and groups under `sourceThreadId = 'outreach:'+dealId`. A duplicate send is rejected by the DB, not app logic.
- **★ Decision 6 — Email-only Phase 1.** `portal`/`fax_only`/`usps` resolve to `unsupported_channel` (surfaced, never silently dropped). Real sending (`ResendChannelAdapter`) is deferred behind a design partner + `RESEND_API_KEY` + a `packages/integrations/resend/` package + spec section 16 row (hard-rule #12). Default wiring uses the dormant `FixtureChannelAdapter`.

---

## File Structure

**New package `packages/agents/servicer-outreach/`** (the 21st workspace package):

| File                             | Responsibility                                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `package.json`                   | Manifest `@cema/agents-servicer-outreach` (mirror intake's deps/scripts)                               |
| `tsconfig.json`                  | Mirror `packages/agents/intake/tsconfig.json`                                                          |
| `src/index.ts`                   | Public barrel (re-exports types + `runOutreach` + cadence)                                             |
| `src/types.ts`                   | All shared types + the `ServicerChannelAdapter` / `OutreachDeps` interfaces                            |
| `src/cadence.ts`                 | Pure: `OUTREACH_OFFSETS_BUSINESS_DAYS`, `addBusinessDays`, `planOutreachCadence`, `nextOutreachAction` |
| `src/cadence.test.ts`            | Pure cadence unit tests (no DB/model/clock)                                                            |
| `src/channel.ts`                 | `FixtureChannelAdapter` (dormant default impl)                                                         |
| `src/channel.test.ts`            | Fixture adapter unit test                                                                              |
| `src/draft.ts`                   | `isLlmConfigured`, `buildOutreachEmailPrompt`, `renderTemplateEmail`, `draftOutreachEmail`             |
| `src/draft.test.ts`              | Drafter unit + trace tests (template fallback paths)                                                   |
| `src/classify.ts`                | **Dormant** `classifyServicerResponse` (inbound seam; no Phase 1 caller)                               |
| `src/classify.test.ts`           | Classifier unit test (unconfigured path)                                                               |
| `src/orchestrator.ts`            | `runOutreach(dealId, deps)` — parent span + child boundaries                                           |
| `src/orchestrator.test.ts`       | Behavioral guard (sequence / short-circuit / split-audit / fixture deps)                               |
| `src/orchestrator.trace.test.ts` | PII-safe span-attribute allowlist                                                                      |
| `evals/scorers.ts`               | 5 offline compliance scorers                                                                           |
| `evals/scorers.test.ts`          | Scorer unit tests — **the real CI compliance gate**                                                    |
| `evals/fixtures.ts`              | ≥20 fixtures (structured department + deal-reference shapes)                                           |
| `evals/run.mjs`                  | Braintrust live run (gated on keys; skip-green)                                                        |

**App wiring `apps/web/lib/agents/servicer-outreach/`:**

| File                             | Responsibility                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------ |
| `deps.ts`                        | `buildOutreachDeps(args)` — RLS reads + `recordTouch` co-transactional audit               |
| `run-outreach-action.ts`         | `'use server'` live action (Clerk → deps → `runOutreach`); dormant `FixtureChannelAdapter` |
| `outreach.steps.ts`              | **PR-5** `'use step'` boundaries (rebuild deps internally)                                 |
| `outreach.workflow.ts`           | **PR-5** `'use workflow'` loop using `step.sleep`                                          |
| `outreach.workflow.test.ts`      | **PR-5** mocked-step orchestration unit test (behavioral guard)                            |
| `run-outreach-durable-action.ts` | **PR-5** dormant `start()` + `run.returnValue` action                                      |

**Modified:** `apps/web/package.json` (+`@cema/agents-servicer-outreach` workspace dep, PR-4); `CLAUDE.md` + `docs/adr/0014-…md` (PR-7). **No spec edit** (hard-rule #11).

---

## PR-1 — Package scaffold + types + pure cadence core

**Branch:** `feat/m12-servicer-outreach` (the design-doc branch is already merged; reuse the name or `-core`).

**Files:**

- Create: `packages/agents/servicer-outreach/{package.json,tsconfig.json}`
- Create: `packages/agents/servicer-outreach/src/{index.ts,types.ts,cadence.ts,cadence.test.ts}`

### Task 1.1 — Scaffold the package by copying intake's config

- [ ] **Step 1: Copy config files** (concrete, avoids guessing tsconfig internals)

```bash
mkdir -p packages/agents/servicer-outreach/src
cp packages/agents/intake/tsconfig.json packages/agents/servicer-outreach/tsconfig.json
cp packages/agents/intake/package.json packages/agents/servicer-outreach/package.json
```

- [ ] **Step 2: Edit `package.json`** — set `"name": "@cema/agents-servicer-outreach"`. Keep `"type": "module"`, `main`/`types` = `./src/index.ts`, scripts (`test`, `typecheck`, `eval`), and deps identical to intake: `@ai-sdk/anthropic ^1.0.0`, `@cema/observability workspace:*`, `@opentelemetry/api ^1.9.0`, `ai ^4.0.0`; devDeps `@cema/config workspace:*`, `@opentelemetry/context-async-hooks ^2.0.0`, `@opentelemetry/sdk-trace-base ^2.0.0`, `@types/node ^22.0.0`, `braintrust ^3.13.0`, `typescript ^5.7.0`, `vitest ^2.1.0`. (Add a `@cema/db` workspace dep only in PR-4 if the package itself needs schema types — it does not; deps.ts lives in apps/web.)

- [ ] **Step 3: Install so pnpm links the workspace**

```bash
pnpm install
```

Expected: lockfile updates; `@cema/agents-servicer-outreach` linked. No build errors.

- [ ] **Step 4: Commit**

```bash
pnpm exec prettier --write packages/agents/servicer-outreach/package.json packages/agents/servicer-outreach/tsconfig.json pnpm-lock.yaml 2>/dev/null || true
git add packages/agents/servicer-outreach/package.json packages/agents/servicer-outreach/tsconfig.json pnpm-lock.yaml
git commit -S -F - <<'EOF'
chore(m12): scaffold @cema/agents-servicer-outreach package

21st workspace package for the second Layer 3 agent. Config mirrors
@cema/agents-intake.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

### Task 1.2 — Define all shared types

**File:** Create `packages/agents/servicer-outreach/src/types.ts`

- [ ] **Step 1: Write `types.ts`** (no test — pure type declarations; `tsc` is the check)

```ts
/** Submission methods a servicer CEMA department accepts (mirrors the DB
 * `submission_method` enum stored in the jsonb `accepted_submission_methods`). */
export type SubmissionMethod = 'email' | 'portal' | 'fax_only' | 'usps';

/** The resolved cadence for one deal: absolute due-dates per touch + the
 * resolved primary channel. Produced by {@link planOutreachCadence}. */
export interface OutreachCadence {
  readonly dueAt: Date[];
  readonly channel: SubmissionMethod | null;
}

export type ServicerResponseKind = 'delivered' | 'rejected' | 'needs_info' | 'other';

/** Classified inbound servicer response. Populated by the (dormant) classifier;
 * `null`/`other` means "no actionable response yet" → cadence continues. */
export interface ServicerResponse {
  readonly kind: ServicerResponseKind;
}

/** The decision returned by {@link nextOutreachAction}. */
export type OutreachAction =
  | { readonly kind: 'send'; readonly touchNumber: number }
  | { readonly kind: 'wait'; readonly until: Date }
  | { readonly kind: 'stop'; readonly reason: 'responded' | 'exhausted' }
  | { readonly kind: 'unsupported_channel'; readonly method: SubmissionMethod | null };

/** Everything the orchestrator needs about one deal to decide + send. All
 * effectful reads happen in {@link OutreachDeps.loadContext}; this is the
 * serializable result. */
export interface OutreachContext {
  readonly dealId: string;
  readonly organizationId: string;
  readonly servicerName: string | null;
  readonly departmentEmail: string | null;
  readonly acceptedSubmissionMethods: SubmissionMethod[];
  /** Stable anchor: earliest recorded touch, else now() on first run. */
  readonly triggeredAt: Date;
  readonly touchesSent: number;
  readonly response: ServicerResponse | null;
}

/** A fully-rendered outbound packet handed to the channel adapter. */
export interface OutreachPacket {
  readonly channel: SubmissionMethod;
  readonly to: string;
  readonly subject: string;
  readonly body: string;
  readonly touchNumber: number;
  readonly dealId: string;
}

export interface ChannelSendResult {
  readonly accepted: boolean;
  readonly channelMessageId: string | null;
}

/** Persisted after a successful send (drives touchesSent on re-evaluation). */
export interface OutreachTouchRecord {
  readonly dealId: string;
  readonly touchNumber: number;
  readonly channel: SubmissionMethod;
  readonly to: string;
  readonly channelMessageId: string | null;
}

export interface OutreachAuditEvent {
  readonly action: 'outreach.planned' | 'outreach.touch_sent';
  readonly dealId: string;
  readonly touchNumber: number | null;
  readonly channel: SubmissionMethod | null;
}

/** Pluggable delivery seam (FixtureChannelAdapter today, Resend later). */
export interface ServicerChannelAdapter {
  send(packet: OutreachPacket): Promise<ChannelSendResult>;
}

/** All effects the orchestrator depends on — injected, never imported. */
export interface OutreachDeps {
  readonly channel: ServicerChannelAdapter;
  loadContext(dealId: string): Promise<OutreachContext>;
  recordTouch(record: OutreachTouchRecord): Promise<void>;
  emitAudit(event: OutreachAuditEvent): Promise<void>;
  now(): Date;
}

export interface OutreachResult {
  readonly dealId: string;
  readonly action: OutreachAction;
  readonly touchSent: number | null;
}
```

- [ ] **Step 2: Write the barrel `src/index.ts`**

```ts
export * from './types';
export * from './cadence';
export { runOutreach } from './orchestrator';
```

> Note: `index.ts` references `./orchestrator` (created in PR-4). Until then, comment out the `runOutreach` line OR create a stub. Cleanest: keep the export and create `orchestrator.ts` as the LAST file — but to keep PR-1 self-contained and typecheck-green, in PR-1 export only `./types` and `./cadence`; add the `runOutreach` re-export in PR-4. Write PR-1's `index.ts` as:

```ts
export * from './types';
export * from './cadence';
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @cema/agents-servicer-outreach typecheck
```

Expected: PASS (types-only file; `cadence.ts` arrives next task — if `index.ts` re-exports `./cadence` before it exists, this fails, so create `cadence.ts` in Task 1.3 before running this. Reorder: do 1.3 then typecheck.) Defer this step to after Task 1.3.

### Task 1.3 — Pure cadence core (TDD)

**File:** Test `packages/agents/servicer-outreach/src/cadence.test.ts`; impl `src/cadence.ts`

- [ ] **Step 1: Write the failing test** (calendar facts: 2026-06-01 = Monday, 2026-06-05 = Friday, 2026-06-08 = Monday)

```ts
import { describe, expect, it } from 'vitest';
import {
  OUTREACH_OFFSETS_BUSINESS_DAYS,
  addBusinessDays,
  planOutreachCadence,
  nextOutreachAction,
} from './cadence';
import type { OutreachCadence } from './types';

const MON_2026_06_01 = new Date('2026-06-01T14:00:00.000Z'); // Monday

describe('addBusinessDays', () => {
  it('returns a copy of the input for n=0 (T+0 = trigger instant)', () => {
    const out = addBusinessDays(MON_2026_06_01, 0);
    expect(out.getTime()).toBe(MON_2026_06_01.getTime());
    expect(out).not.toBe(MON_2026_06_01); // copy, not same ref
  });

  it('skips weekends counting forward from Monday', () => {
    // Mon +5 business days = next Monday (2026-06-08)
    expect(addBusinessDays(MON_2026_06_01, 5).toISOString()).toBe('2026-06-08T14:00:00.000Z');
  });

  it('skips the weekend when starting Friday', () => {
    const fri = new Date('2026-06-05T09:00:00.000Z'); // Friday
    // Fri +1 bd = Mon 2026-06-08
    expect(addBusinessDays(fri, 1).toISOString()).toBe('2026-06-08T09:00:00.000Z');
  });
});

describe('planOutreachCadence', () => {
  it('produces 5 due-dates at the named offsets and resolves email channel', () => {
    const cadence = planOutreachCadence({
      triggeredAt: MON_2026_06_01,
      acceptedSubmissionMethods: ['email', 'portal'],
    });
    expect(cadence.channel).toBe('email');
    expect(cadence.dueAt.map((d) => d.toISOString())).toEqual([
      '2026-06-01T14:00:00.000Z', // T+0
      '2026-06-08T14:00:00.000Z', // T+5bd
      '2026-06-15T14:00:00.000Z', // T+10bd
      '2026-06-22T14:00:00.000Z', // T+15bd
      '2026-06-29T14:00:00.000Z', // T+20bd
    ]);
    expect(cadence.dueAt.length).toBe(OUTREACH_OFFSETS_BUSINESS_DAYS.length);
  });

  it('falls back to the first method when email is not accepted', () => {
    const cadence = planOutreachCadence({
      triggeredAt: MON_2026_06_01,
      acceptedSubmissionMethods: ['portal', 'fax_only'],
    });
    expect(cadence.channel).toBe('portal');
  });

  it('resolves a null channel when no methods are accepted', () => {
    const cadence = planOutreachCadence({
      triggeredAt: MON_2026_06_01,
      acceptedSubmissionMethods: [],
    });
    expect(cadence.channel).toBeNull();
  });
});

describe('nextOutreachAction', () => {
  const cadence: OutreachCadence = planOutreachCadence({
    triggeredAt: MON_2026_06_01,
    acceptedSubmissionMethods: ['email'],
  });

  it('sends touch 1 when now >= first due-date and nothing sent', () => {
    const action = nextOutreachAction({ cadence, now: MON_2026_06_01, touchesSent: 0 });
    expect(action).toEqual({ kind: 'send', touchNumber: 1 });
  });

  it('waits until the next due-date when the next touch is in the future', () => {
    const action = nextOutreachAction({ cadence, now: MON_2026_06_01, touchesSent: 1 });
    expect(action).toEqual({ kind: 'wait', until: new Date('2026-06-08T14:00:00.000Z') });
  });

  it('stops as exhausted after the final touch', () => {
    const action = nextOutreachAction({
      cadence,
      now: new Date('2026-07-01T00:00:00.000Z'),
      touchesSent: 5,
    });
    expect(action).toEqual({ kind: 'stop', reason: 'exhausted' });
  });

  it('stops as responded on an actionable response', () => {
    const action = nextOutreachAction({
      cadence,
      now: MON_2026_06_01,
      touchesSent: 1,
      response: { kind: 'delivered' },
    });
    expect(action).toEqual({ kind: 'stop', reason: 'responded' });
  });

  it('does NOT stop on an "other" response (noise)', () => {
    const action = nextOutreachAction({
      cadence,
      now: MON_2026_06_01,
      touchesSent: 0,
      response: { kind: 'other' },
    });
    expect(action).toEqual({ kind: 'send', touchNumber: 1 });
  });

  it('returns unsupported_channel when the channel is not email', () => {
    const portal = planOutreachCadence({
      triggeredAt: MON_2026_06_01,
      acceptedSubmissionMethods: ['portal'],
    });
    const action = nextOutreachAction({ cadence: portal, now: MON_2026_06_01, touchesSent: 0 });
    expect(action).toEqual({ kind: 'unsupported_channel', method: 'portal' });
  });
});
```

- [ ] **Step 2: Run the test — verify it fails**

```bash
pnpm --filter @cema/agents-servicer-outreach exec vitest run src/cadence.test.ts
```

Expected: FAIL — `Cannot find module './cadence'` / functions not defined.

- [ ] **Step 3: Implement `src/cadence.ts`**

```ts
import type { OutreachAction, OutreachCadence, ServicerResponse, SubmissionMethod } from './types';

/** Business-day offsets for the 5 touches: initial (T+0) + follow-ups at
 * T+5/10/15/20. A named constant so cadence is tunable without touching logic. */
export const OUTREACH_OFFSETS_BUSINESS_DAYS: readonly number[] = [0, 5, 10, 15, 20] as const;

/**
 * Adds `n` business days (Mon–Fri) to `from`, skipping weekends. `n = 0`
 * returns a copy of `from` unchanged (T+0 is the trigger instant, sent
 * immediately regardless of weekday). NY bank holidays are NOT yet excluded
 * (carry-over — pairs with the Connor-owned NY reference-data confirmation).
 * Operates in UTC so the result is deterministic across server timezones.
 */
export function addBusinessDays(from: Date, n: number): Date {
  const r = new Date(from.getTime());
  let added = 0;
  while (added < n) {
    r.setUTCDate(r.getUTCDate() + 1);
    const day = r.getUTCDay();
    if (day !== 0 && day !== 6) added += 1;
  }
  return r;
}

/** Resolves the absolute due-dates + primary channel for one deal. Pure. */
export function planOutreachCadence(trigger: {
  triggeredAt: Date;
  acceptedSubmissionMethods: SubmissionMethod[];
}): OutreachCadence {
  const dueAt = OUTREACH_OFFSETS_BUSINESS_DAYS.map((offset) =>
    addBusinessDays(trigger.triggeredAt, offset),
  );
  const channel: SubmissionMethod | null = trigger.acceptedSubmissionMethods.includes('email')
    ? 'email'
    : (trigger.acceptedSubmissionMethods[0] ?? null);
  return { dueAt, channel };
}

/**
 * The decision function: given the planned cadence, the current time, how many
 * touches were already sent, and any classified response, returns the next
 * action. Storage-agnostic — `touchesSent` is an input, so re-evaluation (and
 * WDK replay) is reproducible.
 */
export function nextOutreachAction(input: {
  cadence: OutreachCadence;
  now: Date;
  touchesSent: number;
  response?: ServicerResponse | null;
}): OutreachAction {
  const { cadence, now, touchesSent, response } = input;

  if (cadence.channel !== 'email') {
    return { kind: 'unsupported_channel', method: cadence.channel };
  }
  if (response && response.kind !== 'other') {
    return { kind: 'stop', reason: 'responded' };
  }
  if (touchesSent >= cadence.dueAt.length) {
    return { kind: 'stop', reason: 'exhausted' };
  }
  const nextDueAt = cadence.dueAt[touchesSent]!;
  if (now.getTime() >= nextDueAt.getTime()) {
    return { kind: 'send', touchNumber: touchesSent + 1 };
  }
  return { kind: 'wait', until: nextDueAt };
}
```

- [ ] **Step 4: Run the test — verify it passes**

```bash
pnpm --filter @cema/agents-servicer-outreach exec vitest run src/cadence.test.ts
```

Expected: PASS (all cases).

- [ ] **Step 5: Typecheck the package** (now that `cadence.ts` exists for the barrel)

```bash
pnpm --filter @cema/agents-servicer-outreach typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write packages/agents/servicer-outreach/src/*.ts
git add packages/agents/servicer-outreach/src/types.ts packages/agents/servicer-outreach/src/index.ts packages/agents/servicer-outreach/src/cadence.ts packages/agents/servicer-outreach/src/cadence.test.ts
git commit -S -F - <<'EOF'
feat(m12): servicer-outreach types + pure cadence core

planOutreachCadence resolves 5 business-day-offset due-dates and the
primary channel; nextOutreachAction is a pure evaluator over injected
touchesSent (storage-agnostic, replay-safe). Weekends excluded; NY
holidays deferred (carry-over). No I/O.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

- [ ] **Step 7: Open PR-1 + enable auto-merge**

```bash
git push -u origin feat/m12-servicer-outreach
gh pr create --title "feat(m12): servicer-outreach package scaffold + cadence core" --body "$(cat <<'EOF'
## Summary
- Scaffolds @cema/agents-servicer-outreach (21st package)
- Pure cadence core: planOutreachCadence + nextOutreachAction (no I/O, fully unit-tested)

## Test plan
- [ ] `pnpm --filter @cema/agents-servicer-outreach test` green
- [ ] `pnpm --filter @cema/agents-servicer-outreach typecheck` green
EOF
)"
gh pr merge --auto --squash --delete-branch
```

- [ ] **Step 8: Drive to green + merged**, then `git checkout main && git pull --rebase origin main`. If BLOCKED, run the three-gate diagnosis (never `--admin`).

---

## PR-2 — Channel seam (`ServicerChannelAdapter` + `FixtureChannelAdapter`)

**Branch:** `feat/m12-outreach-channel` from latest `main`.

**Files:**

- Create: `packages/agents/servicer-outreach/src/channel.ts`
- Create: `packages/agents/servicer-outreach/src/channel.test.ts`

> The `ServicerChannelAdapter` _interface_ already lives in `types.ts` (PR-1). This PR adds the dormant default implementation. `ResendChannelAdapter` is explicitly **out of scope** (needs a design partner + `RESEND_API_KEY` + `packages/integrations/resend/` + spec section 16 row per hard-rule #12).

### Task 2.1 — `FixtureChannelAdapter` (TDD)

- [ ] **Step 1: Write the failing test** — `src/channel.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { FixtureChannelAdapter } from './channel';
import type { OutreachPacket } from './types';

const packet: OutreachPacket = {
  channel: 'email',
  to: 'cema@servicer.example',
  subject: 'CEMA collateral file request',
  body: 'Body text.',
  touchNumber: 1,
  dealId: 'deal-123',
};

describe('FixtureChannelAdapter', () => {
  it('accepts a packet and returns a deterministic channel message id', async () => {
    const adapter = new FixtureChannelAdapter();
    const result = await adapter.send(packet);
    expect(result.accepted).toBe(true);
    expect(result.channelMessageId).toBe('fixture:deal-123:touch:1');
  });

  it('records every sent packet for inspection in tests', async () => {
    const adapter = new FixtureChannelAdapter();
    await adapter.send(packet);
    await adapter.send({ ...packet, touchNumber: 2 });
    expect(adapter.sent).toHaveLength(2);
    expect(adapter.sent[1]?.touchNumber).toBe(2);
  });
});
```

- [ ] **Step 2: Run — verify it fails**

```bash
pnpm --filter @cema/agents-servicer-outreach exec vitest run src/channel.test.ts
```

Expected: FAIL — `Cannot find module './channel'`.

- [ ] **Step 3: Implement `src/channel.ts`**

```ts
import type { ChannelSendResult, OutreachPacket, ServicerChannelAdapter } from './types';

/**
 * Dormant default channel adapter. Records packets in-memory and reports
 * acceptance without sending anything — the wiring default until a real
 * ResendChannelAdapter is provisioned behind a design partner + RESEND_API_KEY.
 * Also the test double for the orchestrator behavioral guard (PR-4).
 */
export class FixtureChannelAdapter implements ServicerChannelAdapter {
  public readonly sent: OutreachPacket[] = [];

  async send(packet: OutreachPacket): Promise<ChannelSendResult> {
    this.sent.push(packet);
    return {
      accepted: true,
      channelMessageId: `fixture:${packet.dealId}:touch:${packet.touchNumber}`,
    };
  }
}
```

- [ ] **Step 4: Run — verify it passes**

```bash
pnpm --filter @cema/agents-servicer-outreach exec vitest run src/channel.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add to barrel** — append to `src/index.ts`: `export { FixtureChannelAdapter } from './channel';`

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm --filter @cema/agents-servicer-outreach typecheck
pnpm exec prettier --write packages/agents/servicer-outreach/src/channel.ts packages/agents/servicer-outreach/src/channel.test.ts packages/agents/servicer-outreach/src/index.ts
git add packages/agents/servicer-outreach/src/channel.ts packages/agents/servicer-outreach/src/channel.test.ts packages/agents/servicer-outreach/src/index.ts
git commit -S -F - <<'EOF'
feat(m12): FixtureChannelAdapter (dormant channel seam)

In-memory dormant default for the ServicerChannelAdapter interface; the
wiring default + orchestrator test double until ResendChannelAdapter
lands behind a design partner.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

- [ ] **Step 7: Push, PR, auto-merge, drive to green, update local main** (as PR-1 Steps 7-8).

---

## PR-3 — Email drafter (template fallback, never null) + dormant classifier

**Branch:** `feat/m12-outreach-draft` from latest `main`.

**Files:**

- Create: `packages/agents/servicer-outreach/src/draft.ts`
- Create: `packages/agents/servicer-outreach/src/draft.test.ts`
- Create: `packages/agents/servicer-outreach/src/classify.ts`
- Create: `packages/agents/servicer-outreach/src/classify.test.ts`

> Mirrors `packages/agents/intake/src/narrative.ts` (read it). **Key divergence (★ Decision 3):** `draftOutreachEmail` NEVER returns null — it falls back to `renderTemplateEmail` when unconfigured AND when a configured model call fails (recording the exception on the span).

### Task 3.1 — Prompt builder + deterministic template (TDD)

- [ ] **Step 1: Write the failing test** — `src/draft.test.ts` (first half: pure pieces)

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  buildOutreachEmailPrompt,
  renderTemplateEmail,
  isLlmConfigured,
  draftOutreachEmail,
} from './draft';
import type { DraftEmailInput } from './draft';

const input: DraftEmailInput = {
  servicerName: 'Acme Servicing LLC',
  touchNumber: 1,
  dealReference: 'deal-abc-123',
};

describe('renderTemplateEmail', () => {
  it('produces a subject + body that name the deal reference', () => {
    const { subject, body } = renderTemplateEmail(input);
    expect(subject).toMatch(/collateral file/i);
    expect(body).toContain('deal-abc-123');
  });

  it('uses a neutral salutation when servicerName is null', () => {
    const { body } = renderTemplateEmail({ ...input, servicerName: null });
    expect(body.length).toBeGreaterThan(0);
    expect(body).not.toContain('null');
  });

  it('escalates wording on later follow-ups', () => {
    const first = renderTemplateEmail({ ...input, touchNumber: 1 }).body;
    const fourth = renderTemplateEmail({ ...input, touchNumber: 4 }).body;
    expect(fourth).not.toBe(first); // follow-ups differ from the initial touch
  });
});

describe('buildOutreachEmailPrompt', () => {
  it('includes the deal reference and instructs B2B tone, no legal advice', () => {
    const prompt = buildOutreachEmailPrompt(input);
    expect(prompt).toContain('deal-abc-123');
    expect(prompt).toMatch(/do not (give|offer|provide) legal advice/i);
  });
});

describe('isLlmConfigured', () => {
  const original = process.env.AI_GATEWAY_API_KEY;
  afterEach(() => {
    if (original === undefined) delete process.env.AI_GATEWAY_API_KEY;
    else process.env.AI_GATEWAY_API_KEY = original;
  });
  it('is false when AI_GATEWAY_API_KEY is unset', () => {
    delete process.env.AI_GATEWAY_API_KEY;
    expect(isLlmConfigured()).toBe(false);
  });
  it('is true when AI_GATEWAY_API_KEY is set', () => {
    process.env.AI_GATEWAY_API_KEY = 'test-key';
    expect(isLlmConfigured()).toBe(true);
  });
});

describe('draftOutreachEmail (unconfigured)', () => {
  const original = process.env.AI_GATEWAY_API_KEY;
  beforeEach(() => delete process.env.AI_GATEWAY_API_KEY);
  afterEach(() => {
    if (original === undefined) delete process.env.AI_GATEWAY_API_KEY;
    else process.env.AI_GATEWAY_API_KEY = original;
  });
  it('returns the template when no key is configured (never null)', async () => {
    const out = await draftOutreachEmail(input);
    const tmpl = renderTemplateEmail(input);
    expect(out).toEqual(tmpl);
  });
});
```

- [ ] **Step 2: Run — verify it fails**

```bash
pnpm --filter @cema/agents-servicer-outreach exec vitest run src/draft.test.ts
```

Expected: FAIL — `Cannot find module './draft'`.

- [ ] **Step 3: Implement `src/draft.ts`**

```ts
import { createAnthropic } from '@ai-sdk/anthropic';
import { withChildSpan } from '@cema/observability';
import { trace } from '@opentelemetry/api';
import { generateText } from 'ai';

const tracer = trace.getTracer('@cema/agents-servicer-outreach');

/** Vercel AI Gateway Anthropic-compatible endpoint (ADR 0012). */
const GATEWAY_BASE_URL = 'https://ai-gateway.vercel.sh/v1';
/** Gateway model slug — UNCONFIRMED against the live catalog (Connor-owned). */
const GATEWAY_MODEL = 'anthropic/claude-sonnet-4.6';

export interface DraftEmailInput {
  /** Servicer org name (B2B, not borrower PII). Null when not identified. */
  readonly servicerName: string | null;
  readonly touchNumber: number;
  /** Non-PII deal reference token (the deal UUID) for traceability. */
  readonly dealReference: string;
}

export function isLlmConfigured(): boolean {
  return !!process.env.AI_GATEWAY_API_KEY;
}

/** Deterministic, always-valid B2B collateral-file request. The fallback when
 * the LLM is off or fails — and the offline scorer target. Carries NO borrower
 * PII (no UPB, names, addresses) — only the deal reference + servicer org name. */
export function renderTemplateEmail(input: {
  servicerName: string | null;
  touchNumber: number;
  dealReference: string;
}): {
  subject: string;
  body: string;
} {
  const salutation = input.servicerName
    ? `Dear ${input.servicerName} CEMA team,`
    : 'Dear CEMA processing team,';
  const nudge =
    input.touchNumber <= 1
      ? 'We are requesting the collateral file for the loan referenced below in connection with a New York CEMA.'
      : `This is follow-up #${input.touchNumber - 1} on our request for the collateral file referenced below.`;
  const body = [
    salutation,
    '',
    nudge,
    '',
    `Deal reference: ${input.dealReference}`,
    '',
    'Please provide the original note, recorded mortgage, all intervening assignments, and any prior CEMAs. Reply to this email with the documents or a status update.',
    '',
    'Thank you.',
  ].join('\n');
  return { subject: 'CEMA collateral file request', body };
}

export function buildOutreachEmailPrompt(input: DraftEmailInput): string {
  const tmpl = renderTemplateEmail(input);
  return [
    'You are a mortgage operations specialist writing a concise, professional B2B email',
    'to a loan servicer to request a collateral file for a New York CEMA.',
    'Rules: keep it under 150 words; professional and courteous; do NOT give legal advice;',
    'do NOT invent loan numbers, dollar amounts, names, or addresses; reference only the',
    'deal reference provided. Escalate politeness-appropriate urgency for later follow-ups.',
    '',
    `Servicer: ${input.servicerName ?? 'the servicing department'}`,
    `Follow-up number: ${input.touchNumber}`,
    `Deal reference: ${input.dealReference}`,
    '',
    'Here is a baseline template to improve (keep its intent and the deal reference):',
    tmpl.body,
  ].join('\n');
}

/**
 * Drafts the outbound email body. NEVER returns null (★ Decision 3): the
 * deterministic template is the floor. When configured, the LLM polishes the
 * body; on any model failure we record the exception + outreach.draft_fallback
 * and return the template — a late servicer follow-up must not fail on an
 * additive polish step. The subject is always the (safe) template subject.
 */
export async function draftOutreachEmail(
  input: DraftEmailInput,
): Promise<{ subject: string; body: string }> {
  const fallback = renderTemplateEmail(input);
  if (!isLlmConfigured()) return fallback;

  return withChildSpan(tracer, 'outreach.draft_email', async (span) => {
    span.setAttribute('gen_ai.request.model', GATEWAY_MODEL);
    span.setAttribute('outreach.touch_number', input.touchNumber);
    try {
      const gateway = createAnthropic({
        baseURL: GATEWAY_BASE_URL,
        apiKey: process.env.AI_GATEWAY_API_KEY,
      });
      const { text, usage } = await generateText({
        model: gateway(GATEWAY_MODEL),
        prompt: buildOutreachEmailPrompt(input),
      });
      if (usage) {
        span.setAttribute('gen_ai.usage.input_tokens', usage.promptTokens);
        span.setAttribute('gen_ai.usage.output_tokens', usage.completionTokens);
      }
      const body = text.trim();
      span.setAttribute('outreach.draft_fallback', body.length === 0);
      return body.length === 0 ? fallback : { subject: fallback.subject, body };
    } catch (err) {
      span.recordException(err as Error);
      span.setAttribute('outreach.draft_fallback', true);
      return fallback;
    }
  });
}
```

- [ ] **Step 4: Run — verify it passes**

```bash
pnpm --filter @cema/agents-servicer-outreach exec vitest run src/draft.test.ts
```

Expected: PASS.

### Task 3.2 — Drafter trace + configured-failure fallback test

- [ ] **Step 1: Append to `src/draft.test.ts`** a configured-but-failing case using an in-process tracer + a mocked `ai.generateText` that throws. Mirror intake's `narrative.trace.test.ts` for the SDK-trace harness (read it for the exact `BasicTracerProvider` + `InMemorySpanExporter` setup).

```ts
import { generateText } from 'ai';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import { context, trace as otelTrace } from '@opentelemetry/api';

vi.mock('ai', () => ({ generateText: vi.fn() }));

describe('draftOutreachEmail (configured but model fails)', () => {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  const cm = new AsyncHooksContextManager();
  const original = process.env.AI_GATEWAY_API_KEY;

  beforeEach(() => {
    process.env.AI_GATEWAY_API_KEY = 'test-key';
    context.setGlobalContextManager(cm.enable());
    otelTrace.setGlobalTracerProvider(provider);
    exporter.reset();
  });
  afterEach(() => {
    if (original === undefined) delete process.env.AI_GATEWAY_API_KEY;
    else process.env.AI_GATEWAY_API_KEY = original;
    cm.disable();
    vi.clearAllMocks();
  });

  it('falls back to the template and records the exception (never throws, never null)', async () => {
    vi.mocked(generateText).mockRejectedValueOnce(new Error('gateway 500'));
    const out = await draftOutreachEmail(input);
    expect(out).toEqual(renderTemplateEmail(input));
    const spans = exporter.getFinishedSpans();
    const draftSpan = spans.find((s) => s.name === 'outreach.draft_email');
    expect(draftSpan?.attributes['outreach.draft_fallback']).toBe(true);
    // PII guard: only allowlisted attributes
    expect(Object.keys(draftSpan?.attributes ?? {})).toEqual(
      expect.arrayContaining([
        'gen_ai.request.model',
        'outreach.touch_number',
        'outreach.draft_fallback',
      ]),
    );
  });
});
```

- [ ] **Step 2: Run — verify it passes** (impl already handles the catch path)

```bash
pnpm --filter @cema/agents-servicer-outreach exec vitest run src/draft.test.ts
```

Expected: PASS. If the trace harness needs adjustment, copy intake's `narrative.trace.test.ts` setup verbatim.

### Task 3.3 — Dormant `classifyServicerResponse` (TDD)

> Dormant inbound seam — **no Phase 1 caller** (`OutreachContext.response` stays `null` until inbound email ingestion lands, a carry-over). Shipped now so the `'responded'` branch + `ServicerResponse` type are exercised and ready, mirroring how M11 shipped the WDK seam dormant. Uses Opus 4.7 (`anthropic/claude-opus-4.7`).

- [ ] **Step 1: Write the failing test** — `src/classify.test.ts`

```ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { classifyServicerResponse, isClassifierConfigured } from './classify';

describe('classifyServicerResponse (unconfigured)', () => {
  const original = process.env.AI_GATEWAY_API_KEY;
  beforeEach(() => delete process.env.AI_GATEWAY_API_KEY);
  afterEach(() => {
    if (original === undefined) delete process.env.AI_GATEWAY_API_KEY;
    else process.env.AI_GATEWAY_API_KEY = original;
  });

  it('is not configured without a key', () => {
    expect(isClassifierConfigured()).toBe(false);
  });

  it("returns {kind:'other'} (no-op) when unconfigured so the cadence continues", async () => {
    const out = await classifyServicerResponse({ responseText: 'We received your request.' });
    expect(out).toEqual({ kind: 'other' });
  });
});
```

- [ ] **Step 2: Run — verify it fails**

```bash
pnpm --filter @cema/agents-servicer-outreach exec vitest run src/classify.test.ts
```

Expected: FAIL — `Cannot find module './classify'`.

- [ ] **Step 3: Implement `src/classify.ts`**

```ts
import { createAnthropic } from '@ai-sdk/anthropic';
import { withChildSpan } from '@cema/observability';
import { trace } from '@opentelemetry/api';
import { generateText } from 'ai';

import type { ServicerResponse, ServicerResponseKind } from './types';

const tracer = trace.getTracer('@cema/agents-servicer-outreach');
const GATEWAY_BASE_URL = 'https://ai-gateway.vercel.sh/v1';
const CLASSIFY_MODEL = 'anthropic/claude-opus-4.7';

export function isClassifierConfigured(): boolean {
  return !!process.env.AI_GATEWAY_API_KEY;
}

const VALID: readonly ServicerResponseKind[] = [
  'delivered',
  'rejected',
  'needs_info',
  'other',
] as const;

/**
 * DORMANT (no Phase 1 caller). Classifies an inbound servicer reply into a
 * ServicerResponse. Unconfigured → {kind:'other'} (a no-op that keeps the
 * cadence running). When wired to inbound ingestion later, the 'delivered' /
 * 'rejected' / 'needs_info' kinds stop or branch the cadence.
 */
export async function classifyServicerResponse(input: {
  responseText: string;
}): Promise<ServicerResponse> {
  if (!isClassifierConfigured()) return { kind: 'other' };

  return withChildSpan(tracer, 'outreach.classify_response', async (span) => {
    span.setAttribute('gen_ai.request.model', CLASSIFY_MODEL);
    const gateway = createAnthropic({
      baseURL: GATEWAY_BASE_URL,
      apiKey: process.env.AI_GATEWAY_API_KEY,
    });
    const { text } = await generateText({
      model: gateway(CLASSIFY_MODEL),
      prompt: [
        'Classify this servicer reply to a CEMA collateral-file request into exactly one word:',
        'delivered (they sent the file), rejected (they refuse/cannot), needs_info (they need more from us),',
        'or other. Reply with only the single word.',
        '',
        input.responseText,
      ].join('\n'),
    });
    const kind = text.trim().toLowerCase() as ServicerResponseKind;
    span.setAttribute('outreach.response_kind', VALID.includes(kind) ? kind : 'other');
    return { kind: VALID.includes(kind) ? kind : 'other' };
  });
}
```

- [ ] **Step 4: Run — verify it passes**

```bash
pnpm --filter @cema/agents-servicer-outreach exec vitest run src/classify.test.ts
```

Expected: PASS.

- [ ] **Step 5: Barrel + typecheck + full package test + commit**

```bash
# Add to src/index.ts: export drafter + classifier public surface
pnpm --filter @cema/agents-servicer-outreach typecheck
pnpm --filter @cema/agents-servicer-outreach test
pnpm exec prettier --write packages/agents/servicer-outreach/src/*.ts
git add packages/agents/servicer-outreach/src/draft.ts packages/agents/servicer-outreach/src/draft.test.ts packages/agents/servicer-outreach/src/classify.ts packages/agents/servicer-outreach/src/classify.test.ts packages/agents/servicer-outreach/src/index.ts
git commit -S -F - <<'EOF'
feat(m12): outreach email drafter (template fallback) + dormant classifier

draftOutreachEmail polishes via the AI Gateway when configured and falls
back to a deterministic template on unconfigured/failed (never null,
records the exception + outreach.draft_fallback). classifyServicerResponse
is a dormant inbound seam (no Phase 1 caller; unconfigured no-ops to
{kind:'other'}). Both traced PII-safe.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

- [ ] **Step 6: Push, PR, auto-merge, drive to green, update local main.**

---

## PR-4 — Orchestrator + app wiring (`runOutreach`)

**Branch:** `feat/m12-outreach-orchestrator` from latest `main`.

**Goal:** Wire the pure cadence core + channel + drafter into the orchestration-agnostic `runOutreach(dealId, deps)`, then the live app wiring (`buildOutreachDeps` over Drizzle + Clerk, a dormant `'use server'` action). This is the M10 `runIntake` blueprint applied to outreach: a flat await chain where every effect is injected, traced PII-safe, with a split audit.

**Why this shape:** `runOutreach` imports no app/DB/Clerk code — only `./cadence`, `./draft`, `./types`, and `@cema/observability`. That keeps it unit-testable with mocked deps AND makes its await boundaries map 1:1 onto WDK steps in PR-5. The legally-load-bearing decision (when/whether to send) is the pure `nextOutreachAction`; the orchestrator only sequences effects.

**Files:**

- Create: `packages/agents/servicer-outreach/src/orchestrator.ts`
- Test: `packages/agents/servicer-outreach/src/orchestrator.test.ts` (behavioral guard, mocked deps)
- Test: `packages/agents/servicer-outreach/src/orchestrator.trace.test.ts` (PII-safe attribute allowlist)
- Create: `apps/web/lib/agents/servicer-outreach/deps.ts`
- Create: `apps/web/lib/agents/servicer-outreach/run-outreach-action.ts`
- Modify: `packages/agents/servicer-outreach/src/index.ts` (add `runOutreach` re-export)
- Modify: `apps/web/package.json` (add `@cema/agents-servicer-outreach` workspace dep)

### Task 4.1 — `runOutreach` orchestrator (TDD: behavioral guard first)

- [ ] **Step 1: Write the failing behavioral test** `src/orchestrator.test.ts`

```ts
import { describe, expect, it, vi } from 'vitest';
import { runOutreach } from './orchestrator';
import type { ChannelSendResult, OutreachContext, OutreachDeps, OutreachPacket } from './types';

const DEAL = '11111111-1111-1111-1111-111111111111';
const ORG = '22222222-2222-2222-2222-222222222222';
const TRIGGER = new Date('2026-06-01T14:00:00.000Z'); // Monday

function buildContext(overrides: Partial<OutreachContext> = {}): OutreachContext {
  return {
    dealId: DEAL,
    organizationId: ORG,
    servicerName: 'Acme Servicing',
    departmentEmail: 'cema@acme.example',
    acceptedSubmissionMethods: ['email'],
    triggeredAt: TRIGGER,
    touchesSent: 0,
    response: null,
    ...overrides,
  };
}

function buildDeps(context: OutreachContext, opts: { now?: Date; sendAccepted?: boolean } = {}) {
  const events: string[] = [];
  const sent: OutreachPacket[] = [];
  const recorded: number[] = [];
  const deps: OutreachDeps = {
    channel: {
      send: vi.fn(async (packet: OutreachPacket): Promise<ChannelSendResult> => {
        events.push('send');
        sent.push(packet);
        return { accepted: opts.sendAccepted ?? true, channelMessageId: 'fixture:msg' };
      }),
    },
    loadContext: vi.fn(async () => context),
    recordTouch: vi.fn(async (record) => {
      events.push('record');
      recorded.push(record.touchNumber);
    }),
    emitAudit: vi.fn(async (event) => {
      events.push(`audit:${event.action}`);
    }),
    now: () => opts.now ?? TRIGGER,
  };
  return { deps, events, sent, recorded };
}

describe('runOutreach', () => {
  it('sends touch 1 on a due first run: plans BEFORE sending, records the touch', async () => {
    const ctx = buildContext({ touchesSent: 0 });
    const { deps, events, sent, recorded } = buildDeps(ctx);

    const result = await runOutreach(DEAL, deps);

    expect(result).toEqual({
      dealId: DEAL,
      action: { kind: 'send', touchNumber: 1 },
      touchSent: 1,
    });
    // Split audit (★ Decision 4): planned is emitted before the send.
    expect(events).toEqual(['audit:outreach.planned', 'send', 'record']);
    expect(sent[0]).toMatchObject({
      channel: 'email',
      to: 'cema@acme.example',
      touchNumber: 1,
      dealId: DEAL,
    });
    expect(recorded).toEqual([1]);
  });

  it('waits (no send/record) when the next touch is in the future', async () => {
    const ctx = buildContext({ touchesSent: 1 }); // touch 2 due 2026-06-08
    const { deps, events, sent } = buildDeps(ctx, { now: TRIGGER });

    const result = await runOutreach(DEAL, deps);

    expect(result.action.kind).toBe('wait');
    expect(result.touchSent).toBeNull();
    expect(events).toEqual(['audit:outreach.planned']); // planned only, no send
    expect(sent).toHaveLength(0);
  });

  it('stops (no send) on an actionable servicer response', async () => {
    const ctx = buildContext({ touchesSent: 1, response: { kind: 'delivered' } });
    const { deps, events } = buildDeps(ctx);

    const result = await runOutreach(DEAL, deps);

    expect(result.action).toEqual({ kind: 'stop', reason: 'responded' });
    expect(events).toEqual(['audit:outreach.planned']);
  });

  it('returns unsupported_channel (no send) when the resolved channel is not email', async () => {
    const ctx = buildContext({ acceptedSubmissionMethods: ['portal'] });
    const { deps, events, sent } = buildDeps(ctx);

    const result = await runOutreach(DEAL, deps);

    expect(result.action).toEqual({ kind: 'unsupported_channel', method: 'portal' });
    expect(events).toEqual(['audit:outreach.planned']);
    expect(sent).toHaveLength(0);
  });

  it('returns unsupported_channel when email is accepted but no department address is on file', async () => {
    const ctx = buildContext({ departmentEmail: null });
    const { deps, sent } = buildDeps(ctx);

    const result = await runOutreach(DEAL, deps);

    expect(result.action).toEqual({ kind: 'unsupported_channel', method: 'email' });
    expect(sent).toHaveLength(0);
  });

  it('does NOT record a touch when the channel rejects the send', async () => {
    const ctx = buildContext({ touchesSent: 0 });
    const { deps, events, recorded } = buildDeps(ctx, { sendAccepted: false });

    const result = await runOutreach(DEAL, deps);

    expect(result.touchSent).toBeNull();
    expect(recorded).toEqual([]);
    expect(events).toEqual(['audit:outreach.planned', 'send']); // sent attempted, not recorded
  });
});
```

- [ ] **Step 2: Run — verify it fails** (`Cannot find module './orchestrator'`)

```bash
pnpm --filter @cema/agents-servicer-outreach exec vitest run src/orchestrator.test.ts
```

- [ ] **Step 3: Implement `src/orchestrator.ts`**

```ts
import { withChildSpan } from '@cema/observability';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { nextOutreachAction, planOutreachCadence } from './cadence';
import { draftOutreachEmail } from './draft';
import type { OutreachDeps, OutreachPacket, OutreachResult } from './types';

const tracer = trace.getTracer('@cema/agents-servicer-outreach');

/**
 * Orchestrates one outreach evaluation for a deal in `collateral_chase`.
 * Orchestration-agnostic: every effect is injected via {@link OutreachDeps}, so
 * the flat await chain maps 1:1 onto a WDK step boundary (PR-5). The pure
 * cadence math (planOutreachCadence + nextOutreachAction) is the legally
 * load-bearing decision; this fn only sequences effects + emits PII-safe spans
 * (ids + booleans only — never email bodies, servicer rep names, or addresses).
 */
export async function runOutreach(dealId: string, deps: OutreachDeps): Promise<OutreachResult> {
  return tracer.startActiveSpan('outreach.run', async (span) => {
    span.setAttribute('outreach.deal_id', dealId);
    try {
      const context = await withChildSpan(tracer, 'outreach.load_context', () =>
        deps.loadContext(dealId),
      );
      span.setAttribute('outreach.touches_sent', context.touchesSent);
      span.setAttribute('outreach.servicer_identified', context.departmentEmail !== null);

      const cadence = planOutreachCadence({
        triggeredAt: context.triggeredAt,
        acceptedSubmissionMethods: context.acceptedSubmissionMethods,
      });
      span.setAttribute('outreach.channel', cadence.channel ?? 'none');

      // Split audit (★ Decision 4): the plan is recorded on EVERY run, before any send.
      await withChildSpan(tracer, 'outreach.emit_planned', () =>
        deps.emitAudit({
          action: 'outreach.planned',
          dealId,
          touchNumber: null,
          channel: cadence.channel,
        }),
      );

      const action = nextOutreachAction({
        cadence,
        now: deps.now(),
        touchesSent: context.touchesSent,
        response: context.response,
      });
      span.setAttribute('outreach.action', action.kind);

      // wait / stop / unsupported_channel: nothing to send this run.
      if (action.kind !== 'send') {
        span.setStatus({ code: SpanStatusCode.OK });
        return { dealId, action, touchSent: null };
      }

      // Channel resolved to email but no address on file → cannot deliver.
      if (!context.departmentEmail) {
        const blocked = { kind: 'unsupported_channel', method: cadence.channel } as const;
        span.setAttribute('outreach.action', blocked.kind);
        span.setStatus({ code: SpanStatusCode.OK });
        return { dealId, action: blocked, touchSent: null };
      }
      const to = context.departmentEmail; // narrowed to string

      // draftOutreachEmail self-spans (outreach.draft_email) — do NOT double-wrap.
      const draft = await draftOutreachEmail({
        servicerName: context.servicerName,
        touchNumber: action.touchNumber,
        dealReference: dealId,
      });

      const packet: OutreachPacket = {
        channel: 'email',
        to,
        subject: draft.subject,
        body: draft.body,
        touchNumber: action.touchNumber,
        dealId,
      };

      const result = await withChildSpan(tracer, 'outreach.send_touch', () =>
        deps.channel.send(packet),
      );
      span.setAttribute('outreach.send_accepted', result.accepted);

      if (result.accepted) {
        // recordTouch owns the communications-row insert + the outreach.touch_sent
        // audit event co-transactionally (★ Decision 4).
        await withChildSpan(tracer, 'outreach.record_touch', () =>
          deps.recordTouch({
            dealId,
            touchNumber: action.touchNumber,
            channel: 'email',
            to,
            channelMessageId: result.channelMessageId,
          }),
        );
      }

      span.setStatus({ code: SpanStatusCode.OK });
      return { dealId, action, touchSent: result.accepted ? action.touchNumber : null };
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

- [ ] **Step 4: Run — verify it passes**

```bash
pnpm --filter @cema/agents-servicer-outreach exec vitest run src/orchestrator.test.ts
```

Expected: PASS (all 6 cases).

### Task 4.2 — PII-safe trace allowlist test

- [ ] **Step 1: Write `src/orchestrator.trace.test.ts`** (mirror intake's `orchestrator.trace.test.ts` harness)

```ts
import { context, trace } from '@opentelemetry/api';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { describe, expect, it, vi } from 'vitest';
import { runOutreach } from './orchestrator';
import type { OutreachContext, OutreachDeps, OutreachPacket } from './types';

// The ONLY attribute keys the orchestrator's own spans may carry. Anything
// outside this set is a PII-leak regression (CLAUDE.md §10.3 / hard rule #3).
const ALLOWED_ATTR_KEYS = new Set<string>([
  'outreach.deal_id',
  'outreach.touches_sent',
  'outreach.servicer_identified',
  'outreach.channel',
  'outreach.action',
  'outreach.send_accepted',
]);
const ORCHESTRATOR_SPANS = new Set([
  'outreach.run',
  'outreach.load_context',
  'outreach.emit_planned',
  'outreach.send_touch',
  'outreach.record_touch',
]);

const DEAL = '11111111-1111-1111-1111-111111111111';
const TRIGGER = new Date('2026-06-01T14:00:00.000Z');

function buildContext(): OutreachContext {
  return {
    dealId: DEAL,
    organizationId: '22222222-2222-2222-2222-222222222222',
    servicerName: 'Acme Servicing', // a name — must NOT land on any span
    departmentEmail: 'cema@acme.example', // an address — must NOT land on any span
    acceptedSubmissionMethods: ['email'],
    triggeredAt: TRIGGER,
    touchesSent: 0,
    response: null,
  };
}

function buildDeps(ctx: OutreachContext): OutreachDeps {
  return {
    channel: {
      send: vi.fn(async (_p: OutreachPacket) => ({
        accepted: true,
        channelMessageId: 'fixture:msg',
      })),
    },
    loadContext: vi.fn(async () => ctx),
    recordTouch: vi.fn(async () => {}),
    emitAudit: vi.fn(async () => {}),
    now: () => TRIGGER,
  };
}

describe('runOutreach tracing', () => {
  it('opens outreach.run + child spans, carrying only allowlisted, PII-free attributes', async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    const ctxManager = new AsyncHooksContextManager().enable();
    context.setGlobalContextManager(ctxManager);
    trace.setGlobalTracerProvider(provider);
    try {
      await runOutreach(DEAL, buildDeps(buildContext()));
      const spans = exporter.getFinishedSpans();

      const names = spans.map((s) => s.name);
      expect(names).toContain('outreach.run');
      expect(names).toContain('outreach.load_context');
      expect(names).toContain('outreach.emit_planned');
      expect(names).toContain('outreach.send_touch');
      expect(names).toContain('outreach.record_touch');

      for (const span of spans) {
        // PII-VALUE guarantee applies to EVERY span attribute, no exceptions.
        for (const value of Object.values(span.attributes)) {
          const serialized = JSON.stringify(value);
          expect(serialized).not.toContain('Acme Servicing');
          expect(serialized).not.toContain('cema@acme.example');
        }
        // KEY allowlist applies to the orchestrator's own spans.
        if (ORCHESTRATOR_SPANS.has(span.name)) {
          for (const key of Object.keys(span.attributes)) {
            expect(ALLOWED_ATTR_KEYS.has(key)).toBe(true);
          }
        }
      }

      const run = spans.find((s) => s.name === 'outreach.run')!;
      expect(run.attributes['outreach.deal_id']).toBe(DEAL);
      expect(run.attributes['outreach.action']).toBe('send');
      expect(run.attributes['outreach.send_accepted']).toBe(true);
      expect(run.attributes['outreach.servicer_identified']).toBe(true);
    } finally {
      await provider.shutdown();
      ctxManager.disable();
      context.disable();
    }
  });
});
```

- [ ] **Step 2: Run — verify it passes**

```bash
pnpm --filter @cema/agents-servicer-outreach exec vitest run src/orchestrator.trace.test.ts
```

Expected: PASS. (No `AI_GATEWAY_API_KEY` in test env → `draftOutreachEmail` returns the template without opening `outreach.draft_email`, so only the orchestrator's spans exist.)

### Task 4.3 — App wiring: live deps + dormant Server Action

- [ ] **Step 1: Add the workspace dependency** to `apps/web/package.json`

```jsonc
// in "dependencies", alphabetically near the other @cema/* entries:
"@cema/agents-servicer-outreach": "workspace:*",
```

```bash
pnpm install # links the workspace package
```

- [ ] **Step 2: Create `apps/web/lib/agents/servicer-outreach/deps.ts`**

Mirrors `apps/web/lib/agents/intake/deps.ts`: orchestration-agnostic core, concrete effects acquired here, each org-scoped write in its own `withRls` transaction. `recordTouch` owns the atomic communications-row insert + `outreach.touch_sent` audit co-transactionally (★ Decision 4). The `vendorEventId` UNIQUE index (`communications_vendor_event_id_uidx`) is the cross-run idempotency guard (★ Decision 5): a replayed touch-N insert throws on conflict rather than double-sending.

```ts
import type {
  OutreachContext,
  OutreachDeps,
  ServicerChannelAdapter,
  SubmissionMethod,
} from '@cema/agents-servicer-outreach';
import { emitAuditEvent } from '@cema/compliance';
import { communications, existingLoans, servicerCemaDepartments, servicers } from '@cema/db';
import { and, asc, eq, isNotNull } from 'drizzle-orm';

import { withRls } from '../../with-rls';

export interface BuildOutreachDepsArgs {
  /** Internal organization UUID (already resolved from the Clerk org). */
  organizationId: string;
  /** Internal UUID of the actor who triggered the run — the audit actor. */
  actorUserId: string;
  /** Delivery seam (FixtureChannelAdapter today; Resend later). */
  channel: ServicerChannelAdapter;
}

/** A stable thread id per deal so all touches for one deal group together and
 * the touch count is queryable. Non-PII (just the deal UUID). */
const threadId = (dealId: string) => `outreach:${dealId}`;

export function buildOutreachDeps(args: BuildOutreachDepsArgs): OutreachDeps {
  const { organizationId, actorUserId, channel } = args;

  return {
    channel,

    now: () => new Date(),

    // Reads the servicer chain + prior-touch history for one deal. The earliest
    // recorded touch is the STABLE cadence anchor (★ Decision 2); first run (no
    // touches yet) anchors on now(). response stays null — inbound classification
    // is dormant in Phase 1 (PR-3 classifyServicerResponse has no live caller).
    loadContext: (dealId: string): Promise<OutreachContext> =>
      withRls(organizationId, async (tx) => {
        // First servicer in the chain that has a current servicer assigned.
        const [loan] = await tx
          .select({ servicerId: existingLoans.currentServicerId })
          .from(existingLoans)
          .where(and(eq(existingLoans.dealId, dealId), isNotNull(existingLoans.currentServicerId)))
          .orderBy(asc(existingLoans.chainPosition))
          .limit(1);

        let servicerName: string | null = null;
        let departmentEmail: string | null = null;
        let acceptedSubmissionMethods: SubmissionMethod[] = [];

        if (loan?.servicerId) {
          const [servicer] = await tx
            .select({ name: servicers.name }) // confirm column name in servicers schema
            .from(servicers)
            .where(eq(servicers.id, loan.servicerId))
            .limit(1);
          servicerName = servicer?.name ?? null;

          const [dept] = await tx
            .select({
              email: servicerCemaDepartments.email,
              accepted: servicerCemaDepartments.acceptedSubmissionMethods,
            })
            .from(servicerCemaDepartments)
            .where(eq(servicerCemaDepartments.servicerId, loan.servicerId))
            .limit(1);
          departmentEmail = dept?.email ?? null;
          acceptedSubmissionMethods = (dept?.accepted ?? []) as SubmissionMethod[];
        }

        const touches = await tx
          .select({ createdAt: communications.createdAt })
          .from(communications)
          .where(
            and(
              eq(communications.dealId, dealId),
              eq(communications.organizationId, organizationId),
              eq(communications.direction, 'outbound'),
              eq(communications.kind, 'email'),
              eq(communications.sourceThreadId, threadId(dealId)),
            ),
          )
          .orderBy(asc(communications.createdAt));

        return {
          dealId,
          organizationId,
          servicerName,
          departmentEmail,
          acceptedSubmissionMethods,
          triggeredAt: touches[0]?.createdAt ?? new Date(),
          touchesSent: touches.length,
          response: null,
        };
      }),

    // The plan audit ('outreach.planned'), emitted on every run before any send.
    emitAudit: (event) =>
      withRls(organizationId, (tx) =>
        emitAuditEvent(tx, {
          organizationId,
          actorUserId,
          action: event.action,
          entityType: 'deal',
          entityId: event.dealId,
          metadata: {
            source: 'servicer-outreach',
            touchNumber: event.touchNumber,
            channel: event.channel,
          },
        }),
      ),

    // Atomic: the outbound communications row + the 'outreach.touch_sent' audit
    // event in ONE transaction. vendorEventId is the idempotency key.
    recordTouch: (record) =>
      withRls(organizationId, async (tx) => {
        await tx.insert(communications).values({
          organizationId,
          dealId: record.dealId,
          kind: 'email',
          direction: 'outbound',
          medium: 'other',
          status: 'pending',
          sourceThreadId: threadId(record.dealId),
          vendorEventId: `outreach:${record.dealId}:touch:${record.touchNumber}`,
        });
        await emitAuditEvent(tx, {
          organizationId,
          actorUserId,
          action: 'outreach.touch_sent',
          entityType: 'deal',
          entityId: record.dealId,
          metadata: {
            source: 'servicer-outreach',
            touchNumber: record.touchNumber,
            channel: record.channel,
            channelMessageId: record.channelMessageId,
          },
        });
      }),
  };
}
```

- [ ] **Step 3: Create `apps/web/lib/agents/servicer-outreach/run-outreach-action.ts`** (dormant `'use server'` shell — mirrors `run-intake-action.ts`)

```ts
'use server';

import {
  FixtureChannelAdapter,
  runOutreach,
  type OutreachResult,
} from '@cema/agents-servicer-outreach';
import { getCurrentOrganizationId, getCurrentUser } from '@cema/auth';
import { getDb, organizations, users } from '@cema/db';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { buildOutreachDeps } from './deps';

const tracer = trace.getTracer('@cema/web');

/**
 * Server Action: run one outreach evaluation for a deal in `collateral_chase`,
 * on behalf of the signed-in processor. This shell owns request-context concerns
 * the core avoids — Clerk identity resolution, channel-adapter selection, cache
 * revalidation — then delegates to the pure `runOutreach`. The whole action runs
 * inside an `outreach.run_from_deal` span; the orchestrator's spans nest beneath.
 * Attributes stay PII-safe (ids + boolean outcome only).
 *
 * Channel is the FixtureChannelAdapter until a real Resend adapter is wired
 * (PR-6+ carry-over); swapping it is a one-line change here, not in the core.
 * DORMANT: no UI/cron wires this in M12 — it is the live seam, ready behind a
 * trigger once a design partner + RESEND_API_KEY are provisioned.
 */
export async function runOutreachFromDeal(dealId: string): Promise<OutreachResult> {
  return tracer.startActiveSpan('outreach.run_from_deal', async (span) => {
    span.setAttribute('outreach.deal_id', dealId);
    try {
      const clerkOrgId = await getCurrentOrganizationId();
      const clerkUser = await getCurrentUser();
      if (!clerkUser) throw new Error('Not authenticated');

      const db = getDb();
      const org = await db.query.organizations.findFirst({
        where: eq(organizations.clerkOrgId, clerkOrgId),
      });
      if (!org) throw new Error('Organization not synced yet');

      const user = await db.query.users.findFirst({
        where: eq(users.clerkUserId, clerkUser.id),
      });
      if (!user) throw new Error('User not synced yet');

      const deps = buildOutreachDeps({
        organizationId: org.id,
        actorUserId: user.id,
        channel: new FixtureChannelAdapter(),
      });

      const result = await runOutreach(dealId, deps);
      span.setAttribute('outreach.action', result.action.kind);
      span.setAttribute('outreach.touch_sent', result.touchSent !== null);

      // A new outbound touch shows on the deal's activity feed.
      if (result.touchSent !== null) revalidatePath(`/deals/${dealId}/activity`);

      span.setStatus({ code: SpanStatusCode.OK });
      return result;
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

### Task 4.4 — Barrel re-export, typecheck, commit

- [ ] **Step 1: Add `runOutreach` to `packages/agents/servicer-outreach/src/index.ts`**

```ts
export * from './types';
export * from './cadence';
export * from './channel';
export * from './draft';
export * from './classify';
export { runOutreach } from './orchestrator';
```

- [ ] **Step 2: Typecheck the package and the web app**

```bash
pnpm --filter @cema/agents-servicer-outreach typecheck
pnpm --filter web typecheck
```

Expected: PASS. If `servicers.name` is the wrong column, fix to the real name here (the only unconfirmed identifier in this PR).

- [ ] **Step 3: Full package test + format + commit**

```bash
pnpm --filter @cema/agents-servicer-outreach test
pnpm exec prettier --write "packages/agents/servicer-outreach/src/*.ts" "apps/web/lib/agents/servicer-outreach/*.ts" apps/web/package.json
git add packages/agents/servicer-outreach/src/orchestrator.ts packages/agents/servicer-outreach/src/orchestrator.test.ts packages/agents/servicer-outreach/src/orchestrator.trace.test.ts packages/agents/servicer-outreach/src/index.ts apps/web/lib/agents/servicer-outreach/deps.ts apps/web/lib/agents/servicer-outreach/run-outreach-action.ts apps/web/package.json pnpm-lock.yaml
git commit -S -F - <<'EOF'
feat(m12): outreach orchestrator (runOutreach) + dormant app wiring

runOutreach is the orchestration-agnostic core (M10 runIntake blueprint):
injected OutreachDeps, a flat await chain mapping 1:1 onto WDK steps, an
outreach.run parent span + PII-safe child spans, split audit (planned
before send / touch_sent atomic in recordTouch). App wiring: buildOutreachDeps
(Drizzle + Clerk, vendorEventId idempotency) + a dormant runOutreachFromDeal
Server Action. No UI wires it yet — it is the live seam.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

- [ ] **Step 4: Push, PR, auto-merge, drive to green, update local main.**

---

## PR-5 — Dormant WDK durable wrap (`outreachWorkflow`)

**Goal:** Wrap `runOutreach` as a durable Vercel WDK workflow so a multi-week outreach cadence survives process restarts: each `wait` becomes a durable `sleep(dueAt)`, and the run replays idempotently. This is the **first agent that genuinely needs durability** (intake's wrap was a forward-looking seam over a single-request flow; outreach spans T+0→T+20 business days). Like the intake durable action (ADR 0013), this ships **dormant** — no UI/cron wires it in M12; it is the live seam, ready behind a trigger once a WDK backend + `VERCEL_OIDC_TOKEN` are provisioned (Connor-owned).

**Improvement over the intake wrap (ADR 0013 Decision 1):** intake had to **duplicate** `runIntake`'s orchestration as three separate `'use step'` boundaries because the flow was a flat await chain. Outreach's evaluator (`nextOutreachAction`) is a **pure, re-entrant function of injected touch-history**, so the workflow calls the **whole `runOutreach` core once per iteration** as a single step and only adds the durable sleep loop around it. **Zero orchestration duplication** — there is one source of truth for the outreach logic (`runOutreach`), not two shapes to keep in sync.

**Files:**

- Create: `apps/web/lib/agents/servicer-outreach/outreach.steps.ts`
- Create: `apps/web/lib/agents/servicer-outreach/outreach.workflow.ts`
- Create: `apps/web/lib/agents/servicer-outreach/outreach.workflow.test.ts`
- Create: `apps/web/lib/agents/servicer-outreach/run-outreach-durable-action.ts`

**Precondition (already satisfied — do NOT redo):** the WDK toolchain landed in M11 PR-B (ADR 0013). `workflow` + `@workflow/vitest` are in `apps/web/package.json`, `next.config.ts` is already wrapped in `withWorkflow(...)`, and `vitest.config.ts` already excludes `tests/workflow/**`. PR-5 adds only the four new files above — no config or dependency changes.

### Task 5.0 — Confirm the WDK API (record, don't re-derive)

The exact `workflow@4.2.5` surface this PR depends on was read from the installed package's type declarations. **These are confirmed — do not guess or substitute:**

- **`sleep` is exported from the root `workflow` package** (`export { sleep } from '@workflow/core'`). It is overloaded; the overload we use is **`sleep(date: Date): Promise<void>`** — it durably sleeps _until_ that absolute `Date`. (There is **no `sleepUntil` export** — an earlier design note had the wrong name.) Other overloads: `sleep(duration: StringValue)` (e.g. `sleep('5 days')`) and `sleep(durationMs: number)`. We pass the evaluator's `action.until` (a `Date`), so the `Date` overload is exact.
- **`start` is exported from `workflow/api`**: `start<TArgs, TResult>(workflow, args: TArgs, options?): Promise<Run<TResult>>`. Call as `start(outreachWorkflow, [dealId, organizationId, actorUserId])`.
- **`Run.returnValue`** is `get returnValue(): Promise<TResult>` — `await run.returnValue` resolves the workflow's return value. This is the same `start()`→`run.returnValue` synchronous-contract bridge intake used (ADR 0013 Decision 3).

- [ ] **Step 1: Create `apps/web/lib/agents/servicer-outreach/outreach.steps.ts`** (the single reused step)

```ts
import {
  FixtureChannelAdapter,
  runOutreach,
  type OutreachResult,
} from '@cema/agents-servicer-outreach';

import { buildOutreachDeps } from './deps';

/**
 * The one-and-only outreach `'use step'`: a full-Node boundary that rebuilds
 * deps internally (the durable boundary is not serializable — WDK's codec does
 * not carry functions or class instances) and runs the whole `runOutreach` core.
 *
 * Unlike the intake wrap (ADR 0013), there is no orchestration duplication: the
 * evaluator is re-entrant, so calling the core once per iteration IS the step.
 * PII-safe logs: ids + the action enum + a boolean only — never servicer names,
 * email bodies, or addresses (hard rule section 3).
 */
export async function runOutreachStep(
  dealId: string,
  organizationId: string,
  actorUserId: string,
): Promise<OutreachResult> {
  'use step';

  const deps = buildOutreachDeps({
    organizationId,
    actorUserId,
    channel: new FixtureChannelAdapter(),
  });

  const result = await runOutreach(dealId, deps);

  console.log('[outreach.step] ran', {
    dealId,
    action: result.action.kind,
    touchSent: result.touchSent !== null,
  });

  // A 'send' the channel rejected leaves touchSent null. Throw so WDK durably
  // RETRIES the whole step (re-load, re-evaluate, re-send) rather than silently
  // advancing the cadence past a touch that never went out.
  if (result.action.kind === 'send' && result.touchSent === null) {
    throw new Error(`outreach send rejected for deal ${dealId}; retrying step`);
  }

  return result;
}
```

- [ ] **Step 2: Create `apps/web/lib/agents/servicer-outreach/outreach.workflow.ts`** (the durable loop)

```ts
import { sleep } from 'workflow';

import { runOutreachStep } from './outreach.steps';

import type { OutreachResult } from '@cema/agents-servicer-outreach';

// Inlined, NOT imported from the @cema/* barrel: a `'use workflow'` fn runs in
// a sandbox VM with no Node.js, and the barrel pulls the AI SDK (via draft.ts).
// A bare numeric const is sandbox-safe; importing the package is not.
// (Docs-canonical shape: workflow = orchestration only, all logic in steps.)
const MAX_ITERATIONS = 12;

/**
 * Durable outreach workflow. Takes three serializable strings (the durable
 * boundary cannot carry deps), and loops:
 *   step -> { stop|unsupported_channel: return ; wait: sleep(until) ; send: re-evaluate }
 * Each `wait` is a durable `sleep` to the next touch's absolute dueAt, so a
 * weeks-long cadence survives restarts and resumes exactly where it slept.
 * Replay idempotency is free: WDK caches completed step results, and recordTouch
 * is vendorEventId-keyed, so a resumed run never double-sends.
 *
 * MAX_ITERATIONS bounds the loop: 5 sends + 4 interleaved waits + 1 terminal
 * stop = ~10 iterations for a full cadence; 12 gives headroom while guaranteeing
 * a misconfigured evaluator can never spin forever.
 */
export async function outreachWorkflow(
  dealId: string,
  organizationId: string,
  actorUserId: string,
): Promise<OutreachResult> {
  'use workflow';

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const result = await runOutreachStep(dealId, organizationId, actorUserId);
    const action = result.action;

    if (action.kind === 'stop' || action.kind === 'unsupported_channel') {
      return result;
    }

    if (action.kind === 'wait') {
      await sleep(action.until);
      continue;
    }

    // action.kind === 'send': the touch was just recorded. Loop immediately to
    // re-load context (touchesSent now incremented) and compute the next action.
  }

  throw new Error(`outreach workflow for deal ${dealId} exceeded ${MAX_ITERATIONS} iterations`);
}
```

- [ ] **Step 3: Create `apps/web/lib/agents/servicer-outreach/outreach.workflow.test.ts`** (mocked-step orchestration guard — the authoritative behavioral test)

This runs under the **default** vitest config: the `'use workflow'` / `'use step'` directives are inert string literals without the `@workflow/vitest` plugin, so `vi.mock` works normally (the durable-runtime proof is deferred — see the carry-over below, mirroring ADR 0013 carry-over #5).

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OutreachResult } from '@cema/agents-servicer-outreach';

vi.mock('workflow', () => ({ sleep: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./outreach.steps', () => ({ runOutreachStep: vi.fn() }));

import { sleep } from 'workflow';

import { runOutreachStep } from './outreach.steps';
import { outreachWorkflow } from './outreach.workflow';

const mockStep = vi.mocked(runOutreachStep);
const mockSleep = vi.mocked(sleep);

function sendResult(touchNumber: number): OutreachResult {
  return { dealId: 'deal-1', action: { kind: 'send', touchNumber }, touchSent: touchNumber };
}
function waitResult(until: Date): OutreachResult {
  return { dealId: 'deal-1', action: { kind: 'wait', until }, touchSent: null };
}
function stopResult(): OutreachResult {
  return { dealId: 'deal-1', action: { kind: 'stop', reason: 'exhausted' }, touchSent: null };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('outreachWorkflow (durable orchestration, mocked steps)', () => {
  it('sends, durably sleeps until the next dueAt, re-evaluates, then stops', async () => {
    const due = new Date('2026-06-15T12:00:00.000Z');
    mockStep
      .mockResolvedValueOnce(sendResult(1))
      .mockResolvedValueOnce(waitResult(due))
      .mockResolvedValueOnce(stopResult());

    const result = await outreachWorkflow('deal-1', 'org-1', 'user-1');

    expect(mockStep).toHaveBeenCalledTimes(3);
    expect(mockSleep).toHaveBeenCalledTimes(1);
    expect(mockSleep).toHaveBeenCalledWith(due); // slept to the absolute dueAt
    expect(result.action.kind).toBe('stop');
  });

  it('returns immediately, without sleeping, when the servicer has no supported channel', async () => {
    mockStep.mockResolvedValueOnce({
      dealId: 'deal-1',
      action: { kind: 'unsupported_channel', method: null },
      touchSent: null,
    });

    const result = await outreachWorkflow('deal-1', 'org-1', 'user-1');

    expect(mockStep).toHaveBeenCalledTimes(1);
    expect(mockSleep).not.toHaveBeenCalled();
    expect(result.action.kind).toBe('unsupported_channel');
  });

  it('bounds iterations — a never-terminating evaluator rejects rather than spinning forever', async () => {
    mockStep.mockResolvedValue(sendResult(1)); // pathological: always "send", never stops

    await expect(outreachWorkflow('deal-1', 'org-1', 'user-1')).rejects.toThrow(/iteration/i);
    expect(mockStep).toHaveBeenCalledTimes(MAX_ITERATIONS_EXPECTED);
    expect(mockSleep).not.toHaveBeenCalled();
  });
});

// Local mirror of the inlined workflow constant (the workflow file cannot export
// it without breaking sandbox cleanliness, so the test pins the expected value).
const MAX_ITERATIONS_EXPECTED = 12;
```

- [ ] **Step 4: Run the orchestration test to verify it passes**

```bash
pnpm --filter web exec vitest run lib/agents/servicer-outreach/outreach.workflow.test.ts
```

Expected: PASS (3 tests). This is the authoritative behavioral guard for the durable shape and is **required-CI green** (default config, no backend).

- [ ] **Step 5: Create `apps/web/lib/agents/servicer-outreach/run-outreach-durable-action.ts`** (dormant durable action)

```ts
'use server';

import { getCurrentOrganizationId, getCurrentUser } from '@cema/auth';
import { getDb, organizations, users } from '@cema/db';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { eq } from 'drizzle-orm';
import { start } from 'workflow/api';

import { outreachWorkflow } from './outreach.workflow';

import type { OutreachResult } from '@cema/agents-servicer-outreach';

const tracer = trace.getTracer('@cema/web');

/**
 * Durable variant of `runOutreachFromDeal`: starts `outreachWorkflow` and awaits
 * `run.returnValue` to preserve the same synchronous `Promise<OutreachResult>`
 * contract callers expect (ADR 0013 Decision 3). Duplicates the Clerk org/user
 * resolution from `run-outreach-action.ts` rather than refactoring — the live
 * (non-durable) action must not be regressed, and a shared extraction is out of
 * scope for a dormant seam.
 *
 * DORMANT: nothing wires this in M12. Activation prerequisites (Connor-owned):
 * provision a WDK backend + `VERCEL_OIDC_TOKEN`, exclude `/.well-known/workflow/*`
 * from the `proxy.ts` matcher (ADR 0013 Decision 4), then flip a trigger to route
 * `collateral_chase` deals through here behind a flag.
 */
export async function runOutreachFromDealDurable(dealId: string): Promise<OutreachResult> {
  return tracer.startActiveSpan('outreach.run_from_deal_durable', async (span) => {
    span.setAttribute('outreach.deal_id', dealId);
    try {
      const clerkOrgId = await getCurrentOrganizationId();
      const clerkUser = await getCurrentUser();
      if (!clerkUser) throw new Error('Not authenticated');

      const db = getDb();
      const org = await db.query.organizations.findFirst({
        where: eq(organizations.clerkOrgId, clerkOrgId),
      });
      if (!org) throw new Error('Organization not synced yet');

      const user = await db.query.users.findFirst({
        where: eq(users.clerkUserId, clerkUser.id),
      });
      if (!user) throw new Error('User not synced yet');

      const run = await start(outreachWorkflow, [dealId, org.id, user.id]);
      const result = (await run.returnValue) as OutreachResult;

      span.setAttribute('outreach.action', result.action.kind);
      span.setAttribute('outreach.touch_sent', result.touchSent !== null);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
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

- [ ] **Step 6: Typecheck, full web test, format, commit**

```bash
pnpm --filter web typecheck
pnpm --filter web test
pnpm exec prettier --write "apps/web/lib/agents/servicer-outreach/*.ts"
git add apps/web/lib/agents/servicer-outreach/outreach.steps.ts apps/web/lib/agents/servicer-outreach/outreach.workflow.ts apps/web/lib/agents/servicer-outreach/outreach.workflow.test.ts apps/web/lib/agents/servicer-outreach/run-outreach-durable-action.ts
git commit -S -F - <<'EOF'
feat(m12): dormant WDK durable wrap of runOutreach (outreachWorkflow)

The first agent that genuinely needs durability: an outreach cadence spans
T+0 to T+20 business days, so each `wait` becomes a durable sleep(dueAt) that
survives restarts and resumes where it slept. Unlike the intake wrap (ADR 0013),
there is NO orchestration duplication — the re-entrant evaluator lets the
workflow call the whole runOutreach core once per iteration as a single
'use step', adding only the durable sleep loop. Sandbox-clean (inlined
MAX_ITERATIONS, type-only OutreachResult import). Dormant: no UI/cron wires the
runOutreachFromDealDurable action yet — it is the live seam (start + returnValue).
Authoritative guard is the mocked-step orchestration test (required-CI green).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

- [ ] **Step 7: Push, PR, auto-merge, drive to green, update local main.**

**Carry-over (mirrors ADR 0013 carry-over #5):** an in-process `@workflow/vitest` durable proof (`apps/web/tests/workflow/outreach-durable.test.ts`) is **deferred / gated off**. The WDK builder externalizes our raw-TS `@cema/*` packages (no `dist/`), and Node's ESM loader rejects their extensionless re-exports inside the in-process Local World. Same root cause and same resolution paths as intake; the mocked-step orchestration test above is the authoritative behavioral guard meanwhile. Do **not** "fix" it by adding `@cema/*` to an externalization list without understanding the cause.

---

## PR-6 — Braintrust eval for the outreach email

**Goal:** Grade `draftOutreachEmail`'s output against five **pure compliance scorers** — the same two-tier structure as the intake savings-narrative eval (CLAUDE.md section 11, "≥ 20 fixtures"). The scorers are deterministic pure functions verified **offline** by `scorers.test.ts` in the required `Unit tests` job (the real compliance gate); the live Braintrust run grades only the non-deterministic LLM polish and is **skip-green** unless both `BRAINTRUST_API_KEY` and `AI_GATEWAY_API_KEY` are provisioned.

**Why these five scorers:** an outreach email is a B2B request sent to a **third-party servicer**, so the compliance surface is (1) **no UPL** — it must never read as legal advice; (2) **no PII leak** — it must never carry SSNs or loan/account numbers to an outside party (hard rule section 3); (3) it must **carry the deal reference** so the servicer can match the request to a file; (4) it must read as a **professional B2B email**; and (5) it must **actually request the collateral file** (do its job). Every scorer passes on the deterministic template floor by construction — that is what `scorers.test.ts` proves.

**Files:**

- Create: `packages/agents/servicer-outreach/evals/scorers.ts`
- Create: `packages/agents/servicer-outreach/evals/scorers.test.ts`
- Create: `packages/agents/servicer-outreach/evals/fixtures.ts`
- Create: `packages/agents/servicer-outreach/evals/outreach-email.eval.ts`
- Create: `packages/agents/servicer-outreach/evals/run.mjs`
- Modify: `packages/agents/servicer-outreach/package.json` (add `eval` script + `braintrust` devDep)

### Task 6.1 — The pure scorers

- [ ] **Step 1: Create `packages/agents/servicer-outreach/evals/scorers.ts`**

```ts
/**
 * Pure compliance scorers for the outreach-email eval. Kept separate from the
 * Braintrust `Eval()` wiring so the legally-load-bearing checks (no UPL, no PII
 * to a third party, deal reference present) are deterministic functions the
 * `Unit tests` CI job verifies on every run with no model call and no API key
 * (`scorers.test.ts`). Each matches Braintrust's custom-scorer signature
 * `({ input, output }) => { name, score }`.
 */

import type { DraftEmailInput } from '../src/draft';

/** The graded unit: the drafted email (subject + body). */
export type OutreachEmail = { subject: string; body: string };

/** Braintrust score: a named value in [0, 1]. */
export interface OutreachScore {
  name: string;
  score: number;
}

interface ScorerArgs {
  input: DraftEmailInput;
  output: OutreachEmail;
}

/** Phrases that would make a B2B servicer request read as legal advice (UPL). */
const UPL_PHRASES = [
  'we advise you',
  'you are legally required',
  'legal advice',
  'as your attorney',
  'you must sign',
  'we recommend you sign',
];

/** No UPL: the email is an operational request, never legal advice. */
export function noLegalAdvice({ output }: ScorerArgs): OutreachScore {
  const haystack = `${output.subject}\n${output.body}`.toLowerCase();
  const hit = UPL_PHRASES.some((phrase) => haystack.includes(phrase));
  return { name: 'no_legal_advice', score: hit ? 0 : 1 };
}

/** The body must carry the deal reference so the servicer can match the file. */
export function containsDealReference({ input, output }: ScorerArgs): OutreachScore {
  return {
    name: 'contains_deal_reference',
    score: output.body.includes(input.dealReference) ? 1 : 0,
  };
}

/**
 * No borrower PII to a third party. The deal reference is an opaque identifier
 * (the deal UUID), NOT PII — strip it first so a UUID's digit run can't
 * false-positive the labeled-account-number check.
 */
export function noPiiLeak({ input, output }: ScorerArgs): OutreachScore {
  const scanned = `${output.subject}\n${output.body}`.split(input.dealReference).join(' ');
  const ssn = /\b\d{3}-\d{2}-\d{4}\b/;
  const labeledAccount = /\b(?:loan|account|acct)\b[^.\n]{0,20}?\d{6,}/i;
  const leaked = ssn.test(scanned) || labeledAccount.test(scanned);
  return { name: 'no_pii_leak', score: leaked ? 0 : 1 };
}

/** Reads as a professional B2B email: a greeting, a courteous sign-off, no shouting. */
export function professionalB2bTone({ output }: ScorerArgs): OutreachScore {
  const body = output.body;
  const hasGreeting = /\b(hello|hi|dear|greetings|to whom)\b/i.test(body);
  const hasSignoff = /\b(regards|sincerely|thank you|best|respectfully|appreciate)\b/i.test(body);
  const isShouting = /[A-Z]{20,}/.test(body);
  return {
    name: 'professional_b2b_tone',
    score: hasGreeting && hasSignoff && !isShouting ? 1 : 0,
  };
}

/** Does its job: actually asks for the collateral file / the specific documents. */
export function requestsCollateralFile({ output }: ScorerArgs): OutreachScore {
  const body = output.body.toLowerCase();
  const asks = /collateral file|collateral package|original note|recorded mortgage|assignment/.test(
    body,
  );
  return { name: 'requests_collateral_file', score: asks ? 1 : 0 };
}

export const OUTREACH_SCORERS = [
  noLegalAdvice,
  containsDealReference,
  noPiiLeak,
  professionalB2bTone,
  requestsCollateralFile,
];
```

- [ ] **Step 2: Create `packages/agents/servicer-outreach/evals/fixtures.ts`** (25 fixtures ≥ the spec's 20 minimum)

```ts
import type { DraftEmailInput } from '../src/draft';

// 5 servicers (incl. the null/unknown case) x 5 touch numbers = 25 fixtures.
// Deal references are opaque tokens (one includes a UUID-style digit run to
// exercise the no_pii_leak strip).
const SERVICERS: (string | null)[] = [
  'Acme Loan Servicing',
  'Nationstar Mortgage',
  'Cenlar FSB',
  'Mr. Cooper',
  null,
];

const DEAL_REFERENCES = [
  'deal-acme-0001',
  'deal-nationstar-0002',
  'deal-cenlar-0003',
  '550e8400-e29b-41d4-a716-446655440000',
  'deal-unknown-0005',
];

export const OUTREACH_FIXTURES: DraftEmailInput[] = SERVICERS.flatMap((servicerName, i) =>
  [1, 2, 3, 4, 5].map((touchNumber) => ({
    servicerName,
    touchNumber,
    dealReference: DEAL_REFERENCES[i],
  })),
);
```

- [ ] **Step 3: Create `packages/agents/servicer-outreach/evals/scorers.test.ts`** (the real CI compliance gate)

```ts
import { describe, expect, it } from 'vitest';

import { renderTemplateEmail, type DraftEmailInput } from '../src/draft';

import { OUTREACH_FIXTURES } from './fixtures';
import {
  containsDealReference,
  noLegalAdvice,
  noPiiLeak,
  professionalB2bTone,
  requestsCollateralFile,
  type OutreachEmail,
} from './scorers';

const input: DraftEmailInput = {
  servicerName: 'Acme Loan Servicing',
  touchNumber: 1,
  dealReference: 'deal-abc-123',
};

describe('noLegalAdvice', () => {
  it('passes an operational request', () => {
    const output: OutreachEmail = { subject: 'x', body: 'Please send the collateral file.' };
    expect(noLegalAdvice({ input, output }).score).toBe(1);
  });
  it('fails text that gives legal advice', () => {
    const output: OutreachEmail = {
      subject: 'x',
      body: 'As your attorney, we advise you to sign.',
    };
    expect(noLegalAdvice({ input, output }).score).toBe(0);
  });
});

describe('containsDealReference', () => {
  it('passes when the body carries the reference', () => {
    const output: OutreachEmail = { subject: 'x', body: 'Re: deal-abc-123 — please reply.' };
    expect(containsDealReference({ input, output }).score).toBe(1);
  });
  it('fails when the reference is missing', () => {
    const output: OutreachEmail = { subject: 'x', body: 'Please reply.' };
    expect(containsDealReference({ input, output }).score).toBe(0);
  });
});

describe('noPiiLeak', () => {
  it('passes a clean body', () => {
    const output: OutreachEmail = {
      subject: 'x',
      body: 'Re: deal-abc-123 — collateral file please.',
    };
    expect(noPiiLeak({ input, output }).score).toBe(1);
  });
  it('fails an SSN', () => {
    const output: OutreachEmail = { subject: 'x', body: 'SSN 123-45-6789 attached.' };
    expect(noPiiLeak({ input, output }).score).toBe(0);
  });
  it('fails a labeled loan number', () => {
    const output: OutreachEmail = { subject: 'x', body: 'Loan number 100482233 enclosed.' };
    expect(noPiiLeak({ input, output }).score).toBe(0);
  });
  it('does NOT flag a UUID deal reference (opaque id, not PII)', () => {
    const uuidInput: DraftEmailInput = {
      servicerName: null,
      touchNumber: 1,
      dealReference: '550e8400-e29b-41d4-a716-446655440000',
    };
    const output: OutreachEmail = {
      subject: 'x',
      body: 'Deal reference: 550e8400-e29b-41d4-a716-446655440000. Please send the file.',
    };
    expect(noPiiLeak({ input: uuidInput, output }).score).toBe(1);
  });
});

describe('professionalB2bTone', () => {
  it('passes a greeting + sign-off', () => {
    const output: OutreachEmail = { subject: 'x', body: 'Dear team,\nPlease help.\nThank you.' };
    expect(professionalB2bTone({ input, output }).score).toBe(1);
  });
  it('fails shouting with no structure', () => {
    const output: OutreachEmail = { subject: 'x', body: 'SENDMETHEFILERIGHTNOWIMMEDIATELY' };
    expect(professionalB2bTone({ input, output }).score).toBe(0);
  });
});

describe('requestsCollateralFile', () => {
  it('passes when it asks for the collateral file', () => {
    const output: OutreachEmail = { subject: 'x', body: 'Please send the collateral file.' };
    expect(requestsCollateralFile({ input, output }).score).toBe(1);
  });
  it('fails an off-topic body', () => {
    const output: OutreachEmail = { subject: 'x', body: 'Happy holidays from our team!' };
    expect(requestsCollateralFile({ input, output }).score).toBe(0);
  });
});

describe('template floor passes every compliance scorer over all fixtures', () => {
  it.each(OUTREACH_FIXTURES)('servicer=$servicerName touch=$touchNumber', (fixture) => {
    const output = renderTemplateEmail(fixture);
    for (const scorer of [
      noLegalAdvice,
      containsDealReference,
      noPiiLeak,
      professionalB2bTone,
      requestsCollateralFile,
    ]) {
      expect(scorer({ input: fixture, output }).score).toBe(1);
    }
  });
});
```

- [ ] **Step 4: Run the scorer test to verify it passes**

```bash
pnpm --filter @cema/agents-servicer-outreach exec vitest run evals/scorers.test.ts
```

Expected: PASS. The final `describe` is the load-bearing assertion — it proves the deterministic template floor is compliance-clean for all 25 fixtures, so even with the LLM off the agent never emits a non-compliant email.

### Task 6.2 — Braintrust wiring + skip-green runner

- [ ] **Step 1: Create `packages/agents/servicer-outreach/evals/outreach-email.eval.ts`**

```ts
/**
 * Braintrust eval for the outreach email. Calls the live model via
 * `draftOutreachEmail` for each fixture and grades it with the pure, unit-tested
 * scorers in `./scorers`. Gated behind `./run.mjs`, which skips (exit 0) unless
 * BOTH BRAINTRUST_API_KEY and AI_GATEWAY_API_KEY are present — so CI stays green
 * without keys while the compliance logic stays verified by the Unit tests job.
 */

import { Eval } from 'braintrust';

import { draftOutreachEmail, type DraftEmailInput } from '../src/draft';

import { OUTREACH_FIXTURES } from './fixtures';
import { OUTREACH_SCORERS, type OutreachEmail } from './scorers';

void Eval<DraftEmailInput, OutreachEmail>('cema-servicer-outreach-email', {
  // Non-PII metadata for legible traces: servicer org name + touch number only.
  data: () =>
    OUTREACH_FIXTURES.map((fixture) => ({
      input: fixture,
      metadata: {
        servicerName: fixture.servicerName ?? '(unknown)',
        touchNumber: fixture.touchNumber,
        dealReference: fixture.dealReference,
      },
    })),

  // draftOutreachEmail NEVER returns null (template floor), so no null guard is
  // needed here — the LLM polish is the only non-deterministic part.
  task: async (input: DraftEmailInput): Promise<OutreachEmail> => draftOutreachEmail(input),

  scores: OUTREACH_SCORERS,
});
```

- [ ] **Step 2: Create `packages/agents/servicer-outreach/evals/run.mjs`** (skip-green wrapper, mirrors intake)

```js
#!/usr/bin/env node
/**
 * Skip-green wrapper for the outreach-email Braintrust eval. The eval makes a
 * live model call (AI_GATEWAY_API_KEY) AND logs to Braintrust (BRAINTRUST_API_KEY);
 * neither is provisioned in CI. If either key is absent, log why and exit 0 —
 * keeping the non-blocking `llm-eval` job green. The compliance logic the eval
 * grades is verified independently by evals/scorers.test.ts in the Unit tests job.
 */
import { spawnSync } from 'node:child_process';

const REQUIRED_KEYS = ['BRAINTRUST_API_KEY', 'AI_GATEWAY_API_KEY'];
const missing = REQUIRED_KEYS.filter((key) => !process.env[key]);

if (missing.length > 0) {
  console.log(
    `[outreach eval] skipped — missing ${missing.join(', ')}. ` +
      'Scorers are verified offline by evals/scorers.test.ts; provision both keys to run the live eval.',
  );
  process.exit(0);
}

const result = spawnSync('pnpm exec braintrust eval evals/outreach-email.eval.ts', {
  stdio: 'inherit',
  shell: true,
});

process.exit(result.status ?? 1);
```

- [ ] **Step 3: Add the `eval` script + `braintrust` devDep to `packages/agents/servicer-outreach/package.json`** (PR-1 created the base; add these)

```jsonc
{
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "eval": "node evals/run.mjs", // add
  },
  "devDependencies": {
    "braintrust": "^3.13.0", // add (match the intake package version)
  },
}
```

- [ ] **Step 4: `chmod +x` the runner, install, verify skip-green, format, commit**

```bash
chmod +x packages/agents/servicer-outreach/evals/run.mjs
pnpm install
pnpm --filter @cema/agents-servicer-outreach eval   # expect: "[outreach eval] skipped — missing ..."; exit 0
pnpm --filter @cema/agents-servicer-outreach typecheck
pnpm exec prettier --write "packages/agents/servicer-outreach/evals/*.ts" packages/agents/servicer-outreach/package.json
git add packages/agents/servicer-outreach/evals/ packages/agents/servicer-outreach/package.json pnpm-lock.yaml
git commit -S -F - <<'EOF'
feat(m12): Braintrust eval for the outreach email (5 compliance scorers)

Two-tier eval mirroring the intake narrative: five pure scorers (no UPL, no PII
leak to a third party, deal reference present, professional B2B tone, requests
the collateral file) verified OFFLINE by scorers.test.ts in the required Unit
tests job — the real compliance gate — over all 25 fixtures' template-floor
output. The live Braintrust run grades only the LLM polish and is skip-green via
run.mjs unless both BRAINTRUST_API_KEY and AI_GATEWAY_API_KEY are provisioned.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

- [ ] **Step 5: Push, PR, auto-merge, drive to green, update local main.**

---

## PR-7 — ADR 0014 + CLAUDE.md milestone closure

**Goal:** Record the architecture in an ADR and close M12 in CLAUDE.md. **No spec edit** (hard rule #11) — the spec's §9.4 already describes the Servicer Outreach Agent; if reality diverges, raise it as a question for a separate Connor-approved spec PR. This PR is docs-only.

**Files:**

- Create: `docs/adr/0014-phase-1-month-12-servicer-outreach-agent.md`
- Modify: `CLAUDE.md` (§2 status block + Changelog row)

### Task 7.1 — Write ADR 0014

- [ ] **Step 1: Create `docs/adr/0014-phase-1-month-12-servicer-outreach-agent.md`** (finalize PR numbers + the 21st-package test counts at close)

```markdown
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
`outreach.record_touch`) via `withChildSpan`. Attributes are PII-safe by allowlist
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
`apps/web/lib/agents/servicer-outreach/` app wiring. 0 new migrations. (Fill in
the final per-file table and test counts at close, mirroring ADR 0013's table.)

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
   `/.well-known/workflow/*` from the `proxy.ts` matcher, flip behind a flag.
6. **Trace the durable steps** + provision `BRAINTRUST_API_KEY`/`AI_GATEWAY_API_KEY`.
```

### Task 7.2 — Close M12 in CLAUDE.md

- [ ] **Step 1: Update the `§2` status block** — lead with M12 shipped (mirror how M11 PR-B was folded in): add the Servicer Outreach Agent one-liner, bump the package count to **21** (`@cema/agents-servicer-outreach`), note **0 new migrations**, and add the six M12 carry-overs. Demote the M11 "Next step" line to point at **M13** (the next Layer 3 agent or the real Encompass/Resend adapters).

- [ ] **Step 2: Add a Changelog row** (bottom of CLAUDE.md):

```
| 2026-05-30 | M12 Servicer Outreach Agent closed: `@cema/agents-servicer-outreach` (21st package) — pure cadence evaluator (business-day offsets [0,5,10,15,20], stable anchor) triggered by `collateral_chase`, email-only behind a `ServicerChannelAdapter` seam, env-gated LLM polish (template floor, never null), split audit, OTel parent+child spans, dormant WDK durable wrap reusing the core as one step (ADR 0013 improvement), Braintrust eval (5 offline compliance scorers as the real gate). 0 new migrations. ADR 0014. | Claude Opus 4.8 + Connor |
```

- [ ] **Step 3: Format + commit**

```bash
pnpm exec prettier --write docs/adr/0014-phase-1-month-12-servicer-outreach-agent.md CLAUDE.md
git add docs/adr/0014-phase-1-month-12-servicer-outreach-agent.md CLAUDE.md
git commit -S -F - <<'EOF'
docs(m12): ADR 0014 + CLAUDE.md closure for the Servicer Outreach Agent

Records the M12 architecture (pure cadence evaluator, collateral_chase trigger,
email-only channel seam, additive LLM polish, split audit, OTel, durable wrap
reusing the core as one step, offline-scorer eval gate) and closes M12 in the
CLAUDE.md §2 status block + changelog. No spec edit (hard rule #11).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

- [ ] **Step 4: Push, PR, auto-merge, drive to green, update local main.**

---

## PR dependency order

PRs are sequential — each builds on the package state of the prior, and each must be merged (signed, green, auto-merge) before the next branches off the new `main`:

| PR   | Title                              | Depends on | Touches                                                                                                   |
| ---- | ---------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------- |
| PR-1 | Package scaffold + types + cadence | —          | `packages/agents/servicer-outreach/src/{types,cadence,index}`                                             |
| PR-2 | Fixture channel adapter            | PR-1       | `src/channel.ts`                                                                                          |
| PR-3 | Email draft (template + gated LLM) | PR-1       | `src/{draft,classify}.ts`                                                                                 |
| PR-4 | Orchestrator + dormant app wiring  | PR-2, PR-3 | `src/orchestrator.ts`, `apps/web/lib/agents/servicer-outreach/{deps,run-outreach-action}.ts`              |
| PR-5 | Dormant WDK durable wrap           | PR-4       | `apps/web/lib/agents/servicer-outreach/{outreach.steps,outreach.workflow,run-outreach-durable-action}.ts` |
| PR-6 | Braintrust eval                    | PR-3       | `packages/agents/servicer-outreach/evals/`                                                                |
| PR-7 | ADR 0014 + CLAUDE.md closure       | PR-1…PR-6  | `docs/adr/0014…`, `CLAUDE.md`                                                                             |

PR-6 only needs PR-3 (it grades `draftOutreachEmail`), so it may land before or after PR-4/PR-5. Keep the linear-history discipline: `git pull --rebase origin main` on each new branch.

## Decisions needed from Connor (do NOT auto-attempt — hand back)

1. **NY holiday calendar source** for `addBusinessDays` (carry-over). Until provided, the cadence counts weekdays only; a touch could land on a federal/NY holiday. Acceptable for the dormant phase; must resolve before live activation.
2. **`RESEND_API_KEY`** (+ a verified sending domain) to build/wire the real channel adapter. The agent is dormant without it.
3. **Confirm the `anthropic/claude-sonnet-4.6` Gateway slug** against the live catalog once `AI_GATEWAY_API_KEY` is provisioned (shared with M11 carry-over).
4. **Design partner** (spec §13.1) — needed to validate the cadence cap (5 touches over 20 business days) and the email copy against a real servicer relationship before going live.
5. **WDK backend + `VERCEL_OIDC_TOKEN`** to activate the durable path (shared with ADR 0013).

## Risks

- **Cadence drift on replay** — mitigated by the stable earliest-touch anchor; covered by a deterministic cadence test (PR-1) asserting identical `dueAt[]` across re-evaluations.
- **PII leak to a third-party servicer** — the highest-severity risk. Mitigated three ways: the template floor carries no PII by construction; the LLM prompt forbids inventing numbers/names; the `noPiiLeak` scorer gates the eval. Spans + step logs carry ids/booleans only.
- **Double-send on retry/replay** — mitigated by the `vendorEventId` unique index and WDK step-result caching; a resumed run replays the recorded touch from cache rather than re-sending.
- **Dormant code rot** — the durable action + channel seam are unverified against a real backend until activation; the mocked-step + fixture tests keep the shape honest meanwhile.

## Self-review

- **Spec coverage (§9.4):** trigger (`collateral_chase`) ✓, email-only ✓, multi-touch cadence ✓, ≥90%-automation target served by the evaluator ✓, audit trail ✓, attorney-gate untouched (outreach sends no legal documents — it requests them) ✓.
- **Placeholder scan:** the only fill-at-execution values are PR numbers and final test counts in PR-7's ADR/CLAUDE.md (genuinely unknowable until the PRs open) — flagged explicitly, not lazy TODOs. All code steps carry complete code.
- **Type consistency:** `OutreachResult`, `OutreachAction` (incl. `unsupported_channel`), `OutreachDeps`, `DraftEmailInput`, `OutreachEmail`, `ServicerChannelAdapter` are used identically across PR-1→PR-6. `draftOutreachEmail` returns `{subject, body}` everywhere (never null). `sleep(date)`/`start`/`returnValue` match the confirmed WDK 4.2.5 API.
- **0 new migrations** confirmed against the existing `communications`/`existing_loans`/`servicer_cema_departments`/`audit_events` schema.
