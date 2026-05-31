# Chain-of-Title Agent (M13 Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@cema/agents-chain-of-title` — the 4th Layer 3 agent — a pure deterministic analyzer that reads the `InstrumentRecord[]` the Collateral IDP persisted, classifies breaks in the recorded chain of title, and routes each break to re-chase or attorney review, behind the proven orchestration-agnostic core + dormant durable-wrap seam.

**Architecture:** A pure core (`runChainOfTitle(dealId, deps)`) with no app/DB/Clerk/LLM import; every effect injected via `ChainDeps`. Two pure functions do the work: `analyzeChain(instruments) → ChainAnalysis` (graph break-classification over assignor→assignee edges) and `route(dealId, breaks) → RouteDecision[]` (static break→route map). Split audit (`chain.analyzed` always, before any write; `chain.routed` once after the per-route actuators dispatch). OTel `chain.run` parent + 3 PII-safe child spans (`chain.load_instruments`, `chain.emit_analyzed`, `chain.route`). A dormant single-pass WDK durable wrap (one `'use step'`, no sleep loop — chain has no cadence). 0 new migrations: reads `documents.extractedData`, writes `audit_events`.

**Tech Stack:** TypeScript (strict), Vitest, `@opentelemetry/api` + `@cema/observability` (`withChildSpan`), `workflow` (WDK, dormant), Braintrust (offline scorers as the real gate). Type-only dependency on `@cema/agents-collateral-idp` for `InstrumentRecord` / `DocumentKind` / `RecordingRef`. **NO `@cema/db`, NO AI SDK, NO LLM.**

---

## File Structure

### Package — `packages/agents/chain-of-title/`

| File                             | Responsibility                                                                                                                                                              |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`                   | Workspace manifest. Deps: `@cema/agents-collateral-idp`, `@cema/observability`, `@opentelemetry/api`. **No `@cema/db`.**                                                    |
| `tsconfig.json`                  | Extends `@cema/config/tsconfig/node.json`; `noEmit`.                                                                                                                        |
| `src/types.ts`                   | Re-exports `DocumentKind`/`InstrumentRecord`/`RecordingRef` from collateral-idp; declares chain status / break / route tuples + interfaces (`ChainDeps`, `ChainResult`, …). |
| `src/types.test.ts`              | Drift guard: tuple contents + a full `InstrumentRecord` literal (compile-time field-drift guard against collateral-idp).                                                    |
| `src/chain.ts`                   | `analyzeChain(instruments) → ChainAnalysis` — the break-classification algorithm (the heart of the package).                                                                |
| `src/chain.test.ts`              | ~14 unit tests over `analyzeChain` incl. the `clean ⇔ zero-breaks` safety invariant + edge construction (`assigns_to` / `consolidates`).                                    |
| `src/route.ts`                   | `route(dealId, breaks) → RouteDecision[]` — static break→route map, PII-free reasons.                                                                                       |
| `src/route.test.ts`              | Route-map tests + exhaustiveness loop + "never propagates `break.detail` (PII)".                                                                                            |
| `src/orchestrator.ts`            | `runChainOfTitle(dealId, deps)` — parent span + 3 child spans + split audit.                                                                                                |
| `src/orchestrator.test.ts`       | Split-audit + per-route actuator dispatch (`routeReChase`/`openAttorneyReview`) via injected `makeDeps`.                                                                    |
| `src/orchestrator.trace.test.ts` | Attribute allowlist + PII-free span assertion.                                                                                                                              |
| `src/index.ts`                   | Barrel: `types` + `analyzeChain` + `route` + `runChainOfTitle`.                                                                                                             |
| `evals/fixtures.ts`              | 24 chain fixtures F1–F24 + builders.                                                                                                                                        |
| `evals/scorers.ts`               | `statusCorrect` / `breakKindsCorrect` / `routeKindsCorrect` / `noFalseClean` + `runPipeline`.                                                                               |
| `evals/scorers.test.ts`          | Offline scorer gate (`it.each(CHAIN_FIXTURES)`) — the real compliance gate.                                                                                                 |
| `evals/chain-of-title.eval.ts`   | Live Braintrust `Eval()` (skip-green unless `BRAINTRUST_API_KEY`).                                                                                                          |
| `evals/run.mjs`                  | Key-guarded live-eval runner (`REQUIRED_KEYS=['BRAINTRUST_API_KEY']`).                                                                                                      |

### App — `apps/web/lib/agents/chain-of-title/`

| File                                   | Responsibility                                                                                                                                                                                                                                             |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deps.ts`                              | `buildChainDeps({organizationId, actorUserId})` — real `loadInstruments` (reads `documents.extractedData` under RLS) + dormant `routeReChase` / `openAttorneyReview` no-ops (carry-over #1) + `emitAudit` (writes both `chain.analyzed` + `chain.routed`). |
| `run-chain-of-title-action.ts`         | `'use server'` `runChainOfTitleFromDeal(dealId)` — Clerk/org resolution, `chain.run_from_deal` span, `redactPii` in catch.                                                                                                                                 |
| `chain.steps.ts`                       | `'use step'` `runChainOfTitleStep(dealId, organizationId, actorUserId)` — rebuilds deps, PII-safe log.                                                                                                                                                     |
| `chain.workflow.ts`                    | `'use workflow'` `chainWorkflow(...)` — single-pass, returns the step.                                                                                                                                                                                     |
| `chain.workflow.test.ts`               | Mocked-step behavioral guard (runs once, passes result through, propagates failure).                                                                                                                                                                       |
| `run-chain-of-title-durable-action.ts` | `'use server'` dormant durable entry (`start()` + `run.returnValue`).                                                                                                                                                                                      |

### Touched (1 line each)

- `pnpm-workspace.yaml` — already globs `packages/agents/*`; no edit needed (confirm in PR-1 Step 3 via `pnpm install` picking the package up).

---

## PR-1: Package scaffold + types + drift guard

**Files:**

- Create: `packages/agents/chain-of-title/package.json`
- Create: `packages/agents/chain-of-title/tsconfig.json`
- Create: `packages/agents/chain-of-title/src/types.ts`
- Create: `packages/agents/chain-of-title/src/types.test.ts`
- Create: `packages/agents/chain-of-title/src/index.ts`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "@cema/agents-chain-of-title",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "eval": "node evals/run.mjs"
  },
  "dependencies": {
    "@cema/agents-collateral-idp": "workspace:*",
    "@cema/observability": "workspace:*",
    "@opentelemetry/api": "^1.9.0"
  },
  "devDependencies": {
    "@cema/config": "workspace:*",
    "@opentelemetry/context-async-hooks": "^2.0.0",
    "@opentelemetry/sdk-trace-base": "^2.0.0",
    "@types/node": "^22.0.0",
    "braintrust": "^3.13.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "extends": "@cema/config/tsconfig/node.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": ".",
    "noEmit": true
  },
  "include": ["src/**/*", "evals/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Install so pnpm links the new workspace package**

Run: `cmd /c "pnpm install"`
Expected: lockfile updates; `@cema/agents-chain-of-title` resolves `@cema/agents-collateral-idp` + `@cema/observability` via `workspace:*`. No error.

- [ ] **Step 4: Write `src/types.ts`**

```typescript
// Chain-of-Title types. This package type-imports the InstrumentRecord shape
// the Collateral IDP persists -- it never imports @cema/db (the drift guard in
// types.test.ts is against collateral-idp's exported type, which itself is kept
// in lockstep with the DB enum). No runtime coupling: these are type-only.
export type { DocumentKind, InstrumentRecord, RecordingRef } from '@cema/agents-collateral-idp';

// Local bindings (the re-export above does not create them) for use in the
// `satisfies readonly DocumentKind[]` guards and the interfaces below. Kept at
// the top so the ESLint `import/first` rule stays satisfied.
import type { DocumentKind, InstrumentRecord } from '@cema/agents-collateral-idp';

// The three terminal verdicts a chain can carry. `clean` is reachable IFF there
// are zero breaks (the "never auto-bless" safety property -- see chain.ts).
export const CHAIN_STATUSES = ['clean', 'broken', 'ambiguous'] as const;
export type ChainStatus = (typeof CHAIN_STATUSES)[number];

// The break taxonomy. missing_assignment is a recoverable gap (re-chase the
// servicer); the other three need a lawyer's eyes.
export const BREAK_KINDS = [
  'missing_assignment',
  'lost_note',
  'ambiguous_assignment',
  'unrecorded_instrument',
] as const;
export type BreakKind = (typeof BREAK_KINDS)[number];

// Where a break routes. advisory_pass is the only non-break outcome.
export const ROUTE_KINDS = ['advisory_pass', 're_chase', 'attorney_review'] as const;
export type RouteKind = (typeof ROUTE_KINDS)[number];

// Instruments that anchor a chain (the "root" a note/assignment hangs off of).
export const ANCHOR_KINDS = [
  'mortgage',
  'gap_mortgage',
  'consolidated_note',
  'cema_3172',
] as const satisfies readonly DocumentKind[];

// Promissory-note instruments. With no anchor present, an orphaned note is a
// lost_note candidate.
export const NOTE_KINDS = ['note', 'gap_note'] as const satisfies readonly DocumentKind[];

// Instruments that move the chain forward (assignor -> assignee edges).
export const ASSIGNMENT_KINDS = ['aom', 'allonge'] as const satisfies readonly DocumentKind[];

// Instruments that MUST carry a recording reference to be valid in the chain.
export const RECORDED_KINDS = [
  'mortgage',
  'gap_mortgage',
  'aom',
] as const satisfies readonly DocumentKind[];

// One classified defect in the chain. `detail` MAY carry party names for
// in-memory human-readable context; it is NEVER persisted or propagated into a
// RouteDecision.reason (route.ts drops it).
export interface ChainBreak {
  readonly kind: BreakKind;
  readonly documentId: string | null;
  readonly detail: string;
}

// A directed edge in the recorded instrument graph (spec §5.1). Each
// AOM/allonge yields an `assigns_to` edge (assignor -> assignee); each CEMA
// instrument yields a `consolidates` edge. Parties are carried for in-memory
// graph context only -- NEVER persisted or propagated into a
// RouteDecision.reason (PII-safe).
export const EDGE_KINDS = ['assigns_to', 'consolidates'] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

export interface ChainEdge {
  readonly kind: EdgeKind;
  readonly documentId: string;
  readonly assignor: string | null;
  readonly assignee: string | null;
}

// CEMA instruments that consolidate prior mortgages into one lien -- each emits
// a `consolidates` edge. A subset of ANCHOR_KINDS.
export const CONSOLIDATION_KINDS = [
  'consolidated_note',
  'cema_3172',
] as const satisfies readonly DocumentKind[];

export interface ChainAnalysis {
  readonly status: ChainStatus;
  readonly edges: readonly ChainEdge[];
  readonly breaks: readonly ChainBreak[];
}

// A routing verdict for one break (or one advisory_pass for a clean chain).
// `reason` is a static PII-free template -- safe to persist/display.
export interface RouteDecision {
  readonly dealId: string;
  readonly kind: RouteKind;
  readonly documentId: string | null;
  readonly reason: string;
}

// Split-audit actions. emitAudit emits chain.analyzed (always, before any
// write) and -- only when there is at least one break -- a single aggregate
// chain.routed (counts only), emitted inside the chain.route span after the
// per-route actuator seams have been dispatched.
export interface ChainAuditEvent {
  readonly action: 'chain.analyzed' | 'chain.routed';
  readonly dealId: string;
  readonly status: ChainStatus;
  readonly breakCount: number;
  readonly reChaseCount: number;
  readonly attorneyReviewCount: number;
}

// Every effect the core needs, injected (spec §5.4). No clock (chain is not
// time-based) and no LLM (analyze/route are pure deterministic functions).
// loadInstruments returns the IDP-persisted InstrumentRecord[] directly (no
// context wrapper). The two actuator seams are dormant: each records the routed
// decision (keyed chain:<dealId>:break:<hash> for idempotency) and, once
// activated, performs the real re-chase / attorney-review effect
// co-transactionally with the chain.routed audit (mirrors M12
// outreach.touch_sent). advisory_pass calls neither seam.
export interface ChainDeps {
  loadInstruments(dealId: string): Promise<readonly InstrumentRecord[]>;
  routeReChase(decision: RouteDecision): Promise<void>;
  openAttorneyReview(decision: RouteDecision): Promise<void>;
  emitAudit(event: ChainAuditEvent): Promise<void>;
}

export interface ChainResult {
  readonly dealId: string;
  readonly status: ChainStatus;
  readonly breaks: readonly ChainBreak[];
  readonly routes: readonly RouteDecision[];
}
```

- [ ] **Step 5: Write `src/index.ts` (PR-1 state — types only)**

```typescript
export * from './types';
```

- [ ] **Step 6: Write `src/types.test.ts` (the drift guard)**

```typescript
import { describe, expect, it } from 'vitest';

import type { InstrumentRecord } from '@cema/agents-collateral-idp';
import {
  ANCHOR_KINDS,
  ASSIGNMENT_KINDS,
  BREAK_KINDS,
  CHAIN_STATUSES,
  NOTE_KINDS,
  RECORDED_KINDS,
  ROUTE_KINDS,
} from './types';

describe('chain-of-title type tuples', () => {
  it('declares exactly the three chain statuses', () => {
    expect([...CHAIN_STATUSES]).toEqual(['clean', 'broken', 'ambiguous']);
  });

  it('declares exactly the four break kinds', () => {
    expect([...BREAK_KINDS]).toEqual([
      'missing_assignment',
      'lost_note',
      'ambiguous_assignment',
      'unrecorded_instrument',
    ]);
  });

  it('declares exactly the three route kinds', () => {
    expect([...ROUTE_KINDS]).toEqual(['advisory_pass', 're_chase', 'attorney_review']);
  });

  it('keeps anchor and note kinds disjoint', () => {
    for (const anchor of ANCHOR_KINDS) {
      expect(NOTE_KINDS).not.toContain(anchor);
    }
  });

  it('treats aom as both an assignment and a recorded instrument', () => {
    expect(ASSIGNMENT_KINDS).toContain('aom');
    expect(RECORDED_KINDS).toContain('aom');
  });

  // Compile-time field-drift guard: this literal must satisfy the InstrumentRecord
  // shape re-exported from @cema/agents-collateral-idp. If IDP renames/adds a
  // required field, this file stops compiling -- forcing a conscious update here.
  it('matches the collateral-idp InstrumentRecord shape', () => {
    const sample: InstrumentRecord = {
      documentId: 'doc-1',
      instrumentKind: 'aom',
      assignor: 'A',
      assignee: 'B',
      executedAt: null,
      recordedAt: '2026-01-01',
      amount: null,
      recordingRef: { reelPage: null, crfn: 'crfn-1' },
      county: null,
      references: null,
    };
    expect(sample.instrumentKind).toBe('aom');
  });
});
```

- [ ] **Step 7: Run the drift-guard tests**

Run: `cmd /c "pnpm --filter @cema/agents-chain-of-title test"`
Expected: 5 tests PASS.

- [ ] **Step 8: Typecheck the package**

Run: `cmd /c "pnpm --filter @cema/agents-chain-of-title typecheck"`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add packages/agents/chain-of-title/package.json packages/agents/chain-of-title/tsconfig.json packages/agents/chain-of-title/src/types.ts packages/agents/chain-of-title/src/types.test.ts packages/agents/chain-of-title/src/index.ts pnpm-lock.yaml
git commit -S -m "feat(m13): chain-of-title package scaffold + types + drift guard"
```

---

## PR-2: Pure core — `analyzeChain` + `route`

**Files:**

- Create: `packages/agents/chain-of-title/src/chain.ts`
- Create: `packages/agents/chain-of-title/src/chain.test.ts`
- Create: `packages/agents/chain-of-title/src/route.ts`
- Create: `packages/agents/chain-of-title/src/route.test.ts`
- Modify: `packages/agents/chain-of-title/src/index.ts`

- [ ] **Step 1: Write `src/chain.ts` (the break-classification algorithm)**

```typescript
import {
  ANCHOR_KINDS,
  ASSIGNMENT_KINDS,
  CONSOLIDATION_KINDS,
  NOTE_KINDS,
  RECORDED_KINDS,
} from './types';
import type { ChainAnalysis, ChainBreak, ChainEdge, ChainStatus, InstrumentRecord } from './types';

const ANCHOR_SET = new Set<string>(ANCHOR_KINDS);
const NOTE_SET = new Set<string>(NOTE_KINDS);
const ASSIGNMENT_SET = new Set<string>(ASSIGNMENT_KINDS);
const RECORDED_SET = new Set<string>(RECORDED_KINDS);
const CONSOLIDATION_SET = new Set<string>(CONSOLIDATION_KINDS);

// An instrument is "recorded" if it carries either a reel/page (upstate) or a
// CRFN (NYC ACRIS). A RECORDED_KINDS instrument with neither is unrecorded.
function isRecorded(inst: InstrumentRecord): boolean {
  return inst.recordingRef.reelPage !== null || inst.recordingRef.crfn !== null;
}

// Sort by recordedAt ascending (ISO-8601 strings sort lexically); nulls last so
// undated instruments don't masquerade as the earliest hop.
function byRecordedAt(a: InstrumentRecord, b: InstrumentRecord): number {
  if (a.recordedAt === null && b.recordedAt === null) return 0;
  if (a.recordedAt === null) return 1;
  if (b.recordedAt === null) return -1;
  return a.recordedAt < b.recordedAt ? -1 : a.recordedAt > b.recordedAt ? 1 : 0;
}

// Detect a cycle in the assignor -> assignee graph via DFS three-coloring.
// Null-party hops are skipped (they can't form a definite edge). A back-edge to
// a GRAY (in-progress) node means a cycle -- a chain can never loop.
function detectCycle(assignments: readonly InstrumentRecord[]): boolean {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const a of assignments) {
    if (a.assignor === null || a.assignee === null) continue;
    color.set(a.assignor, WHITE);
    color.set(a.assignee, WHITE);
    const out = adjacency.get(a.assignor) ?? [];
    out.push(a.assignee);
    adjacency.set(a.assignor, out);
  }

  const visit = (node: string): boolean => {
    color.set(node, GRAY);
    for (const next of adjacency.get(node) ?? []) {
      const c = color.get(next) ?? WHITE;
      if (c === GRAY) return true;
      if (c === WHITE && visit(next)) return true;
    }
    color.set(node, BLACK);
    return false;
  };

  for (const node of color.keys()) {
    if ((color.get(node) ?? WHITE) === WHITE && visit(node)) return true;
  }
  return false;
}

function toStatus(breaks: readonly ChainBreak[]): ChainStatus {
  if (breaks.length === 0) return 'clean';
  if (breaks.every((b) => b.kind === 'missing_assignment')) return 'broken';
  return 'ambiguous';
}

/**
 * Classify every break in a deal's recorded chain of title from the
 * InstrumentRecord[] the Collateral IDP persisted. PURE + deterministic: no
 * clock, no IO, no LLM. Same input -> same ChainAnalysis (durable-replay safe).
 *
 * Safety property ("never auto-bless"): the returned status is `clean` IFF
 * `breaks.length === 0`. An empty instrument set, or one with no anchor, can
 * never be `clean` -- it surfaces as `ambiguous`/`broken` for human review.
 *
 * Known limitation (head gap): an InstrumentRecord carries no "original
 * mortgagee" field, so the FIRST assignment's assignor cannot be verified
 * against the anchor's lender. analyzeChain therefore checks INTERNAL
 * consistency of the assignment sequence (assignee[n] === assignor[n+1]); a
 * mismatch at the head relative to the true originator is out of scope here
 * (carry-over: reference-target validation).
 */
export function analyzeChain(instruments: readonly InstrumentRecord[]): ChainAnalysis {
  const breaks: ChainBreak[] = [];

  const anchors = instruments.filter((i) => ANCHOR_SET.has(i.instrumentKind));
  const notes = instruments.filter((i) => NOTE_SET.has(i.instrumentKind));
  const assignments = instruments.filter((i) => ASSIGNMENT_SET.has(i.instrumentKind));

  // (A) Per-instrument: any RECORDED_KINDS instrument missing a recording ref.
  for (const inst of instruments) {
    if (RECORDED_SET.has(inst.instrumentKind) && !isRecorded(inst)) {
      breaks.push({
        kind: 'unrecorded_instrument',
        documentId: inst.documentId,
        detail: `${inst.instrumentKind} has no recording reference`,
      });
    }
  }

  // (B) No anchor at all: every note is an orphan -> lost_note candidate.
  if (anchors.length === 0) {
    for (const note of notes) {
      breaks.push({
        kind: 'lost_note',
        documentId: note.documentId,
        detail: `note ${note.documentId} has no anchoring mortgage`,
      });
    }
  }

  // (C) Nothing to anchor on AND no notes either: the set is unanalyzable.
  if (anchors.length === 0 && notes.length === 0) {
    breaks.push({
      kind: 'ambiguous_assignment',
      documentId: null,
      detail: 'no anchor and no note present; chain cannot be established',
    });
  }

  // (D) Assignment-graph ambiguity (missing party, fork, merge, cycle).
  const ambiguousBefore = breaks.filter((b) => b.kind === 'ambiguous_assignment').length;

  // (D.1) Missing party on an assignment.
  for (const a of assignments) {
    if (a.assignor === null || a.assignee === null) {
      breaks.push({
        kind: 'ambiguous_assignment',
        documentId: a.documentId,
        detail: `assignment ${a.documentId} is missing assignor or assignee`,
      });
    }
  }

  // (D.2) Fork: one assignor with two+ distinct outgoing assignments.
  const byAssignor = new Map<string, InstrumentRecord[]>();
  for (const a of assignments) {
    if (a.assignor === null) continue;
    const group = byAssignor.get(a.assignor) ?? [];
    group.push(a);
    byAssignor.set(a.assignor, group);
  }
  for (const group of byAssignor.values()) {
    if (group.length >= 2) {
      for (const a of group) {
        breaks.push({
          kind: 'ambiguous_assignment',
          documentId: a.documentId,
          detail: `assignor has multiple outgoing assignments (fork)`,
        });
      }
    }
  }

  // (D.3) Merge: one assignee receiving two+ distinct incoming assignments.
  const byAssignee = new Map<string, InstrumentRecord[]>();
  for (const a of assignments) {
    if (a.assignee === null) continue;
    const group = byAssignee.get(a.assignee) ?? [];
    group.push(a);
    byAssignee.set(a.assignee, group);
  }
  for (const group of byAssignee.values()) {
    if (group.length >= 2) {
      for (const a of group) {
        breaks.push({
          kind: 'ambiguous_assignment',
          documentId: a.documentId,
          detail: `assignee has multiple incoming assignments (merge)`,
        });
      }
    }
  }

  // (D.4) Cycle in the assignor -> assignee graph.
  if (detectCycle(assignments)) {
    breaks.push({
      kind: 'ambiguous_assignment',
      documentId: null,
      detail: 'assignment graph contains a cycle',
    });
  }

  // (E) Sequential gap: only when the assignment graph is otherwise unambiguous
  // (no new ambiguous_assignment breaks above), check consecutive recorded hops
  // for assignee[n] === assignor[n+1]. A mismatch is a missing_assignment.
  const ambiguousAfter = breaks.filter((b) => b.kind === 'ambiguous_assignment').length;
  if (ambiguousAfter === ambiguousBefore && assignments.length > 1) {
    const ordered = [...assignments].sort(byRecordedAt);
    for (let n = 0; n < ordered.length - 1; n += 1) {
      const cur = ordered[n];
      const next = ordered[n + 1];
      if (cur.assignee !== next.assignor) {
        breaks.push({
          kind: 'missing_assignment',
          documentId: next.documentId,
          detail: `gap between assignment ${cur.documentId} and ${next.documentId}`,
        });
      }
    }
  }

  // Build the directed instrument graph (spec §5.1). assigns_to edges come from
  // the assignment instruments (assignor -> assignee); consolidates edges from
  // each CEMA instrument. Edges are descriptive output -- they do NOT influence
  // `status`, which is driven solely by `breaks` (the "never auto-bless" floor).
  const edges: ChainEdge[] = [];
  for (const a of assignments) {
    edges.push({
      kind: 'assigns_to',
      documentId: a.documentId,
      assignor: a.assignor,
      assignee: a.assignee,
    });
  }
  for (const c of instruments) {
    if (CONSOLIDATION_SET.has(c.instrumentKind)) {
      edges.push({
        kind: 'consolidates',
        documentId: c.documentId,
        assignor: null,
        assignee: null,
      });
    }
  }

  return { status: toStatus(breaks), edges, breaks };
}
```

- [ ] **Step 2: Write `src/chain.test.ts`**

```typescript
import { describe, expect, it } from 'vitest';

import { analyzeChain } from './chain';
import type { DocumentKind, InstrumentRecord, RecordingRef } from './types';

const REC = (crfn: string): RecordingRef => ({ reelPage: null, crfn });
const UNREC: RecordingRef = { reelPage: null, crfn: null };

function inst(
  partial: Partial<InstrumentRecord> & { documentId: string; instrumentKind: DocumentKind },
): InstrumentRecord {
  return {
    assignor: null,
    assignee: null,
    executedAt: null,
    recordedAt: null,
    amount: null,
    recordingRef: REC(`crfn-${partial.documentId}`),
    county: null,
    references: null,
    ...partial,
  };
}

const mortgage = (id: string): InstrumentRecord =>
  inst({ documentId: id, instrumentKind: 'mortgage' });
const aom = (
  id: string,
  assignor: string,
  assignee: string,
  recordedAt: string,
): InstrumentRecord =>
  inst({ documentId: id, instrumentKind: 'aom', assignor, assignee, recordedAt });

describe('analyzeChain', () => {
  it('returns clean for a mortgage with a single recorded assignment', () => {
    const a = analyzeChain([mortgage('m1'), aom('a1', 'Lender A', 'Lender B', '2026-01-01')]);
    expect(a.status).toBe('clean');
    expect(a.breaks).toHaveLength(0);
  });

  it('returns clean for a contiguous multi-hop chain', () => {
    const a = analyzeChain([
      mortgage('m1'),
      aom('a1', 'A', 'B', '2026-01-01'),
      aom('a2', 'B', 'C', '2026-02-01'),
      aom('a3', 'C', 'D', '2026-03-01'),
    ]);
    expect(a.status).toBe('clean');
    expect(a.breaks).toHaveLength(0);
  });

  it('flags a sequential gap as broken / missing_assignment', () => {
    const a = analyzeChain([
      mortgage('m1'),
      aom('a1', 'A', 'B', '2026-01-01'),
      aom('a2', 'C', 'D', '2026-02-01'),
    ]);
    expect(a.status).toBe('broken');
    expect(a.breaks).toHaveLength(1);
    expect(a.breaks[0].kind).toBe('missing_assignment');
    expect(a.breaks[0].documentId).toBe('a2');
  });

  it('flags a fork as two ambiguous_assignment breaks', () => {
    const a = analyzeChain([
      mortgage('m1'),
      aom('a1', 'A', 'B', '2026-01-01'),
      aom('a2', 'A', 'C', '2026-02-01'),
    ]);
    expect(a.status).toBe('ambiguous');
    const forks = a.breaks.filter((b) => b.kind === 'ambiguous_assignment');
    expect(forks).toHaveLength(2);
  });

  it('flags a merge as two ambiguous_assignment breaks', () => {
    const a = analyzeChain([
      mortgage('m1'),
      aom('a1', 'A', 'C', '2026-01-01'),
      aom('a2', 'B', 'C', '2026-02-01'),
    ]);
    expect(a.status).toBe('ambiguous');
    const merges = a.breaks.filter((b) => b.kind === 'ambiguous_assignment');
    expect(merges).toHaveLength(2);
  });

  it('flags a cycle as one ambiguous_assignment break', () => {
    const a = analyzeChain([
      mortgage('m1'),
      aom('a1', 'A', 'B', '2026-01-01'),
      aom('a2', 'B', 'A', '2026-02-01'),
    ]);
    expect(a.status).toBe('ambiguous');
    expect(a.breaks.some((b) => b.detail.includes('cycle'))).toBe(true);
  });

  it('flags an orphaned note as lost_note when no anchor is present', () => {
    const a = analyzeChain([inst({ documentId: 'n1', instrumentKind: 'note' })]);
    expect(a.status).toBe('ambiguous');
    expect(a.breaks.some((b) => b.kind === 'lost_note' && b.documentId === 'n1')).toBe(true);
  });

  it('flags an unrecorded mortgage as unrecorded_instrument', () => {
    const a = analyzeChain([
      inst({ documentId: 'm1', instrumentKind: 'mortgage', recordingRef: UNREC }),
    ]);
    expect(a.breaks.some((b) => b.kind === 'unrecorded_instrument' && b.documentId === 'm1')).toBe(
      true,
    );
  });

  it('flags an unrecorded assignment as unrecorded_instrument', () => {
    const a = analyzeChain([
      mortgage('m1'),
      inst({
        documentId: 'a1',
        instrumentKind: 'aom',
        assignor: 'A',
        assignee: 'B',
        recordingRef: UNREC,
      }),
    ]);
    expect(a.breaks.some((b) => b.kind === 'unrecorded_instrument' && b.documentId === 'a1')).toBe(
      true,
    );
  });

  it('flags an assignment with a missing party as ambiguous_assignment', () => {
    const a = analyzeChain([
      mortgage('m1'),
      inst({ documentId: 'a1', instrumentKind: 'aom', assignor: 'A', assignee: null }),
    ]);
    expect(a.status).toBe('ambiguous');
    expect(a.breaks.some((b) => b.kind === 'ambiguous_assignment' && b.documentId === 'a1')).toBe(
      true,
    );
  });

  it('returns ambiguous for an empty instrument set (never clean)', () => {
    const a = analyzeChain([]);
    expect(a.status).toBe('ambiguous');
    expect(a.breaks).toHaveLength(1);
    expect(a.breaks[0].kind).toBe('ambiguous_assignment');
  });

  it('flags two distinct sequential gaps', () => {
    const a = analyzeChain([
      mortgage('m1'),
      aom('a1', 'A', 'B', '2026-01-01'),
      aom('a2', 'C', 'D', '2026-02-01'),
      aom('a3', 'E', 'F', '2026-03-01'),
    ]);
    expect(a.status).toBe('broken');
    expect(a.breaks.filter((b) => b.kind === 'missing_assignment')).toHaveLength(2);
  });

  it('holds the safety invariant: clean IFF zero breaks', () => {
    const samples: InstrumentRecord[][] = [
      [mortgage('m1'), aom('a1', 'A', 'B', '2026-01-01')],
      [mortgage('m1'), aom('a1', 'A', 'B', '2026-01-01'), aom('a2', 'C', 'D', '2026-02-01')],
      [],
      [inst({ documentId: 'n1', instrumentKind: 'note' })],
    ];
    for (const s of samples) {
      const a = analyzeChain(s);
      expect(a.status === 'clean').toBe(a.breaks.length === 0);
    }
  });

  it('builds assigns_to edges for assignments and a consolidates edge for a CEMA', () => {
    const a = analyzeChain([
      inst({ documentId: 'cn1', instrumentKind: 'consolidated_note' }),
      aom('a1', 'A', 'B', '2026-01-01'),
      aom('a2', 'B', 'C', '2026-02-01'),
    ]);
    const assignsTo = a.edges.filter((e) => e.kind === 'assigns_to');
    const consolidates = a.edges.filter((e) => e.kind === 'consolidates');
    expect(assignsTo).toHaveLength(2);
    expect(consolidates).toHaveLength(1);
    expect(consolidates[0].documentId).toBe('cn1');
    expect(assignsTo.some((e) => e.assignor === 'A' && e.assignee === 'B')).toBe(true);
  });
});
```

- [ ] **Step 3: Run the chain tests (expect FAIL only if a typo — algorithm is complete)**

Run: `cmd /c "pnpm --filter @cema/agents-chain-of-title test src/chain.test.ts"`
Expected: 14 tests PASS.

- [ ] **Step 4: Write `src/route.ts`**

```typescript
import { BREAK_KINDS } from './types';
import type { BreakKind, ChainBreak, RouteDecision, RouteKind } from './types';

// Static break -> route map. missing_assignment is recoverable by chasing the
// servicer for the missing instrument; the other three need a lawyer.
const ROUTE_BY_BREAK: Record<BreakKind, RouteKind> = {
  missing_assignment: 're_chase',
  lost_note: 'attorney_review',
  ambiguous_assignment: 'attorney_review',
  unrecorded_instrument: 'attorney_review',
};

// PII-free reason templates -- safe to persist and surface to a processor.
// NOTE: a ChainBreak.detail may name parties; we deliberately do NOT use it here.
const REASON_BY_BREAK: Record<BreakKind, string> = {
  missing_assignment:
    'A gap in the recorded assignment sequence was detected; re-chase the servicer for the missing assignment.',
  lost_note:
    'A promissory note has no anchoring mortgage; attorney review required (possible lost-note affidavit).',
  ambiguous_assignment:
    'The recorded assignment graph is ambiguous (missing party, fork, merge, or cycle); attorney review required.',
  unrecorded_instrument:
    'An instrument that must be recorded carries no recording reference; attorney review required.',
};

// Exhaustiveness guard: if BREAK_KINDS gains a member the maps don't cover,
// this throws at module load rather than silently routing undefined.
for (const kind of BREAK_KINDS) {
  if (!(kind in ROUTE_BY_BREAK) || !(kind in REASON_BY_BREAK)) {
    throw new Error(`route maps are missing an entry for break kind "${kind}"`);
  }
}

/**
 * Map each classified break to a routing decision. A clean chain (zero breaks)
 * yields a single advisory_pass. PURE: no IO, no clock. PII-safe -- the
 * ChainBreak.detail (which may carry party names) is never propagated.
 */
export function route(dealId: string, breaks: readonly ChainBreak[]): RouteDecision[] {
  if (breaks.length === 0) {
    return [
      {
        dealId,
        kind: 'advisory_pass',
        documentId: null,
        reason: 'Chain of title is internally consistent; advisory pass.',
      },
    ];
  }
  return breaks.map((b) => ({
    dealId,
    kind: ROUTE_BY_BREAK[b.kind],
    documentId: b.documentId,
    reason: REASON_BY_BREAK[b.kind],
  }));
}
```

- [ ] **Step 5: Write `src/route.test.ts`**

```typescript
import { describe, expect, it } from 'vitest';

import { route } from './route';
import { BREAK_KINDS } from './types';
import type { ChainBreak } from './types';

describe('route', () => {
  it('returns a single advisory_pass for a clean chain', () => {
    const decisions = route('deal-1', []);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].kind).toBe('advisory_pass');
    expect(decisions[0].documentId).toBeNull();
  });

  it('routes missing_assignment to re_chase', () => {
    const decisions = route('deal-1', [
      { kind: 'missing_assignment', documentId: 'a2', detail: 'gap' },
    ]);
    expect(decisions[0].kind).toBe('re_chase');
    expect(decisions[0].documentId).toBe('a2');
  });

  it('routes lost_note, ambiguous_assignment, and unrecorded_instrument to attorney_review', () => {
    const breaks: ChainBreak[] = [
      { kind: 'lost_note', documentId: 'n1', detail: 'x' },
      { kind: 'ambiguous_assignment', documentId: 'a1', detail: 'x' },
      { kind: 'unrecorded_instrument', documentId: 'm1', detail: 'x' },
    ];
    for (const decision of route('deal-1', breaks)) {
      expect(decision.kind).toBe('attorney_review');
    }
  });

  it('emits exactly one decision per break', () => {
    const breaks: ChainBreak[] = [
      { kind: 'missing_assignment', documentId: 'a1', detail: 'x' },
      { kind: 'lost_note', documentId: 'n1', detail: 'x' },
    ];
    expect(route('deal-1', breaks)).toHaveLength(2);
  });

  it('never propagates break.detail (PII) into the reason', () => {
    const pii = 'Old Servicer LLC -> New Bank NA';
    const decisions = route('deal-1', [
      { kind: 'ambiguous_assignment', documentId: 'a1', detail: pii },
    ]);
    expect(decisions[0].reason).not.toContain('Old Servicer LLC');
    expect(decisions[0].reason).not.toContain('New Bank NA');
  });

  it('produces a defined route + reason for every break kind', () => {
    for (const kind of BREAK_KINDS) {
      const [decision] = route('deal-1', [{ kind, documentId: 'd1', detail: 'x' }]);
      expect(decision.kind).toBeTruthy();
      expect(decision.reason.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 6: Update `src/index.ts`**

```typescript
export * from './types';
export { analyzeChain } from './chain';
export { route } from './route';
```

- [ ] **Step 7: Run the package test suite**

Run: `cmd /c "pnpm --filter @cema/agents-chain-of-title test"`
Expected: PASS — 5 (types) + 14 (chain) + 6 (route) = 25 tests.

- [ ] **Step 8: Typecheck**

Run: `cmd /c "pnpm --filter @cema/agents-chain-of-title typecheck"`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add packages/agents/chain-of-title/src/chain.ts packages/agents/chain-of-title/src/chain.test.ts packages/agents/chain-of-title/src/route.ts packages/agents/chain-of-title/src/route.test.ts packages/agents/chain-of-title/src/index.ts
git commit -S -m "feat(m13): chain-of-title pure core (analyzeChain + route)"
```

---

## PR-3: Orchestrator (`runChainOfTitle`) + trace + app wiring

**Files:**

- Create: `packages/agents/chain-of-title/src/orchestrator.ts`
- Create: `packages/agents/chain-of-title/src/orchestrator.test.ts`
- Create: `packages/agents/chain-of-title/src/orchestrator.trace.test.ts`
- Modify: `packages/agents/chain-of-title/src/index.ts`
- Create: `apps/web/lib/agents/chain-of-title/deps.ts`
- Create: `apps/web/lib/agents/chain-of-title/run-chain-of-title-action.ts`

- [ ] **Step 1: Write `src/orchestrator.ts`**

```typescript
import { withChildSpan } from '@cema/observability';
import { SpanStatusCode, trace } from '@opentelemetry/api';

import { analyzeChain } from './chain';
import { route } from './route';
import type { ChainDeps, ChainResult, RouteDecision } from './types';

const tracer = trace.getTracer('@cema/agents-chain-of-title');

/**
 * Orchestration-agnostic Chain-of-Title core. Loads the deal's persisted
 * InstrumentRecord[] (written 1:1 onto documents by the Collateral IDP),
 * deterministically classifies every break in the recorded chain, and routes
 * each break to re-chase or attorney review. No app/DB/Clerk/LLM import; every
 * effect is injected via ChainDeps, so the flat await chain maps 1:1 onto a WDK
 * step boundary (dormant durable wrap in PR-4).
 *
 * Split audit: chain.analyzed is emitted on EVERY run before any write;
 * chain.routed is emitted once inside the chain.route span (aggregate counts),
 * after each break is dispatched to its dormant actuator seam
 * (deps.routeReChase / deps.openAttorneyReview). A clean chain emits
 * chain.analyzed only -- no seam is called and no chain.routed is written.
 *
 * Only 3 child spans (vs IDP's 4) because analyze + route are synchronous pure
 * calls -- there is no async "extract" boundary to span.
 */
export async function runChainOfTitle(dealId: string, deps: ChainDeps): Promise<ChainResult> {
  return tracer.startActiveSpan('chain.run', async (span) => {
    span.setAttribute('chain.deal_id', dealId);
    try {
      const instruments = await withChildSpan(tracer, 'chain.load_instruments', () =>
        deps.loadInstruments(dealId),
      );

      const analysis = analyzeChain(instruments);
      const routes: readonly RouteDecision[] = route(dealId, analysis.breaks);

      const reChaseCount = routes.filter((r) => r.kind === 're_chase').length;
      const attorneyReviewCount = routes.filter((r) => r.kind === 'attorney_review').length;

      span.setAttribute('chain.status', analysis.status);
      span.setAttribute('chain.edge_count', analysis.edges.length);
      span.setAttribute('chain.break_count', analysis.breaks.length);
      span.setAttribute('chain.re_chase_count', reChaseCount);
      span.setAttribute('chain.attorney_review_count', attorneyReviewCount);

      await withChildSpan(tracer, 'chain.emit_analyzed', () =>
        deps.emitAudit({
          action: 'chain.analyzed',
          dealId,
          status: analysis.status,
          breakCount: analysis.breaks.length,
          reChaseCount,
          attorneyReviewCount,
        }),
      );

      if (analysis.breaks.length > 0) {
        // One chain.route span dispatches every break to its dormant actuator
        // seam, then emits the single aggregate chain.routed audit. advisory_pass
        // (clean chains) never reaches here, so no seam is called.
        await withChildSpan(tracer, 'chain.route', async () => {
          for (const decision of routes) {
            if (decision.kind === 're_chase') {
              await deps.routeReChase(decision);
            } else if (decision.kind === 'attorney_review') {
              await deps.openAttorneyReview(decision);
            }
          }
          await deps.emitAudit({
            action: 'chain.routed',
            dealId,
            status: analysis.status,
            breakCount: analysis.breaks.length,
            reChaseCount,
            attorneyReviewCount,
          });
        });
      }

      span.setStatus({ code: SpanStatusCode.OK });
      return { dealId, status: analysis.status, breaks: analysis.breaks, routes };
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

- [ ] **Step 2: Update `src/index.ts`**

```typescript
export * from './types';
export { analyzeChain } from './chain';
export { route } from './route';
export { runChainOfTitle } from './orchestrator';
```

- [ ] **Step 3: Write `src/orchestrator.test.ts`**

```typescript
import { describe, expect, it } from 'vitest';

import { runChainOfTitle } from './orchestrator';
import type { ChainAuditEvent, ChainDeps, InstrumentRecord, RouteDecision } from './types';

function makeDeps(instruments: readonly InstrumentRecord[]): {
  deps: ChainDeps;
  events: string[];
  audits: ChainAuditEvent[];
  reChased: RouteDecision[];
  attorneyReviews: RouteDecision[];
} {
  const events: string[] = [];
  const audits: ChainAuditEvent[] = [];
  const reChased: RouteDecision[] = [];
  const attorneyReviews: RouteDecision[] = [];
  const deps: ChainDeps = {
    loadInstruments: () => Promise.resolve(instruments),
    routeReChase: (decision) => {
      reChased.push(decision);
      return Promise.resolve();
    },
    openAttorneyReview: (decision) => {
      attorneyReviews.push(decision);
      return Promise.resolve();
    },
    emitAudit: (event) => {
      events.push(event.action);
      audits.push(event);
      return Promise.resolve();
    },
  };
  return { deps, events, audits, reChased, attorneyReviews };
}

const REC = (crfn: string) => ({ reelPage: null, crfn });
const baseInst = {
  assignor: null,
  assignee: null,
  executedAt: null,
  recordedAt: null,
  amount: null,
  county: null,
  references: null,
};

describe('runChainOfTitle', () => {
  it('emits only chain.analyzed and calls no seam for a clean chain', async () => {
    const instruments: InstrumentRecord[] = [
      { ...baseInst, documentId: 'm1', instrumentKind: 'mortgage', recordingRef: REC('c-m1') },
      {
        ...baseInst,
        documentId: 'a1',
        instrumentKind: 'aom',
        assignor: 'A',
        assignee: 'B',
        recordedAt: '2026-01-01',
        recordingRef: REC('c-a1'),
      },
    ];
    const { deps, events, reChased, attorneyReviews } = makeDeps(instruments);

    const result = await runChainOfTitle('deal-1', deps);

    expect(result.status).toBe('clean');
    expect(events).toEqual(['chain.analyzed']);
    expect(reChased).toHaveLength(0);
    expect(attorneyReviews).toHaveLength(0);
    expect(result.routes).toHaveLength(1);
    expect(result.routes[0].kind).toBe('advisory_pass');
  });

  it('emits chain.analyzed then chain.routed and opens attorney_review for a fork', async () => {
    const instruments: InstrumentRecord[] = [
      { ...baseInst, documentId: 'm1', instrumentKind: 'mortgage', recordingRef: REC('c-m1') },
      {
        ...baseInst,
        documentId: 'a1',
        instrumentKind: 'aom',
        assignor: 'A',
        assignee: 'B',
        recordedAt: '2026-01-01',
        recordingRef: REC('c-a1'),
      },
      {
        ...baseInst,
        documentId: 'a2',
        instrumentKind: 'aom',
        assignor: 'A',
        assignee: 'C',
        recordedAt: '2026-02-01',
        recordingRef: REC('c-a2'),
      },
    ];
    const { deps, events, audits, reChased, attorneyReviews } = makeDeps(instruments);

    const result = await runChainOfTitle('deal-1', deps);

    expect(result.status).toBe('ambiguous');
    expect(events).toEqual(['chain.analyzed', 'chain.routed']);
    expect(attorneyReviews.every((r) => r.kind === 'attorney_review')).toBe(true);
    expect(attorneyReviews).toHaveLength(2);
    expect(reChased).toHaveLength(0);
    expect(audits[0]).toEqual(
      expect.objectContaining({
        action: 'chain.analyzed',
        status: 'ambiguous',
        attorneyReviewCount: 2,
      }),
    );
  });

  it('routes a sequential gap to re_chase (broken)', async () => {
    const instruments: InstrumentRecord[] = [
      { ...baseInst, documentId: 'm1', instrumentKind: 'mortgage', recordingRef: REC('c-m1') },
      {
        ...baseInst,
        documentId: 'a1',
        instrumentKind: 'aom',
        assignor: 'A',
        assignee: 'B',
        recordedAt: '2026-01-01',
        recordingRef: REC('c-a1'),
      },
      {
        ...baseInst,
        documentId: 'a2',
        instrumentKind: 'aom',
        assignor: 'C',
        assignee: 'D',
        recordedAt: '2026-02-01',
        recordingRef: REC('c-a2'),
      },
    ];
    const { deps, events, audits, reChased, attorneyReviews } = makeDeps(instruments);

    const result = await runChainOfTitle('deal-1', deps);

    expect(result.status).toBe('broken');
    expect(events).toEqual(['chain.analyzed', 'chain.routed']);
    expect(reChased).toHaveLength(1);
    expect(reChased[0].kind).toBe('re_chase');
    expect(attorneyReviews).toHaveLength(0);
    expect(audits[0]).toEqual(expect.objectContaining({ reChaseCount: 1, attorneyReviewCount: 0 }));
  });
});
```

- [ ] **Step 4: Write `src/orchestrator.trace.test.ts`**

```typescript
import { context, trace } from '@opentelemetry/api';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runChainOfTitle } from './orchestrator';
import type { ChainDeps, InstrumentRecord } from './types';

const ALLOWED_ATTR_KEYS = new Set([
  'chain.deal_id',
  'chain.status',
  'chain.edge_count',
  'chain.break_count',
  'chain.re_chase_count',
  'chain.attorney_review_count',
]);

const ORCHESTRATOR_SPANS = new Set([
  'chain.run',
  'chain.load_instruments',
  'chain.emit_analyzed',
  'chain.route',
]);

// PII that must never appear in any span attribute value.
const PII_ASSIGNOR = 'Old Servicer LLC';
const PII_ASSIGNEE = 'New Bank NA';

const REC = (crfn: string) => ({ reelPage: null, crfn });
const baseInst = {
  assignor: null,
  assignee: null,
  executedAt: null,
  recordedAt: null,
  amount: null,
  county: null,
  references: null,
};

describe('runChainOfTitle tracing', () => {
  let exporter: InMemorySpanExporter;
  let provider: BasicTracerProvider;
  let ctxManager: AsyncHooksContextManager;

  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
    ctxManager = new AsyncHooksContextManager().enable();
    context.setGlobalContextManager(ctxManager);
    trace.setGlobalTracerProvider(provider);
  });

  afterEach(async () => {
    await provider.shutdown();
    ctxManager.disable();
    context.disable();
  });

  it('emits only allowlisted, PII-free attributes on orchestrator spans', async () => {
    // A fork sharing a PII assignor forces the chain.route span to run.
    const instruments: InstrumentRecord[] = [
      { ...baseInst, documentId: 'm1', instrumentKind: 'mortgage', recordingRef: REC('c-m1') },
      {
        ...baseInst,
        documentId: 'a1',
        instrumentKind: 'aom',
        assignor: PII_ASSIGNOR,
        assignee: PII_ASSIGNEE,
        recordedAt: '2026-01-01',
        recordingRef: REC('c-a1'),
      },
      {
        ...baseInst,
        documentId: 'a2',
        instrumentKind: 'aom',
        assignor: PII_ASSIGNOR,
        assignee: 'Third Bank',
        recordedAt: '2026-02-01',
        recordingRef: REC('c-a2'),
      },
    ];
    const deps: ChainDeps = {
      loadInstruments: () => Promise.resolve(instruments),
      routeReChase: () => Promise.resolve(),
      openAttorneyReview: () => Promise.resolve(),
      emitAudit: () => Promise.resolve(),
    };

    await runChainOfTitle('deal-1', deps);

    const spans = exporter.getFinishedSpans();
    expect(spans.length).toBeGreaterThan(0);
    expect(spans.some((s) => s.name === 'chain.route')).toBe(true);

    for (const span of spans) {
      if (!ORCHESTRATOR_SPANS.has(span.name)) continue;
      for (const [key, value] of Object.entries(span.attributes)) {
        expect(ALLOWED_ATTR_KEYS.has(key)).toBe(true);
        const serialized = JSON.stringify(value);
        expect(serialized).not.toContain(PII_ASSIGNOR);
        expect(serialized).not.toContain(PII_ASSIGNEE);
      }
    }
  });
});
```

- [ ] **Step 5: Run the package suite**

Run: `cmd /c "pnpm --filter @cema/agents-chain-of-title test"`
Expected: PASS — 25 (PR-1/2) + 3 (orchestrator) + 1 (trace) = 29 tests.

- [ ] **Step 6: Write `apps/web/lib/agents/chain-of-title/deps.ts`**

> `loadInstruments` reads the `InstrumentRecord[]` the IDP persisted into `documents.extractedData` (under RLS). The per-route actuators `routeReChase` / `openAttorneyReview` are dormant no-ops in Phase 2 (carry-over #1 wires the real re-chase trigger + attorney-review surface, keyed `chain:<dealId>:break:<hash>` for idempotency); the durable record of routing is the `chain.routed` audit event, written by `emitAudit` (counts only — NO party names).

```typescript
import 'server-only';

import { runChainOfTitle } from '@cema/agents-chain-of-title';
import type {
  ChainAuditEvent,
  ChainDeps,
  ChainResult,
  InstrumentRecord,
  RouteDecision,
} from '@cema/agents-chain-of-title';
import { emitAuditEvent, withRls } from '@cema/db';
import { documents } from '@cema/db/schema';
import { and, eq } from 'drizzle-orm';

interface BuildDepsArgs {
  readonly organizationId: string;
  readonly actorUserId: string;
}

// The InstrumentRecord the Collateral IDP persisted lives in
// documents.extractedData. We trust the IDP's shape but defensively drop any
// row whose payload is null or lacks a string instrumentKind (a non-IDP doc).
function toInstrument(row: { id: string; extractedData: unknown }): InstrumentRecord | null {
  const data = row.extractedData;
  if (data === null || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  if (typeof record.instrumentKind !== 'string') return null;
  return record as unknown as InstrumentRecord;
}

export function buildChainDeps({ organizationId, actorUserId }: BuildDepsArgs): ChainDeps {
  return {
    loadInstruments: (dealId: string): Promise<readonly InstrumentRecord[]> =>
      withRls({ organizationId }, async (tx) => {
        const rows = await tx
          .select({ id: documents.id, extractedData: documents.extractedData })
          .from(documents)
          .where(and(eq(documents.organizationId, organizationId), eq(documents.dealId, dealId)));
        return rows.map(toInstrument).filter((i): i is InstrumentRecord => i !== null);
      }),

    // Dormant per-route actuators (carry-over #1). Once a re-chase trigger and
    // an attorney-review surface exist, these dispatch idempotently (keyed
    // chain:<dealId>:break:<hash>). Until then routing is durable solely via the
    // chain.routed audit event (emitAudit, below) -- the in-memory RouteDecision[]
    // is still returned to the caller. No-op now keeps the orchestrator wiring stable.
    routeReChase: (_decision: RouteDecision): Promise<void> => Promise.resolve(),

    openAttorneyReview: (_decision: RouteDecision): Promise<void> => Promise.resolve(),

    emitAudit: (event: ChainAuditEvent): Promise<void> =>
      withRls({ organizationId }, async (tx) => {
        await emitAuditEvent(tx, {
          organizationId,
          actorUserId,
          action: event.action,
          entityType: 'deal',
          entityId: event.dealId,
          metadata: {
            source: 'chain-of-title',
            status: event.status,
            breakCount: event.breakCount,
            reChaseCount: event.reChaseCount,
            attorneyReviewCount: event.attorneyReviewCount,
          },
        });
      }),
  };
}

export type { ChainResult };
export { runChainOfTitle };
```

- [ ] **Step 7: Write `apps/web/lib/agents/chain-of-title/run-chain-of-title-action.ts`**

```typescript
'use server';

import { runChainOfTitle } from '@cema/agents-chain-of-title';
import type { ChainResult } from '@cema/agents-chain-of-title';
import { getCurrentUser, getCurrentOrganizationId } from '@cema/auth';
import { getDb } from '@cema/db';
import { organizations } from '@cema/db/schema';
import { redactPii } from '@cema/compliance';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { eq } from 'drizzle-orm';

import { buildChainDeps } from './deps';

const tracer = trace.getTracer('@cema/web-chain-of-title');

/**
 * Server Action entry to the Chain-of-Title core. Resolves the Clerk org +
 * user, builds the real DB-backed deps, and runs the analyzer for one deal.
 * Errors are PII-redacted before they leave the boundary. No revalidatePath:
 * the deal-scoped attorney/route surface is a carry-over (#4); nothing renders
 * the routes yet.
 */
export async function runChainOfTitleFromDeal(dealId: string): Promise<ChainResult> {
  return tracer.startActiveSpan('chain.run_from_deal', async (span) => {
    span.setAttribute('chain.deal_id', dealId);
    try {
      const clerkOrgId = await getCurrentOrganizationId();
      if (clerkOrgId === null) throw new Error('Not authenticated');

      const user = await getCurrentUser();
      if (user === null) throw new Error('Not authenticated');

      const org = await getDb().query.organizations.findFirst({
        where: eq(organizations.clerkOrgId, clerkOrgId),
      });
      if (org === undefined) throw new Error('Organization not synced yet');
      if (user.id === undefined) throw new Error('User not synced yet');

      const deps = buildChainDeps({ organizationId: org.id, actorUserId: user.id });
      const result = await runChainOfTitle(dealId, deps);

      span.setAttribute('chain.status', result.status);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      const message = redactPii((err as Error).message);
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      throw new Error(message);
    } finally {
      span.end();
    }
  });
}
```

- [ ] **Step 8: Typecheck the app + package**

Run: `cmd /c "pnpm --filter web typecheck && pnpm --filter @cema/agents-chain-of-title typecheck"`
Expected: no errors. (If `getCurrentOrganizationId` / `getCurrentUser` / `emitAuditEvent` / `withRls` signatures differ from collateral-idp's `deps.ts`, copy that file's exact imports — they are the canonical reference.)

- [ ] **Step 9: Commit**

```bash
git add packages/agents/chain-of-title/src/orchestrator.ts packages/agents/chain-of-title/src/orchestrator.test.ts packages/agents/chain-of-title/src/orchestrator.trace.test.ts packages/agents/chain-of-title/src/index.ts apps/web/lib/agents/chain-of-title/deps.ts apps/web/lib/agents/chain-of-title/run-chain-of-title-action.ts
git commit -S -m "feat(m13): chain-of-title orchestrator (runChainOfTitle) + trace + app wiring"
```

---

## PR-4: Dormant WDK durable wrap (single-pass)

> Mirrors the Collateral IDP single-pass durable wrap (ADR 0015). Chain has no cadence (no sleep loop) — the whole core runs as ONE `'use step'`. Dormant until Connor provisions a WDK backend; the mocked-step test is the behavioral guard, the `@workflow/vitest` durable proof is deferred (ADR 0013 carry-over #5).

**Files:**

- Create: `apps/web/lib/agents/chain-of-title/chain.steps.ts`
- Create: `apps/web/lib/agents/chain-of-title/chain.workflow.ts`
- Create: `apps/web/lib/agents/chain-of-title/chain.workflow.test.ts`
- Create: `apps/web/lib/agents/chain-of-title/run-chain-of-title-durable-action.ts`

- [ ] **Step 1: Write `apps/web/lib/agents/chain-of-title/chain.steps.ts`**

```typescript
'use step';

import type { ChainResult } from '@cema/agents-chain-of-title';

import { buildChainDeps, runChainOfTitle } from './deps';

/**
 * Durable step: the WHOLE Chain-of-Title core as one '\''use step'\''. Inputs are
 * serializable strings (ChainDeps is not serializable, so we rebuild deps
 * inside the step -- "Shape B" per ADR 0013). PII-safe log: ids + counts only.
 */
export async function runChainOfTitleStep(
  dealId: string,
  organizationId: string,
  actorUserId: string,
): Promise<ChainResult> {
  const deps = buildChainDeps({ organizationId, actorUserId });
  const result = await runChainOfTitle(dealId, deps);
  // eslint-disable-next-line no-console -- PII-safe durable-step breadcrumb.
  console.log(
    `chain.step deal=${dealId} status=${result.status} breaks=${result.breaks.length} routes=${result.routes.length}`,
  );
  return result;
}
```

- [ ] **Step 2: Write `apps/web/lib/agents/chain-of-title/chain.workflow.ts`**

```typescript
'use workflow';

import type { ChainResult } from '@cema/agents-chain-of-title';

import { runChainOfTitleStep } from './chain.steps';

/**
 * Durable single-pass workflow. Chain-of-Title has no cadence, so unlike the
 * outreach workflow there is no sleep loop -- the workflow is exactly one step.
 * Kept as a workflow (not a bare action) so it inherits WDK durability +
 * retry/replay once a backend is provisioned (DORMANT today).
 */
export async function chainWorkflow(
  dealId: string,
  organizationId: string,
  actorUserId: string,
): Promise<ChainResult> {
  return runChainOfTitleStep(dealId, organizationId, actorUserId);
}
```

- [ ] **Step 3: Write `apps/web/lib/agents/chain-of-title/chain.workflow.test.ts`**

```typescript
import { describe, expect, it, vi } from 'vitest';

import type { ChainResult } from '@cema/agents-chain-of-title';

import { chainWorkflow } from './chain.workflow';
import { runChainOfTitleStep } from './chain.steps';

vi.mock('./chain.steps', () => ({ runChainOfTitleStep: vi.fn() }));

const mockedStep = vi.mocked(runChainOfTitleStep);

describe('chainWorkflow', () => {
  it('runs the step exactly once and passes the result through', async () => {
    const result: ChainResult = { dealId: 'deal-1', status: 'clean', breaks: [], routes: [] };
    mockedStep.mockResolvedValueOnce(result);

    const returned = await chainWorkflow('deal-1', 'org-1', 'user-1');

    expect(mockedStep).toHaveBeenCalledTimes(1);
    expect(mockedStep).toHaveBeenCalledWith('deal-1', 'org-1', 'user-1');
    expect(returned).toBe(result);
  });

  it('propagates a step failure', async () => {
    mockedStep.mockRejectedValueOnce(new Error('load failed'));
    await expect(chainWorkflow('deal-1', 'org-1', 'user-1')).rejects.toThrow('load failed');
  });
});
```

- [ ] **Step 4: Write `apps/web/lib/agents/chain-of-title/run-chain-of-title-durable-action.ts`**

```typescript
'use server';

import { start } from 'workflow/api';

import { runChainOfTitle } from '@cema/agents-chain-of-title';
import type { ChainResult } from '@cema/agents-chain-of-title';
import { getCurrentUser, getCurrentOrganizationId } from '@cema/auth';
import { getDb } from '@cema/db';
import { organizations } from '@cema/db/schema';
import { eq } from 'drizzle-orm';

import { chainWorkflow } from './chain.workflow';

/**
 * DORMANT durable entry to the Chain-of-Title workflow. Not wired to any
 * trigger or UI yet. Activation prerequisites (Connor):
 *   1. Provision a WDK backend + VERCEL_OIDC_TOKEN.
 *   2. Exclude /.well-known/workflow/* from the proxy.ts matcher.
 *   3. Flip the live path behind a flag.
 * Until then runChainOfTitleFromDeal (the in-request Server Action) is the only
 * live path. Single-pass + bounded, so the in-request `await run.returnValue`
 * is acceptable here (no weeks-long sleep, unlike outreach -- ADR 0014).
 */
export async function runChainOfTitleFromDealDurable(dealId: string): Promise<ChainResult> {
  const clerkOrgId = await getCurrentOrganizationId();
  if (clerkOrgId === null) throw new Error('Not authenticated');

  const user = await getCurrentUser();
  if (user === null || user.id === undefined) throw new Error('Not authenticated');

  const org = await getDb().query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (org === undefined) throw new Error('Organization not synced yet');

  const run = await start(chainWorkflow, [dealId, org.id, user.id]);
  const result = await run.returnValue;
  return result;
}

// Re-exported so the dormant action keeps a value-level reference to the core
// (parity with the IDP dormant action; avoids an unused-import lint on swap-in).
export { runChainOfTitle };
```

- [ ] **Step 5: Run the app durable tests**

Run: `cmd /c "pnpm --filter web test chain.workflow.test.ts"`
Expected: 2 tests PASS.

- [ ] **Step 6: Typecheck the app**

Run: `cmd /c "pnpm --filter web typecheck"`
Expected: no errors. (The `'use step'` / `'use workflow'` directives are inert without a WDK backend; the package `workflow` resolves `workflow/api` at build time — confirm it is already a dependency of `apps/web` from the IDP/outreach work.)

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/agents/chain-of-title/chain.steps.ts apps/web/lib/agents/chain-of-title/chain.workflow.ts apps/web/lib/agents/chain-of-title/chain.workflow.test.ts apps/web/lib/agents/chain-of-title/run-chain-of-title-durable-action.ts
git commit -S -m "feat(m13): dormant WDK durable wrap for chain-of-title (single-pass)"
```

---

## PR-5: Braintrust eval (offline scorers as the real gate)

> Mirrors the Collateral IDP eval. No LLM in the loop, so `REQUIRED_KEYS=['BRAINTRUST_API_KEY']` only (no `AI_GATEWAY_API_KEY`). The offline `scorers.test.ts` is the real compliance gate (runs in the required Unit-tests job); the live `Eval()` skip-greens unless `BRAINTRUST_API_KEY` is set. The `noFalseClean` scorer encodes the "never auto-bless" safety property.

**Files:**

- Create: `packages/agents/chain-of-title/evals/fixtures.ts`
- Create: `packages/agents/chain-of-title/evals/scorers.ts`
- Create: `packages/agents/chain-of-title/evals/scorers.test.ts`
- Create: `packages/agents/chain-of-title/evals/chain-of-title.eval.ts`
- Create: `packages/agents/chain-of-title/evals/run.mjs`

- [ ] **Step 1: Write `evals/fixtures.ts`**

```typescript
import type {
  ChainStatus,
  BreakKind,
  RouteKind,
  DocumentKind,
  InstrumentRecord,
  RecordingRef,
} from '../src/types';

const REC = (crfn: string): RecordingRef => ({ reelPage: null, crfn });
const UNREC: RecordingRef = { reelPage: null, crfn: null };

function inst(
  partial: Partial<InstrumentRecord> & { documentId: string; instrumentKind: DocumentKind },
): InstrumentRecord {
  return {
    assignor: null,
    assignee: null,
    executedAt: null,
    recordedAt: null,
    amount: null,
    recordingRef: REC(`crfn-${partial.documentId}`),
    county: null,
    references: null,
    ...partial,
  };
}

const mortgage = (id: string, recorded = true): InstrumentRecord =>
  inst({
    documentId: id,
    instrumentKind: 'mortgage',
    recordingRef: recorded ? REC(`c-${id}`) : UNREC,
  });
const gapMortgage = (id: string): InstrumentRecord =>
  inst({ documentId: id, instrumentKind: 'gap_mortgage' });
const noteDoc = (
  id: string,
  kind: DocumentKind = 'note',
  references: string | null = null,
): InstrumentRecord => inst({ documentId: id, instrumentKind: kind, references });
const consolidation = (
  id: string,
  kind: DocumentKind,
  references: string | null = null,
): InstrumentRecord => inst({ documentId: id, instrumentKind: kind, references });
const aom = (
  id: string,
  assignor: string | null,
  assignee: string | null,
  opts: { ref?: string | null; recordedAt?: string | null; isRec?: boolean } = {},
): InstrumentRecord =>
  inst({
    documentId: id,
    instrumentKind: 'aom',
    assignor,
    assignee,
    recordedAt: opts.recordedAt ?? null,
    references: opts.ref ?? null,
    recordingRef: opts.isRec === false ? UNREC : REC(`c-${id}`),
  });

export interface ChainFixture {
  readonly name: string;
  readonly instruments: readonly InstrumentRecord[];
  readonly expected: {
    readonly status: ChainStatus;
    readonly breakKinds: readonly BreakKind[];
    readonly routeKinds: readonly RouteKind[];
  };
}

// 24 fixtures spanning every status, break kind, and route kind. `references`
// is decorative here -- analyzeChain does not read it (carry-over #6).
export const CHAIN_FIXTURES: readonly ChainFixture[] = [
  {
    name: 'F1 single recorded assignment is clean',
    instruments: [mortgage('m1'), aom('a1', 'A', 'B', { recordedAt: '2026-01-01' })],
    expected: { status: 'clean', breakKinds: [], routeKinds: ['advisory_pass'] },
  },
  {
    name: 'F2 contiguous three-hop chain is clean',
    instruments: [
      mortgage('m1'),
      aom('a1', 'A', 'B', { recordedAt: '2026-01-01' }),
      aom('a2', 'B', 'C', { recordedAt: '2026-02-01' }),
      aom('a3', 'C', 'D', { recordedAt: '2026-03-01' }),
    ],
    expected: { status: 'clean', breakKinds: [], routeKinds: ['advisory_pass'] },
  },
  {
    name: 'F3 mortgage with no assignments is clean',
    instruments: [mortgage('m1')],
    expected: { status: 'clean', breakKinds: [], routeKinds: ['advisory_pass'] },
  },
  {
    name: 'F4 single sequential gap is broken',
    instruments: [
      mortgage('m1'),
      aom('a1', 'A', 'B', { recordedAt: '2026-01-01' }),
      aom('a2', 'C', 'D', { recordedAt: '2026-02-01' }),
    ],
    expected: { status: 'broken', breakKinds: ['missing_assignment'], routeKinds: ['re_chase'] },
  },
  {
    name: 'F5 two sequential gaps are broken',
    instruments: [
      mortgage('m1'),
      aom('a1', 'A', 'B', { recordedAt: '2026-01-01' }),
      aom('a2', 'C', 'D', { recordedAt: '2026-02-01' }),
      aom('a3', 'E', 'F', { recordedAt: '2026-03-01' }),
    ],
    expected: {
      status: 'broken',
      breakKinds: ['missing_assignment', 'missing_assignment'],
      routeKinds: ['re_chase', 're_chase'],
    },
  },
  {
    name: 'F6 fork is ambiguous',
    instruments: [
      mortgage('m1'),
      aom('a1', 'A', 'B', { recordedAt: '2026-01-01' }),
      aom('a2', 'A', 'C', { recordedAt: '2026-02-01' }),
    ],
    expected: {
      status: 'ambiguous',
      breakKinds: ['ambiguous_assignment', 'ambiguous_assignment'],
      routeKinds: ['attorney_review', 'attorney_review'],
    },
  },
  {
    name: 'F7 merge is ambiguous',
    instruments: [
      mortgage('m1'),
      aom('a1', 'A', 'C', { recordedAt: '2026-01-01' }),
      aom('a2', 'B', 'C', { recordedAt: '2026-02-01' }),
    ],
    expected: {
      status: 'ambiguous',
      breakKinds: ['ambiguous_assignment', 'ambiguous_assignment'],
      routeKinds: ['attorney_review', 'attorney_review'],
    },
  },
  {
    name: 'F8 two-node cycle is ambiguous',
    instruments: [
      mortgage('m1'),
      aom('a1', 'A', 'B', { recordedAt: '2026-01-01' }),
      aom('a2', 'B', 'A', { recordedAt: '2026-02-01' }),
    ],
    expected: {
      status: 'ambiguous',
      breakKinds: ['ambiguous_assignment'],
      routeKinds: ['attorney_review'],
    },
  },
  {
    name: 'F9 missing assignee is ambiguous',
    instruments: [mortgage('m1'), aom('a1', 'A', null, { recordedAt: '2026-01-01' })],
    expected: {
      status: 'ambiguous',
      breakKinds: ['ambiguous_assignment'],
      routeKinds: ['attorney_review'],
    },
  },
  {
    name: 'F10 missing assignor is ambiguous',
    instruments: [mortgage('m1'), aom('a1', null, 'B', { recordedAt: '2026-01-01' })],
    expected: {
      status: 'ambiguous',
      breakKinds: ['ambiguous_assignment'],
      routeKinds: ['attorney_review'],
    },
  },
  {
    name: 'F11 orphaned note is ambiguous (lost_note)',
    instruments: [noteDoc('n1')],
    expected: { status: 'ambiguous', breakKinds: ['lost_note'], routeKinds: ['attorney_review'] },
  },
  {
    name: 'F12 unrecorded mortgage',
    instruments: [mortgage('m1', false)],
    expected: {
      status: 'ambiguous',
      breakKinds: ['unrecorded_instrument'],
      routeKinds: ['attorney_review'],
    },
  },
  {
    name: 'F13 unrecorded assignment',
    instruments: [mortgage('m1'), aom('a1', 'A', 'B', { recordedAt: '2026-01-01', isRec: false })],
    expected: {
      status: 'ambiguous',
      breakKinds: ['unrecorded_instrument'],
      routeKinds: ['attorney_review'],
    },
  },
  {
    name: 'F14 empty set is ambiguous (never clean)',
    instruments: [],
    expected: {
      status: 'ambiguous',
      breakKinds: ['ambiguous_assignment'],
      routeKinds: ['attorney_review'],
    },
  },
  {
    name: 'F15 gap_mortgage anchor with clean assignment',
    instruments: [gapMortgage('m1'), aom('a1', 'A', 'B', { recordedAt: '2026-01-01' })],
    expected: { status: 'clean', breakKinds: [], routeKinds: ['advisory_pass'] },
  },
  {
    name: 'F16 consolidated_note anchor is clean with no assignments',
    instruments: [consolidation('c1', 'consolidated_note')],
    expected: { status: 'clean', breakKinds: [], routeKinds: ['advisory_pass'] },
  },
  {
    name: 'F17 cema_3172 anchor is clean',
    instruments: [
      consolidation('c1', 'cema_3172'),
      aom('a1', 'A', 'B', { recordedAt: '2026-01-01' }),
    ],
    expected: { status: 'clean', breakKinds: [], routeKinds: ['advisory_pass'] },
  },
  {
    name: 'F18 note plus anchor is clean (note is anchored)',
    instruments: [mortgage('m1'), noteDoc('n1')],
    expected: { status: 'clean', breakKinds: [], routeKinds: ['advisory_pass'] },
  },
  {
    name: 'F19 gap_note orphan is lost_note',
    instruments: [noteDoc('n1', 'gap_note')],
    expected: { status: 'ambiguous', breakKinds: ['lost_note'], routeKinds: ['attorney_review'] },
  },
  {
    name: 'F20 three-node cycle is ambiguous',
    instruments: [
      mortgage('m1'),
      aom('a1', 'A', 'B', { recordedAt: '2026-01-01' }),
      aom('a2', 'B', 'C', { recordedAt: '2026-02-01' }),
      aom('a3', 'C', 'A', { recordedAt: '2026-03-01' }),
    ],
    expected: {
      status: 'ambiguous',
      breakKinds: ['ambiguous_assignment'],
      routeKinds: ['attorney_review'],
    },
  },
  {
    name: 'F21 unrecorded mortgage AND a clean assignment',
    instruments: [mortgage('m1', false), aom('a1', 'A', 'B', { recordedAt: '2026-01-01' })],
    expected: {
      status: 'ambiguous',
      breakKinds: ['unrecorded_instrument'],
      routeKinds: ['attorney_review'],
    },
  },
  {
    name: 'F22 fork plus a third clean-looking hop stays ambiguous',
    instruments: [
      mortgage('m1'),
      aom('a1', 'A', 'B', { recordedAt: '2026-01-01' }),
      aom('a2', 'A', 'C', { recordedAt: '2026-02-01' }),
      aom('a3', 'B', 'D', { recordedAt: '2026-03-01' }),
    ],
    expected: {
      status: 'ambiguous',
      breakKinds: ['ambiguous_assignment', 'ambiguous_assignment'],
      routeKinds: ['attorney_review', 'attorney_review'],
    },
  },
  {
    name: 'F23 two orphaned notes are two lost_notes',
    instruments: [noteDoc('n1'), noteDoc('n2', 'gap_note')],
    expected: {
      status: 'ambiguous',
      breakKinds: ['lost_note', 'lost_note'],
      routeKinds: ['attorney_review', 'attorney_review'],
    },
  },
  {
    name: 'F24 single allonge with parties under an anchor is clean',
    instruments: [
      mortgage('m1'),
      inst({
        documentId: 'al1',
        instrumentKind: 'allonge',
        assignor: 'A',
        assignee: 'B',
        recordedAt: '2026-01-01',
      }),
    ],
    expected: { status: 'clean', breakKinds: [], routeKinds: ['advisory_pass'] },
  },
] as const;
```

- [ ] **Step 2: Write `evals/scorers.ts`**

```typescript
import { analyzeChain } from '../src/chain';
import { route } from '../src/route';
import type { BreakKind, ChainStatus, InstrumentRecord, RouteKind } from '../src/types';
import type { ChainFixture } from './fixtures';

export interface PipelineOutput {
  readonly status: ChainStatus;
  readonly breakKinds: readonly BreakKind[];
  readonly routeKinds: readonly RouteKind[];
}

export type ChainExpected = ChainFixture['expected'];

// The pipeline a fixture exercises: analyze then route, exactly as the
// orchestrator does (minus the injected effects).
export function runPipeline(instruments: readonly InstrumentRecord[]): PipelineOutput {
  const analysis = analyzeChain(instruments);
  const routes = route('eval-deal', analysis.breaks);
  return {
    status: analysis.status,
    breakKinds: analysis.breaks.map((b) => b.kind),
    routeKinds: routes.map((r) => r.kind),
  };
}

function sortedEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].map(String).sort();
  const sb = [...b].map(String).sort();
  return sa.every((v, i) => v === sb[i]);
}

interface ScorerArgs {
  readonly output: PipelineOutput;
  readonly expected: ChainExpected;
}

export const statusCorrect = {
  name: 'status_correct',
  scorer: ({ output, expected }: ScorerArgs): number => (output.status === expected.status ? 1 : 0),
};

export const breakKindsCorrect = {
  name: 'break_kinds_correct',
  scorer: ({ output, expected }: ScorerArgs): number =>
    sortedEqual(output.breakKinds, expected.breakKinds) ? 1 : 0,
};

export const routeKindsCorrect = {
  name: 'route_kinds_correct',
  scorer: ({ output, expected }: ScorerArgs): number =>
    sortedEqual(output.routeKinds, expected.routeKinds) ? 1 : 0,
};

// The safety scorer ("never auto-bless"): a clean verdict is only acceptable
// when the fixture truly expects clean. Any clean output where the expectation
// is NOT clean scores 0 -- this is the property the whole agent exists to hold.
export const noFalseClean = {
  name: 'no_false_clean',
  scorer: ({ output, expected }: ScorerArgs): number => {
    if (output.status === 'clean' && expected.status !== 'clean') return 0;
    return 1;
  },
};

export const CHAIN_SCORERS = [statusCorrect, breakKindsCorrect, routeKindsCorrect, noFalseClean];
```

- [ ] **Step 3: Write `evals/scorers.test.ts` (the real offline gate)**

```typescript
import { describe, expect, it } from 'vitest';

import { CHAIN_FIXTURES } from './fixtures';
import { CHAIN_SCORERS, runPipeline } from './scorers';

describe('chain-of-title offline scorers', () => {
  it.each(CHAIN_FIXTURES)('$name scores 1.0 on every scorer', (fixture) => {
    const output = runPipeline(fixture.instruments);
    for (const { name, scorer } of CHAIN_SCORERS) {
      const score = scorer({ output, expected: fixture.expected });
      expect(score, `${fixture.name} / ${name}`).toBe(1);
    }
  });

  it('noFalseClean catches a fabricated false-clean output', () => {
    const safety = CHAIN_SCORERS.find((s) => s.name === 'no_false_clean');
    expect(safety).toBeDefined();
    const score = safety!.scorer({
      output: { status: 'clean', breakKinds: [], routeKinds: ['advisory_pass'] },
      expected: { status: 'broken', breakKinds: ['missing_assignment'], routeKinds: ['re_chase'] },
    });
    expect(score).toBe(0);
  });
});
```

- [ ] **Step 4: Write `evals/chain-of-title.eval.ts`**

```typescript
import { Eval } from 'braintrust';

import type { InstrumentRecord } from '../src/types';
import { CHAIN_FIXTURES } from './fixtures';
import { CHAIN_SCORERS, runPipeline } from './scorers';
import type { ChainExpected, PipelineOutput } from './scorers';

// Live Braintrust eval. Skip-greens unless BRAINTRUST_API_KEY is set (run.mjs
// gates this). The offline scorers.test.ts is the real CI gate; this exists for
// the Braintrust dashboard + regression tracking once the key is provisioned.
void Eval<readonly InstrumentRecord[], PipelineOutput, ChainExpected>('chain-of-title', {
  data: CHAIN_FIXTURES.map((f) => ({
    input: f.instruments,
    expected: f.expected,
    metadata: { name: f.name },
  })),
  task: (input) => runPipeline(input),
  scores: CHAIN_SCORERS.map(({ name, scorer }) => {
    const fn = (args: { output: PipelineOutput; expected: ChainExpected }) => ({
      name,
      score: scorer(args),
    });
    Object.defineProperty(fn, 'name', { value: name });
    return fn;
  }),
});
```

- [ ] **Step 5: Write `evals/run.mjs`**

```javascript
import { spawnSync } from 'node:child_process';

// No LLM in the chain-of-title eval, so the only key the live run needs is
// BRAINTRUST_API_KEY. Absent it, skip-green (the offline scorers.test.ts is the
// real gate that runs in the required Unit-tests job).
const REQUIRED_KEYS = ['BRAINTRUST_API_KEY'];
const missing = REQUIRED_KEYS.filter((k) => !process.env[k]);

if (missing.length > 0) {
  console.log(`[chain-of-title eval] skipped -- missing env: ${missing.join(', ')}`);
  process.exit(0);
}

const result = spawnSync('pnpm', ['exec', 'braintrust', 'eval', 'evals/chain-of-title.eval.ts'], {
  stdio: 'inherit',
  shell: true,
});
process.exit(result.status ?? 1);
```

- [ ] **Step 6: Run the offline scorer gate**

Run: `cmd /c "pnpm --filter @cema/agents-chain-of-title test evals/scorers.test.ts"`
Expected: 25 tests PASS (24 fixtures + 1 false-clean guard).

- [ ] **Step 7: Confirm the live runner skip-greens with no key**

Run: `cmd /c "pnpm --filter @cema/agents-chain-of-title eval"`
Expected: prints `[chain-of-title eval] skipped -- missing env: BRAINTRUST_API_KEY` and exits 0.

- [ ] **Step 8: Full package suite + typecheck**

Run: `cmd /c "pnpm --filter @cema/agents-chain-of-title test && pnpm --filter @cema/agents-chain-of-title typecheck"`
Expected: PASS — 29 (PR-1..3) + 25 (scorers) = 54 tests.

- [ ] **Step 9: Commit**

```bash
git add packages/agents/chain-of-title/evals/fixtures.ts packages/agents/chain-of-title/evals/scorers.ts packages/agents/chain-of-title/evals/scorers.test.ts packages/agents/chain-of-title/evals/chain-of-title.eval.ts packages/agents/chain-of-title/evals/run.mjs
git commit -S -m "feat(m13): Braintrust eval for chain-of-title (offline scorers as the gate)"
```

---

## Final verification (before opening the PR series)

- [ ] **Step 1: Per-package sweep with expected counts**

Run: `cmd /c "pnpm --filter @cema/agents-chain-of-title test"`
Expected: 54 tests across 6 files:

- `src/types.test.ts` — 5
- `src/chain.test.ts` — 14
- `src/route.test.ts` — 6
- `src/orchestrator.test.ts` — 3
- `src/orchestrator.trace.test.ts` — 1
- `evals/scorers.test.ts` — 25

- [ ] **Step 2: App durable + wiring sweep**

Run: `cmd /c "pnpm --filter web test chain.workflow.test.ts"`
Expected: 2 tests PASS.

- [ ] **Step 3: Whole-repo gate (the four required CI checks)**

Run: `cmd /c "pnpm typecheck && pnpm lint && pnpm test"`
Expected: all green. (If `pnpm format:check` is part of `lint`, run `cmd /c "pnpm format"` first — it lints `*.md` including this plan.)

- [ ] **Step 4: Confirm 0 new migrations**

Run: `cmd /c "git status packages/db/migrations"`
Expected: no changes — chain-of-title reads `documents.extractedData` and writes only `audit_events`.

---

## Carry-overs (deferred to M14+)

1. **Real route actuators.** `routeReChase` / `openAttorneyReview` are dormant no-ops; routing is durable solely via the `chain.routed` audit event (counts in metadata) plus the in-memory `RouteDecision[]` returned to the caller. Wiring the real re-chase trigger (hand off to the Servicer Outreach Agent) + a first-class attorney/processor review surface that renders re-chase vs. attorney-review items — each dispatched idempotently, keyed `chain:<dealId>:break:<hash>` — is deferred. Until then findings are audited but not rendered or acted on.
2. **Wire a trigger.** Nothing invokes `runChainOfTitleFromDeal` yet. The natural trigger is "Collateral IDP finished persisting instruments for a deal" — a post-IDP hook or a `deal_status` transition. M14 owns this.
3. **Durable activation (Connor).** Provision a WDK backend + `VERCEL_OIDC_TOKEN`, exclude `/.well-known/workflow/*` from the `proxy.ts` matcher, then flip `chainWorkflow` live behind a flag. Single-pass + bounded, so the in-request `await run.returnValue` is acceptable (unlike outreach's weeks-long sleep).
4. **Trace the durable step** + provision `BRAINTRUST_API_KEY` for the live chain-of-title eval (the offline `scorers.test.ts` is the real gate meanwhile).
5. **Head-gap verification.** `analyzeChain` checks internal consistency of the assignment sequence (assignee[n] === assignor[n+1]) but cannot verify the FIRST assignment's assignor against the original mortgagee, because `InstrumentRecord` carries no originator field. Closing this needs either an enriched IDP extraction (original-mortgagee name on the anchor) or a title-commitment Schedule A cross-check.
6. **Reference-target validation.** `InstrumentRecord.references` (e.g. a CEMA's list of consolidated mortgages, or an AOM citing the mortgage it assigns) is currently ignored by `analyzeChain`. A future pass could parse `references` and confirm each cited instrument is present in the deal — turning the head-gap and "is every consolidated mortgage accounted for" checks from structural into reference-anchored.
7. **Allonge-specific semantics.** Allonges are treated as assignment-graph edges (assignor→assignee) alongside AOMs. A note-endorsement allonge has different chain semantics than a mortgage assignment; distinguishing them (and validating the allonge attaches to a note, not a mortgage) is deferred.
