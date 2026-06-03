# Remaining-Agent Offline Braintrust Evals — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add offline Braintrust evals to the 4 Layer-3 agents that lack them (Recording Prep, Exception Triage, Internal Comms, Borrower Comms), bringing eval coverage from 5/9 → 9/9.

**Architecture:** Each agent gets a self-contained `evals/` dir mirroring the shipped Doc-Gen pattern (PR #139): `fixtures.ts` (input + independently-computed `expected`), `scorers.ts` (pure `{input, expected, output} → {name, score}` fns + a `runX` that calls the real pure core), `scorers.test.ts` (the **real CI gate** — `it.each` asserts every scorer scores 1), `<agent>.eval.ts` (the live Braintrust run), `run.mjs` (skip-green guard on `BRAINTRUST_API_KEY` only — no agent calls an LLM). No agent source changes. The number of scorers is right-sized to each agent's real invariant surface (Recording Prep 5; Triage 4; Borrower 4; Internal 3) — not padded to a fixed count.

**Tech Stack:** TypeScript (strict), Vitest, Braintrust `^3.13.0`, `@cema/collateral` (Recording Prep gate set only).

---

## File Structure

Per agent (`packages/agents/<agent>/`):

- Create `evals/fixtures.ts` — `<AGENT>_FIXTURES`: `{name, input, expected}[]`. `expected` is restated by hand (a regression guard, never a call into the impl).
- Create `evals/scorers.ts` — pure scorers + `runX(input)` calling the real core. Where a static map is asserted, the map is **re-declared** here independently.
- Create `evals/scorers.test.ts` — `it.each(<AGENT>_FIXTURES)`, runs the core, asserts every scorer === 1. This is what `pnpm test` runs; the real gate.
- Create `evals/<agent>.eval.ts` — `void Eval(...)` reusing the same fixtures + scorers.
- Create `evals/run.mjs` — skip-green guard, else `pnpm exec braintrust eval evals/<agent>.eval.ts`.
- Modify `package.json` — add `"eval": "node evals/run.mjs"` to `scripts`; add `"braintrust": "^3.13.0"` to `devDependencies`.

Shared (root): `pnpm install` once after all 4 `package.json` edits (lockfile), then full verify + one PR.

**Branch:** `feat/agent-evals-batch`. Sign every commit (`git commit -S`).

---

## Reference templates (identical shape per agent — names swapped)

`evals/<agent>.eval.ts`:

```ts
import { Eval } from 'braintrust';

import type { <InputType>, <OutputType> } from '../src/types';

import { <AGENT>_FIXTURES } from './fixtures';
import type { <Agent>Expected } from './scorers';
import { <AGENT>_SCORERS, run<X> } from './scorers';

// Live Braintrust eval over the deterministic core. The offline scorers.test.ts
// is the real gate; this run is skip-green unless BRAINTRUST_API_KEY is set
// (run.mjs guards it). The scorers already take Braintrust's { input, output,
// expected } arg shape, so they pass directly.
void Eval<<InputType>, <OutputType>, <Agent>Expected>('<agent-name>', {
  data: <AGENT>_FIXTURES.map((f) => ({
    input: f.input,
    expected: f.expected,
    metadata: { name: f.name },
  })),
  task: (input) => run<X>(input),
  scores: [...<AGENT>_SCORERS],
});
```

`evals/run.mjs` (identical except the `eval.ts` path + log label):

```js
import { spawnSync } from 'node:child_process';

// This agent makes no model call, so the only key the live eval needs is Braintrust.
const REQUIRED_KEYS = ['BRAINTRUST_API_KEY'];
const missing = REQUIRED_KEYS.filter((k) => !process.env[k]);

if (missing.length > 0) {
  console.log(`[<agent-name> eval] skipped -- missing env: ${missing.join(', ')}`);
  process.exit(0);
}

const result = spawnSync('pnpm', ['exec', 'braintrust', 'eval', 'evals/<agent-name>.eval.ts'], {
  stdio: 'inherit',
  shell: true,
});

process.exit(result.status ?? 1);
```

`package.json` edit (every agent already has `@cema/config`, `@types/node`, `typescript`, `vitest` as devDeps — verify, then add only `braintrust`):

```jsonc
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "eval": "node evals/run.mjs"   // <-- add
  },
  "devDependencies": {
    // ...existing...
    "braintrust": "^3.13.0"        // <-- add
  }
```

---

## Task 1: Recording Prep eval (`@cema/agents-recording-prep`)

**Files:**

- Create: `packages/agents/recording-prep/evals/fixtures.ts`
- Create: `packages/agents/recording-prep/evals/scorers.ts`
- Create: `packages/agents/recording-prep/evals/scorers.test.ts`
- Create: `packages/agents/recording-prep/evals/recording-prep.eval.ts`
- Create: `packages/agents/recording-prep/evals/run.mjs`
- Modify: `packages/agents/recording-prep/package.json`

- [ ] **Step 1: Create `evals/fixtures.ts`**

```ts
import type { DocumentKind } from '@cema/collateral';

import type { DealRecordingInput, RecordingVenue } from '../src/types';

export interface RecordingFixture {
  readonly name: string;
  readonly input: DealRecordingInput;
  readonly expected: {
    readonly venue: RecordingVenue;
    readonly borough: number | null;
    readonly kinds: readonly DocumentKind[];
    readonly total: number;
  };
}

// Fee math restated independently (regression guard): base 40 + 5*pageCount +
// flat county (Nassau 355, Suffolk 300, else 0). Default pageCount = 40 -> 240.
const ACRIS_REFI: readonly DocumentKind[] = ['acris_cover_pages'];
const COUNTY_REFI: readonly DocumentKind[] = ['county_cover_sheet'];
const ACRIS_PURCHASE: readonly DocumentKind[] = ['acris_cover_pages', 'nyc_rpt', 'tp_584'];
const COUNTY_PURCHASE: readonly DocumentKind[] = ['county_cover_sheet', 'tp_584'];

export const RECORDING_FIXTURES: readonly RecordingFixture[] = [
  // --- BBL-driven venue (refi, acris); BBL borough digit wins ---
  {
    name: 'BBL borough 1 (Manhattan)',
    input: { dealId: 'rp-01', cemaType: 'refi_cema', county: 'New York', acrisBbl: '1-00123-0045' },
    expected: { venue: 'acris', borough: 1, kinds: ACRIS_REFI, total: 240 },
  },
  {
    name: 'BBL borough 2 (Bronx)',
    input: { dealId: 'rp-02', cemaType: 'refi_cema', county: 'Bronx', acrisBbl: '2-00500-0010' },
    expected: { venue: 'acris', borough: 2, kinds: ACRIS_REFI, total: 240 },
  },
  {
    name: 'BBL borough 3 (Brooklyn)',
    input: { dealId: 'rp-03', cemaType: 'refi_cema', county: 'Kings', acrisBbl: '3-01000-0001' },
    expected: { venue: 'acris', borough: 3, kinds: ACRIS_REFI, total: 240 },
  },
  {
    name: 'BBL borough 4 (Queens)',
    input: { dealId: 'rp-04', cemaType: 'refi_cema', county: 'Queens', acrisBbl: '4-02000-0123' },
    expected: { venue: 'acris', borough: 4, kinds: ACRIS_REFI, total: 240 },
  },
  {
    name: 'BBL borough 5 (Staten Island)',
    input: { dealId: 'rp-05', cemaType: 'refi_cema', county: 'Richmond', acrisBbl: '5-00077-0007' },
    expected: { venue: 'acris', borough: 5, kinds: ACRIS_REFI, total: 240 },
  },
  {
    name: 'BBL wins over a mismatched upstate county name',
    input: { dealId: 'rp-06', cemaType: 'refi_cema', county: 'Albany', acrisBbl: '3-00123-0045' },
    expected: { venue: 'acris', borough: 3, kinds: ACRIS_REFI, total: 240 },
  },
  // --- County-name fallback (acrisBbl null, NYC county/alias) ---
  {
    name: 'county fallback: New York -> 1',
    input: { dealId: 'rp-07', cemaType: 'refi_cema', county: 'New York', acrisBbl: null },
    expected: { venue: 'acris', borough: 1, kinds: ACRIS_REFI, total: 240 },
  },
  {
    name: 'county fallback alias: Manhattan -> 1',
    input: { dealId: 'rp-08', cemaType: 'refi_cema', county: 'Manhattan', acrisBbl: null },
    expected: { venue: 'acris', borough: 1, kinds: ACRIS_REFI, total: 240 },
  },
  {
    name: 'county fallback: Bronx -> 2',
    input: { dealId: 'rp-09', cemaType: 'refi_cema', county: 'Bronx', acrisBbl: null },
    expected: { venue: 'acris', borough: 2, kinds: ACRIS_REFI, total: 240 },
  },
  {
    name: 'county fallback: Kings -> 3',
    input: { dealId: 'rp-10', cemaType: 'refi_cema', county: 'Kings', acrisBbl: null },
    expected: { venue: 'acris', borough: 3, kinds: ACRIS_REFI, total: 240 },
  },
  {
    name: 'county fallback alias: Brooklyn -> 3',
    input: { dealId: 'rp-11', cemaType: 'refi_cema', county: 'Brooklyn', acrisBbl: null },
    expected: { venue: 'acris', borough: 3, kinds: ACRIS_REFI, total: 240 },
  },
  {
    name: 'county fallback: Queens -> 4',
    input: { dealId: 'rp-12', cemaType: 'refi_cema', county: 'Queens', acrisBbl: null },
    expected: { venue: 'acris', borough: 4, kinds: ACRIS_REFI, total: 240 },
  },
  {
    name: 'county fallback: Richmond -> 5',
    input: { dealId: 'rp-13', cemaType: 'refi_cema', county: 'Richmond', acrisBbl: null },
    expected: { venue: 'acris', borough: 5, kinds: ACRIS_REFI, total: 240 },
  },
  {
    name: 'county fallback alias: Staten Island -> 5',
    input: { dealId: 'rp-14', cemaType: 'refi_cema', county: 'Staten Island', acrisBbl: null },
    expected: { venue: 'acris', borough: 5, kinds: ACRIS_REFI, total: 240 },
  },
  {
    name: 'county fallback is case/whitespace-insensitive',
    input: { dealId: 'rp-15', cemaType: 'refi_cema', county: '  QUEENS ', acrisBbl: null },
    expected: { venue: 'acris', borough: 4, kinds: ACRIS_REFI, total: 240 },
  },
  // --- Upstate county venue (acrisBbl null, non-NYC county) ---
  {
    name: 'upstate Nassau: county venue + flat $355',
    input: { dealId: 'rp-16', cemaType: 'refi_cema', county: 'Nassau', acrisBbl: null },
    expected: { venue: 'county', borough: null, kinds: COUNTY_REFI, total: 595 },
  },
  {
    name: 'upstate Suffolk: county venue + flat $300',
    input: { dealId: 'rp-17', cemaType: 'refi_cema', county: 'Suffolk', acrisBbl: null },
    expected: { venue: 'county', borough: null, kinds: COUNTY_REFI, total: 540 },
  },
  {
    name: 'upstate Westchester: county venue, no flat',
    input: { dealId: 'rp-18', cemaType: 'refi_cema', county: 'Westchester', acrisBbl: null },
    expected: { venue: 'county', borough: null, kinds: COUNTY_REFI, total: 240 },
  },
  {
    name: 'upstate Erie: county venue, no flat',
    input: { dealId: 'rp-19', cemaType: 'refi_cema', county: 'Erie', acrisBbl: null },
    expected: { venue: 'county', borough: null, kinds: COUNTY_REFI, total: 240 },
  },
  {
    name: 'upstate Albany: county venue, no flat',
    input: { dealId: 'rp-20', cemaType: 'refi_cema', county: 'Albany', acrisBbl: null },
    expected: { venue: 'county', borough: null, kinds: COUNTY_REFI, total: 240 },
  },
  // --- Purchase CEMA: adds nyc_rpt (acris only) + tp_584 (both venues) ---
  {
    name: 'purchase + acris (county fallback) -> +nyc_rpt +tp_584',
    input: { dealId: 'rp-21', cemaType: 'purchase_cema', county: 'Queens', acrisBbl: null },
    expected: { venue: 'acris', borough: 4, kinds: ACRIS_PURCHASE, total: 240 },
  },
  {
    name: 'purchase + acris (BBL) -> +nyc_rpt +tp_584',
    input: {
      dealId: 'rp-22',
      cemaType: 'purchase_cema',
      county: 'New York',
      acrisBbl: '1-00010-0001',
    },
    expected: { venue: 'acris', borough: 1, kinds: ACRIS_PURCHASE, total: 240 },
  },
  {
    name: 'purchase + county -> +tp_584 only (no nyc_rpt upstate)',
    input: { dealId: 'rp-23', cemaType: 'purchase_cema', county: 'Westchester', acrisBbl: null },
    expected: { venue: 'county', borough: null, kinds: COUNTY_PURCHASE, total: 240 },
  },
  {
    name: 'purchase + county with flat fee',
    input: { dealId: 'rp-24', cemaType: 'purchase_cema', county: 'Nassau', acrisBbl: null },
    expected: { venue: 'county', borough: null, kinds: COUNTY_PURCHASE, total: 595 },
  },
  // --- Explicit pageCount overrides the default estimate ---
  {
    name: 'explicit pageCount 50 (county): 40 + 5*50 = 290',
    input: {
      dealId: 'rp-25',
      cemaType: 'refi_cema',
      county: 'Erie',
      acrisBbl: null,
      pageCount: 50,
    },
    expected: { venue: 'county', borough: null, kinds: COUNTY_REFI, total: 290 },
  },
  {
    name: 'explicit pageCount 35 (acris): 40 + 5*35 = 215',
    input: {
      dealId: 'rp-26',
      cemaType: 'refi_cema',
      county: 'Queens',
      acrisBbl: null,
      pageCount: 35,
    },
    expected: { venue: 'acris', borough: 4, kinds: ACRIS_REFI, total: 215 },
  },
];
```

- [ ] **Step 2: Create `evals/scorers.ts`**

```ts
import { GATE_REQUIRED_KINDS, type DocumentKind } from '@cema/collateral';

import { planRecording } from '../src/plan';
import type { DealRecordingInput, RecordingPlan } from '../src/types';

import type { RecordingFixture } from './fixtures';

export type RecordingExpected = RecordingFixture['expected'];

export interface RecordingScorerArgs {
  readonly input: DealRecordingInput;
  readonly expected: RecordingExpected;
  readonly output: RecordingPlan;
}

export interface RecordingScore {
  readonly name: string;
  readonly score: number;
}

const GATE_SET = new Set<DocumentKind>(GATE_REQUIRED_KINDS);
const sortedJoin = (xs: readonly string[]): string => [...xs].sort().join(',');

// 1) Venue + borough resolution matches (BBL digit wins, then county-name
//    fallback, else upstate county clerk with a null borough).
function venueCorrect({ output, expected }: RecordingScorerArgs): RecordingScore {
  const ok = output.venue === expected.venue && output.borough === expected.borough;
  return { name: 'venue-correct', score: ok ? 1 : 0 };
}

// 2) The emitted cover-sheet kind multiset matches expected (venue x CEMA-type).
function coverSheetsCorrect({ output, expected }: RecordingScorerArgs): RecordingScore {
  const got = sortedJoin(output.coverSheets.map((c) => c.kind));
  const want = sortedJoin(expected.kinds);
  return { name: 'cover-sheets-correct', score: got === want ? 1 : 0 };
}

// 3) MIXED attorney-gate (hard rule #2). Unlike Doc-Gen (every kind gated), this
//    agent emits a mix -- county_cover_sheet IS gate-required; acris_cover_pages,
//    nyc_rpt, tp_584 are NOT. Each sheet's flag must equal GATE_REQUIRED_KINDS.
function attorneyGateCorrect({ output }: RecordingScorerArgs): RecordingScore {
  const ok = output.coverSheets.every((c) => c.attorneyReviewRequired === GATE_SET.has(c.kind));
  return { name: 'attorney-gate-correct', score: ok ? 1 : 0 };
}

// 4) No PII in the cover-sheet field-maps (hard rule #3): field keys stay within
//    a PII-free allowlist and no string value is SSN- or account-number-shaped.
//    (Recording input carries no borrower name, so the invariant is structural.)
const FIELD_KEY_ALLOWLIST = new Set(['dealId', 'venue', 'county', 'total']);
const SSN = /\b\d{3}-\d{2}-\d{4}\b/;
const LONG_DIGIT_RUN = /\d{7,}/;
function noPiiLeak({ output }: RecordingScorerArgs): RecordingScore {
  const leaked = output.coverSheets.some((c) =>
    Object.entries(c.fields).some(([k, v]) => {
      if (!FIELD_KEY_ALLOWLIST.has(k)) return true;
      if (typeof v !== 'string') return false;
      return SSN.test(v) || LONG_DIGIT_RUN.test(v);
    }),
  );
  return { name: 'no-pii-leak', score: leaked ? 0 : 1 };
}

// 5) The placeholder fee total ties out (base + per-page*pages + flat county).
function feeCorrect({ output, expected }: RecordingScorerArgs): RecordingScore {
  return { name: 'fee-correct', score: output.fees.total === expected.total ? 1 : 0 };
}

export const RECORDING_SCORERS = [
  venueCorrect,
  coverSheetsCorrect,
  attorneyGateCorrect,
  noPiiLeak,
  feeCorrect,
] as const;

export function runPlan(input: DealRecordingInput): RecordingPlan {
  return planRecording(input);
}
```

- [ ] **Step 3: Create `evals/scorers.test.ts`**

```ts
import { describe, expect, it } from 'vitest';

import { RECORDING_FIXTURES } from './fixtures';
import { RECORDING_SCORERS, runPlan } from './scorers';

describe('Recording-Prep offline compliance gate', () => {
  it.each(RECORDING_FIXTURES)('all scorers pass for: $name', (fixture) => {
    const output = runPlan(fixture.input);
    for (const scorer of RECORDING_SCORERS) {
      const result = scorer({ input: fixture.input, expected: fixture.expected, output });
      expect(result.score, `${result.name} failed for ${fixture.name}`).toBe(1);
    }
  });
});
```

- [ ] **Step 4: Run the offline gate — expect green (the core already works)**

Run: `cmd /c "pnpm --filter @cema/agents-recording-prep test"`
Expected: PASS, the new `Recording-Prep offline compliance gate` suite shows 26 cases green. A failure here means a hand-computed `expected` (venue/kinds/total) is wrong — fix the fixture, not the agent.

- [ ] **Step 5: Create `evals/recording-prep.eval.ts`** (from the reference template)

```ts
import { Eval } from 'braintrust';

import type { DealRecordingInput, RecordingPlan } from '../src/types';

import { RECORDING_FIXTURES } from './fixtures';
import type { RecordingExpected } from './scorers';
import { RECORDING_SCORERS, runPlan } from './scorers';

void Eval<DealRecordingInput, RecordingPlan, RecordingExpected>('recording-prep', {
  data: RECORDING_FIXTURES.map((f) => ({
    input: f.input,
    expected: f.expected,
    metadata: { name: f.name },
  })),
  task: (input) => runPlan(input),
  scores: [...RECORDING_SCORERS],
});
```

- [ ] **Step 6: Create `evals/run.mjs`** (from the reference template, label `recording-prep`)

- [ ] **Step 7: Modify `package.json`** — add `"eval": "node evals/run.mjs"` to `scripts`, `"braintrust": "^3.13.0"` to `devDependencies`.

- [ ] **Step 8: Commit**

```bash
git add packages/agents/recording-prep/evals packages/agents/recording-prep/package.json
git commit -S -m "test(recording-prep): offline Braintrust eval (5 scorers, 26 fixtures)"
```

---

## Task 2: Exception Triage eval (`@cema/agents-exception-triage`)

**Files:** `evals/{fixtures,scorers,scorers.test,exception-triage.eval,run.mjs}.ts/.mjs` + `package.json`.

- [ ] **Step 1: Create `evals/fixtures.ts`**

```ts
import type { DealSignals, ExceptionKind } from '../src/types';

export interface TriageFixture {
  readonly name: string;
  readonly input: DealSignals;
  readonly expected: { readonly kinds: readonly ExceptionKind[] };
}

function sig(
  dealStatus: string,
  chainBreakCount: number,
  dispatchFailed: boolean,
  recordingRejected: boolean,
): DealSignals {
  return { dealStatus, chainBreakCount, dispatchFailed, recordingRejected };
}

export const TRIAGE_FIXTURES: readonly TriageFixture[] = [
  // --- Single signal ---
  {
    name: 'chain break only',
    input: sig('title_work', 1, false, false),
    expected: { kinds: ['chain_break'] },
  },
  {
    name: 'dispatch failure only',
    input: sig('doc_prep', 0, true, false),
    expected: { kinds: ['agent_dispatch_failed'] },
  },
  {
    name: 'flagged exception only',
    input: sig('exception', 0, false, false),
    expected: { kinds: ['deal_flagged_exception'] },
  },
  {
    name: 'rejected recording only',
    input: sig('recording', 0, false, true),
    expected: { kinds: ['rejected_recording'] },
  },
  // --- Combinations ---
  {
    name: 'chain + dispatch',
    input: sig('title_work', 2, true, false),
    expected: { kinds: ['chain_break', 'agent_dispatch_failed'] },
  },
  {
    name: 'flagged + rejected',
    input: sig('exception', 0, false, true),
    expected: { kinds: ['deal_flagged_exception', 'rejected_recording'] },
  },
  {
    name: 'chain + flagged',
    input: sig('exception', 3, false, false),
    expected: { kinds: ['chain_break', 'deal_flagged_exception'] },
  },
  {
    name: 'dispatch + flagged',
    input: sig('exception', 0, true, false),
    expected: { kinds: ['agent_dispatch_failed', 'deal_flagged_exception'] },
  },
  {
    name: 'all four signals',
    input: sig('exception', 1, true, true),
    expected: {
      kinds: [
        'chain_break',
        'agent_dispatch_failed',
        'deal_flagged_exception',
        'rejected_recording',
      ],
    },
  },
  // --- Signal independence from status ---
  {
    name: 'rejected on a non-recording status',
    input: sig('doc_prep', 0, false, true),
    expected: { kinds: ['rejected_recording'] },
  },
  {
    name: 'high chain count still yields one kind (not count-scaled)',
    input: sig('title_work', 99, false, false),
    expected: { kinds: ['chain_break'] },
  },
  // --- Clean deals (never invent an exception) ---
  { name: 'clean intake', input: sig('intake', 0, false, false), expected: { kinds: [] } },
  { name: 'clean closing', input: sig('closing', 0, false, false), expected: { kinds: [] } },
  { name: 'clean completed', input: sig('completed', 0, false, false), expected: { kinds: [] } },
];
```

- [ ] **Step 2: Create `evals/scorers.ts`**

```ts
import { triageExceptions } from '../src/triage';
import type {
  DealSignals,
  Exception,
  ExceptionKind,
  ExceptionRoute,
  ExceptionSeverity,
} from '../src/types';

import type { TriageFixture } from './fixtures';

export type TriageExpected = TriageFixture['expected'];

export interface TriageScorerArgs {
  readonly input: DealSignals;
  readonly expected: TriageExpected;
  readonly output: readonly Exception[];
}

export interface TriageScore {
  readonly name: string;
  readonly score: number;
}

// Independent restatement of the agent's static maps (a regression guard, not a
// copy of the impl). A drift in SEVERITY_BY_KIND / ROUTE_BY_KIND / REASON_BY_KIND
// makes the corresponding scorer fail.
const SEVERITY: Record<ExceptionKind, ExceptionSeverity> = {
  chain_break: 'high',
  agent_dispatch_failed: 'medium',
  deal_flagged_exception: 'high',
  rejected_recording: 'high',
};
const ROUTE: Record<ExceptionKind, ExceptionRoute> = {
  chain_break: 'attorney_review',
  agent_dispatch_failed: 'reprocess',
  deal_flagged_exception: 'processor_review',
  rejected_recording: 'processor_review',
};
const REASON: Record<ExceptionKind, string> = {
  chain_break: 'Chain-of-title breaks are awaiting attorney review.',
  agent_dispatch_failed:
    'A post-commit agent dispatch failed; re-run the collateral pipeline for this deal.',
  deal_flagged_exception: 'This deal is flagged as an exception and needs processor review.',
  rejected_recording: 'A recording submission was rejected and needs processor review.',
};

const sortedJoin = (xs: readonly string[]): string => [...xs].sort().join(',');

// 1) The classified kind set matches (which signals -> which exceptions). The
//    clean-deal floor (expected.kinds == []) is checked here too: a clean deal
//    must yield no exceptions.
function kindsCorrect({ output, expected }: TriageScorerArgs): TriageScore {
  const got = sortedJoin(output.map((e) => e.kind));
  const want = sortedJoin(expected.kinds);
  return { name: 'kinds-correct', score: got === want ? 1 : 0 };
}

// 2) Each emitted exception carries the correct severity + route for its kind.
function severityRouteCorrect({ output }: TriageScorerArgs): TriageScore {
  const ok = output.every((e) => e.severity === SEVERITY[e.kind] && e.route === ROUTE[e.kind]);
  return { name: 'severity-route-correct', score: ok ? 1 : 0 };
}

// 3) Each emitted reason is the expected static, PII-free template.
function reasonCorrect({ output }: TriageScorerArgs): TriageScore {
  const ok = output.every((e) => e.reason === REASON[e.kind]);
  return { name: 'reason-correct', score: ok ? 1 : 0 };
}

// 4) No PII embedded in any reason (hard rule #3): no SSN pattern and no 3+ digit
//    run (an id/count/amount would leak through interpolation).
const SSN = /\b\d{3}-\d{2}-\d{4}\b/;
const DIGIT_RUN = /\d{3,}/;
function noPiiLeak({ output }: TriageScorerArgs): TriageScore {
  const leaked = output.some(
    (e) => e.reason.length === 0 || SSN.test(e.reason) || DIGIT_RUN.test(e.reason),
  );
  return { name: 'no-pii-leak', score: leaked ? 0 : 1 };
}

export const TRIAGE_SCORERS = [
  kindsCorrect,
  severityRouteCorrect,
  reasonCorrect,
  noPiiLeak,
] as const;

export function runTriage(input: DealSignals): readonly Exception[] {
  return triageExceptions(input);
}
```

- [ ] **Step 3: Create `evals/scorers.test.ts`**

```ts
import { describe, expect, it } from 'vitest';

import { TRIAGE_FIXTURES } from './fixtures';
import { TRIAGE_SCORERS, runTriage } from './scorers';

describe('Exception-Triage offline compliance gate', () => {
  it.each(TRIAGE_FIXTURES)('all scorers pass for: $name', (fixture) => {
    const output = runTriage(fixture.input);
    for (const scorer of TRIAGE_SCORERS) {
      const result = scorer({ input: fixture.input, expected: fixture.expected, output });
      expect(result.score, `${result.name} failed for ${fixture.name}`).toBe(1);
    }
  });
});
```

- [ ] **Step 4: Run** `cmd /c "pnpm --filter @cema/agents-exception-triage test"` — expect the new 14-case suite green.

- [ ] **Step 5: Create `evals/exception-triage.eval.ts`**

```ts
import { Eval } from 'braintrust';

import type { DealSignals, Exception } from '../src/types';

import { TRIAGE_FIXTURES } from './fixtures';
import type { TriageExpected } from './scorers';
import { TRIAGE_SCORERS, runTriage } from './scorers';

void Eval<DealSignals, readonly Exception[], TriageExpected>('exception-triage', {
  data: TRIAGE_FIXTURES.map((f) => ({
    input: f.input,
    expected: f.expected,
    metadata: { name: f.name },
  })),
  task: (input) => runTriage(input),
  scores: [...TRIAGE_SCORERS],
});
```

- [ ] **Step 6: Create `evals/run.mjs`** (template, label `exception-triage`).
- [ ] **Step 7: Modify `package.json`** (eval script + braintrust devDep).
- [ ] **Step 8: Commit**

```bash
git add packages/agents/exception-triage/evals packages/agents/exception-triage/package.json
git commit -S -m "test(exception-triage): offline Braintrust eval (4 scorers, 14 fixtures)"
```

---

## Task 3: Internal Comms eval (`@cema/agents-internal-comms`)

**Files:** `evals/{fixtures,scorers,scorers.test,internal-comms.eval,run.mjs}` + `package.json`.

- [ ] **Step 1: Create `evals/fixtures.ts`**

```ts
import type { InternalNotification } from '../src/types';

export interface InternalFixture {
  readonly name: string;
  readonly input: string; // a deal_status value (or an unknown string)
  readonly expected: { readonly message: InternalNotification['message'] } | null;
}

export const INTERNAL_FIXTURES: readonly InternalFixture[] = [
  // --- Notify statuses (channel is always 'pipeline') ---
  {
    name: 'authorization notifies',
    input: 'authorization',
    expected: { message: 'A deal is awaiting borrower authorization to proceed.' },
  },
  {
    name: 'collateral_chase notifies',
    input: 'collateral_chase',
    expected: { message: 'A deal is awaiting the collateral file from the prior servicer.' },
  },
  {
    name: 'attorney_review notifies',
    input: 'attorney_review',
    expected: {
      message: 'A deal has entered attorney review and is ready for an attorney to act.',
    },
  },
  {
    name: 'exception notifies',
    input: 'exception',
    expected: { message: 'A deal has been flagged as an exception and needs attention.' },
  },
  // --- Non-notify deal_status values -> null ---
  { name: 'intake is silent', input: 'intake', expected: null },
  { name: 'eligibility is silent', input: 'eligibility', expected: null },
  { name: 'title_work is silent', input: 'title_work', expected: null },
  { name: 'doc_prep is silent', input: 'doc_prep', expected: null },
  { name: 'closing is silent', input: 'closing', expected: null },
  { name: 'recording is silent', input: 'recording', expected: null },
  { name: 'completed is silent', input: 'completed', expected: null },
  { name: 'cancelled is silent', input: 'cancelled', expected: null },
  // --- Unknown string -> null ---
  { name: 'unknown status is silent', input: 'totally_unknown_status', expected: null },
];
```

- [ ] **Step 2: Create `evals/scorers.ts`**

```ts
import { notificationForStatus } from '../src/notify';
import type { InternalNotification } from '../src/types';

import type { InternalFixture } from './fixtures';

export type InternalExpected = InternalFixture['expected'];

export interface InternalScorerArgs {
  readonly input: string;
  readonly expected: InternalExpected;
  readonly output: InternalNotification | null;
}

export interface InternalScore {
  readonly name: string;
  readonly score: number;
}

// 1) Notify-vs-null decision matches; when notifying, the status echoes the input
//    and the channel is 'pipeline'.
function decisionCorrect({ input, expected, output }: InternalScorerArgs): InternalScore {
  if (expected === null) return { name: 'decision-correct', score: output === null ? 1 : 0 };
  if (output === null) return { name: 'decision-correct', score: 0 };
  const ok = output.status === input && output.channel === 'pipeline';
  return { name: 'decision-correct', score: ok ? 1 : 0 };
}

// 2) The emitted message matches the expected static template (or both are null).
function messageCorrect({ expected, output }: InternalScorerArgs): InternalScore {
  if (expected === null) return { name: 'message-correct', score: output === null ? 1 : 0 };
  return { name: 'message-correct', score: output?.message === expected.message ? 1 : 0 };
}

// 3) No PII in the message (hard rule #3): static template, so no SSN and no 3+
//    digit run (guards a future interpolation of a count/id/amount).
const SSN = /\b\d{3}-\d{2}-\d{4}\b/;
const DIGIT_RUN = /\d{3,}/;
function noPiiLeak({ output }: InternalScorerArgs): InternalScore {
  if (output === null) return { name: 'no-pii-leak', score: 1 };
  const bad =
    output.message.length === 0 || SSN.test(output.message) || DIGIT_RUN.test(output.message);
  return { name: 'no-pii-leak', score: bad ? 0 : 1 };
}

export const INTERNAL_SCORERS = [decisionCorrect, messageCorrect, noPiiLeak] as const;

export function runNotify(input: string): InternalNotification | null {
  return notificationForStatus(input);
}
```

- [ ] **Step 3: Create `evals/scorers.test.ts`**

```ts
import { describe, expect, it } from 'vitest';

import { INTERNAL_FIXTURES } from './fixtures';
import { INTERNAL_SCORERS, runNotify } from './scorers';

describe('Internal-Comms offline compliance gate', () => {
  it.each(INTERNAL_FIXTURES)('all scorers pass for: $name', (fixture) => {
    const output = runNotify(fixture.input);
    for (const scorer of INTERNAL_SCORERS) {
      const result = scorer({ input: fixture.input, expected: fixture.expected, output });
      expect(result.score, `${result.name} failed for ${fixture.name}`).toBe(1);
    }
  });
});
```

- [ ] **Step 4: Run** `cmd /c "pnpm --filter @cema/agents-internal-comms test"` — expect the new 13-case suite green.

- [ ] **Step 5: Create `evals/internal-comms.eval.ts`**

```ts
import { Eval } from 'braintrust';

import type { InternalNotification } from '../src/types';

import { INTERNAL_FIXTURES } from './fixtures';
import type { InternalExpected } from './scorers';
import { INTERNAL_SCORERS, runNotify } from './scorers';

void Eval<string, InternalNotification | null, InternalExpected>('internal-comms', {
  data: INTERNAL_FIXTURES.map((f) => ({
    input: f.input,
    expected: f.expected,
    metadata: { name: f.name },
  })),
  task: (input) => runNotify(input),
  scores: [...INTERNAL_SCORERS],
});
```

- [ ] **Step 6: Create `evals/run.mjs`** (template, label `internal-comms`).
- [ ] **Step 7: Modify `package.json`** (eval script + braintrust devDep).
- [ ] **Step 8: Commit**

```bash
git add packages/agents/internal-comms/evals packages/agents/internal-comms/package.json
git commit -S -m "test(internal-comms): offline Braintrust eval (3 scorers, 13 fixtures)"
```

---

## Task 4: Borrower Comms eval (`@cema/agents-borrower-comms`)

**Files:** `evals/{fixtures,scorers,scorers.test,borrower-comms.eval,run.mjs}` + `package.json`.

- [ ] **Step 1: Create `evals/fixtures.ts`**

```ts
import type { BorrowerNotification } from '../src/types';

export interface BorrowerFixture {
  readonly name: string;
  readonly input: string; // a deal_status value (or an unknown string)
  readonly expected: {
    readonly subject: BorrowerNotification['subject'];
    readonly body: BorrowerNotification['body'];
  } | null;
}

export const BORROWER_FIXTURES: readonly BorrowerFixture[] = [
  // --- Borrower touchpoints (email only) ---
  {
    name: 'authorization emails the borrower',
    input: 'authorization',
    expected: {
      subject: 'Action needed on your CEMA',
      body: 'We need your authorization to proceed with your CEMA. Your processing team will follow up shortly with the details and next steps.',
    },
  },
  {
    name: 'closing emails the borrower',
    input: 'closing',
    expected: {
      subject: 'Your CEMA is scheduled to close',
      body: 'Good news — your CEMA is ready for closing. Your processing team will be in touch with the closing details and next steps.',
    },
  },
  {
    name: 'completed emails the borrower',
    input: 'completed',
    expected: {
      subject: 'Your CEMA is complete',
      body: 'Your CEMA has closed and been recorded. Thank you for working with us. Your processing team will send any final documentation.',
    },
  },
  // --- Non-touchpoint statuses -> null (NO borrower email) ---
  { name: 'intake does not email', input: 'intake', expected: null },
  { name: 'eligibility does not email', input: 'eligibility', expected: null },
  { name: 'collateral_chase does not email', input: 'collateral_chase', expected: null },
  { name: 'title_work does not email', input: 'title_work', expected: null },
  { name: 'doc_prep does not email', input: 'doc_prep', expected: null },
  { name: 'attorney_review does not email', input: 'attorney_review', expected: null },
  { name: 'recording does not email', input: 'recording', expected: null },
  // CRITICAL: a borrower must NEVER be emailed about an exception.
  { name: 'exception NEVER emails the borrower', input: 'exception', expected: null },
  { name: 'cancelled does not email', input: 'cancelled', expected: null },
  // --- Unknown string -> null ---
  { name: 'unknown status does not email', input: 'unknown', expected: null },
];
```

- [ ] **Step 2: Create `evals/scorers.ts`**

```ts
import { borrowerNotificationForStatus } from '../src/notify';
import type { BorrowerNotification } from '../src/types';

import type { BorrowerFixture } from './fixtures';

export type BorrowerExpected = BorrowerFixture['expected'];

export interface BorrowerScorerArgs {
  readonly input: string;
  readonly expected: BorrowerExpected;
  readonly output: BorrowerNotification | null;
}

export interface BorrowerScore {
  readonly name: string;
  readonly score: number;
}

// 1) Notify-vs-null decision matches. CRITICAL: 'exception' (and every
//    non-touchpoint status) must be null -- a borrower is never emailed about it.
function decisionCorrect({ input, expected, output }: BorrowerScorerArgs): BorrowerScore {
  if (expected === null) return { name: 'decision-correct', score: output === null ? 1 : 0 };
  if (output === null) return { name: 'decision-correct', score: 0 };
  return { name: 'decision-correct', score: output.status === input ? 1 : 0 };
}

// 2) Subject + body match the expected static template (or both are null).
function contentCorrect({ expected, output }: BorrowerScorerArgs): BorrowerScore {
  if (expected === null) return { name: 'content-correct', score: output === null ? 1 : 0 };
  if (output === null) return { name: 'content-correct', score: 0 };
  const ok = output.subject === expected.subject && output.body === expected.body;
  return { name: 'content-correct', score: ok ? 1 : 0 };
}

// 3) No PII in subject/body (hard rule #3): static templates, so no SSN and no 3+
//    digit run (guards a future personalization leak of a name/amount/account).
const SSN = /\b\d{3}-\d{2}-\d{4}\b/;
const DIGIT_RUN = /\d{3,}/;
function noPiiLeak({ output }: BorrowerScorerArgs): BorrowerScore {
  if (output === null) return { name: 'no-pii-leak', score: 1 };
  const text = `${output.subject}\n${output.body}`;
  const bad = SSN.test(text) || DIGIT_RUN.test(text);
  return { name: 'no-pii-leak', score: bad ? 0 : 1 };
}

// 4) Email-only channel (hard rule #4 -- TCPA-safe). v1 must never emit sms/voice;
//    the single-member BorrowerChannel union enforces this at compile time, this
//    re-verifies it at runtime over every touchpoint.
function emailOnlyChannel({ output }: BorrowerScorerArgs): BorrowerScore {
  if (output === null) return { name: 'email-only-channel', score: 1 };
  return { name: 'email-only-channel', score: output.channel === 'email' ? 1 : 0 };
}

export const BORROWER_SCORERS = [
  decisionCorrect,
  contentCorrect,
  noPiiLeak,
  emailOnlyChannel,
] as const;

export function runNotify(input: string): BorrowerNotification | null {
  return borrowerNotificationForStatus(input);
}
```

- [ ] **Step 3: Create `evals/scorers.test.ts`**

```ts
import { describe, expect, it } from 'vitest';

import { BORROWER_FIXTURES } from './fixtures';
import { BORROWER_SCORERS, runNotify } from './scorers';

describe('Borrower-Comms offline compliance gate', () => {
  it.each(BORROWER_FIXTURES)('all scorers pass for: $name', (fixture) => {
    const output = runNotify(fixture.input);
    for (const scorer of BORROWER_SCORERS) {
      const result = scorer({ input: fixture.input, expected: fixture.expected, output });
      expect(result.score, `${result.name} failed for ${fixture.name}`).toBe(1);
    }
  });
});
```

- [ ] **Step 4: Run** `cmd /c "pnpm --filter @cema/agents-borrower-comms test"` — expect the new 13-case suite green.

- [ ] **Step 5: Create `evals/borrower-comms.eval.ts`**

```ts
import { Eval } from 'braintrust';

import type { BorrowerNotification } from '../src/types';

import { BORROWER_FIXTURES } from './fixtures';
import type { BorrowerExpected } from './scorers';
import { BORROWER_SCORERS, runNotify } from './scorers';

void Eval<string, BorrowerNotification | null, BorrowerExpected>('borrower-comms', {
  data: BORROWER_FIXTURES.map((f) => ({
    input: f.input,
    expected: f.expected,
    metadata: { name: f.name },
  })),
  task: (input) => runNotify(input),
  scores: [...BORROWER_SCORERS],
});
```

- [ ] **Step 6: Create `evals/run.mjs`** (template, label `borrower-comms`).
- [ ] **Step 7: Modify `package.json`** (eval script + braintrust devDep).
- [ ] **Step 8: Commit**

```bash
git add packages/agents/borrower-comms/evals packages/agents/borrower-comms/package.json
git commit -S -m "test(borrower-comms): offline Braintrust eval (4 scorers, 13 fixtures)"
```

---

## Task 5: Lockfile + full verification

- [ ] **Step 1: Install the new devDep** (updates `pnpm-lock.yaml` for all 4 `braintrust` additions)

Run: `cmd /c "pnpm install"`
Expected: lockfile updated, no other changes.

- [ ] **Step 2: Typecheck the package sources** (root)

Run: `cmd /c "pnpm typecheck"`
Expected: PASS. (Note: package tsconfigs exclude `evals/`, so this does NOT cover the eval files — Step 3 does.)

- [ ] **Step 3: Targeted typecheck of the eval files** (the transpile-only blind spot)

Run, per agent:
`cmd /c "pnpm --filter @cema/agents-recording-prep exec tsc --noEmit --skipLibCheck evals/*.ts"`
…and the same for `exception-triage`, `internal-comms`, `borrower-comms`.
Expected: PASS (no type errors in fixtures/scorers/eval files). Fix any type error before proceeding. `run.mjs` is plain JS — not typechecked, fine.

- [ ] **Step 4: Lint (root — matches CI)**

Run: `cmd /c "pnpm lint"`
Expected: 0 errors. Match Doc-Gen's import ordering exactly (external → `@cema/*` → `../src/*` → `./*`, blank-line-separated) so no `import/order` warnings.

- [ ] **Step 5: Full unit test run**

Run: `cmd /c "pnpm test"`
Expected: PASS, +66 new cases total (recording 26 + triage 14 + internal 13 + borrower 13).

- [ ] **Step 6: Prettier check on changed files** (post-commit — lint-staged can leave a committed file non-prettier-clean)

Run (Bash tool, LF): `pnpm prettier --check "packages/agents/*/evals/**/*.{ts,mjs}"`
Expected: All matched files use Prettier code style. If any fails, `pnpm prettier --write` it and amend the relevant commit (do NOT `--no-verify`).

- [ ] **Step 7: (Optional) confirm the live eval skips green without a key**

Run: `cmd /c "pnpm --filter @cema/agents-recording-prep eval"`
Expected: `[recording-prep eval] skipped -- missing env: BRAINTRUST_API_KEY`, exit 0.

---

## Task 6: PR + auto-merge

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feat/agent-evals-batch
```

- [ ] **Step 2: Open the PR** (`commit-commands:commit-push-pr` or `gh pr create`)

Title: `test(agents): offline Braintrust evals for the 4 remaining agents`
Body: summary (coverage 5/9 → 9/9; scorers per agent; skip-green; no agent code change), test plan (offline `scorers.test.ts` is the gate), and the `🤖 Generated with [Claude Code]` trailer.

- [ ] **Step 3: Enable auto-merge**

```bash
gh pr merge <n> --auto --squash --delete-branch
```

- [ ] **Step 4: Watch CI** — Lint, Typecheck, Unit tests, Build, CodeQL, Security scan. Resolve any CodeRabbit thread (the inline `\d{3,}`/SSN regexes are PII-sanitizers, not log sinks — no `js/log-injection` risk here, but note it if flagged). Confirm green + merged.

---

## Self-Review (run before execution)

**1. Spec coverage** — all four agents covered (Tasks 1–4); package.json + lockfile (Tasks 1–5); verification incl. the eval-file typecheck blind spot (Task 5 Step 3); PR (Task 6). ✓

**2. Placeholder scan** — every scorer/fixture file is complete code; `.eval.ts`/`run.mjs` given as a filled template + per-agent concrete versions in Steps 5. No TBD/TODO. ✓

**3. Type consistency** — scorer arg shape `{input, expected, output}` matches Braintrust's call shape (per Doc-Gen). `expected` types: Recording `{venue,borough,kinds,total}`; Triage `{kinds}`; Internal `{message}|null`; Borrower `{subject,body}|null`. `runX` names: `runPlan` (recording), `runTriage`, `runNotify` (both comms). `Eval<Input,Output,Expected>` generics match each core's signature. ✓

**4. Correctness of hand-computed `expected`** — venue: BBL digit wins, else county-name map, else county/null. Cover sheets: refi+acris `[acris_cover_pages]`; refi+county `[county_cover_sheet]`; purchase+acris `+nyc_rpt+tp_584`; purchase+county `+tp_584` only. Fees: `40 + 5*pages (+flat)`; default pages 40 → 240; Nassau +355 → 595; Suffolk +300 → 540; pages 50 → 290; pages 35 → 215. Triage maps restated verbatim from `triage.ts`. Comms messages/templates restated verbatim from `notify.ts`. ✓
