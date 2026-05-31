# Collateral IDP Agent (M13 Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@cema/agents-collateral-idp` — the third Layer 3 agent — which classifies and extracts structured `InstrumentRecord` data from the prior-servicer collateral file's `documents` rows, enforcing the attorney-review gate deterministically.

**Architecture:** An orchestration-agnostic pure core (`runCollateralIdp`) on the proven M10/M12 blueprint: no app/DB/Clerk import; every effect injected via `IdpDeps`. A `FixtureIdpAdapter` fronts the (dormant) vendor IDP seam. Classification + field extraction are **pure deterministic** functions (no LLM in IDP). Each readable collateral `documents` row is enriched **1:1 in place** (kind + `attorneyReviewRequired` + `extractedData`), idempotent by `documents.id`. Split audit (`idp.evaluated` before any write every run; `idp.documents_classified` co-transactional with the enrich). OTel parent + PII-safe child spans. A dormant single-pass WDK durable wrap. 0 new migrations (reuses `documents`/`audit_events`).

**Tech Stack:** TypeScript (strict), Vitest, Drizzle/Neon Postgres + RLS, `@opentelemetry/api`, `@cema/observability` (`withChildSpan`), Vercel WDK (`workflow` package), Braintrust (offline scorers as the gate). NO AI SDK — IDP has no LLM call surface.

---

## File Structure

### Package — `packages/agents/collateral-idp/`

| File                             | Responsibility                                                                                                                                                                                                                                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`                   | Manifest. Deps: `@cema/observability`, `@opentelemetry/api`. **No** AI SDK. `@cema/db` is a **devDependency** only (drift guard).                                                                                                                                                                     |
| `tsconfig.json`                  | Extends `@cema/config/tsconfig/node.json`; includes `src/**/*` + `evals/**/*.ts`.                                                                                                                                                                                                                     |
| `src/types.ts`                   | `DOCUMENT_KINDS` (25-tuple) + `DocumentKind`; `GATE_REQUIRED_KINDS` (14); `UNREADABLE_CONFIDENCE_THRESHOLD`; `RecordingRef`; `InstrumentRecord`; `RawExtraction`; `CollateralDocumentRef`; `IdpContext`; `ClassifiedDoc`; `UnreadableSegment`; `IdpAuditEvent`; `IdpAdapter`; `IdpDeps`; `IdpResult`. |
| `src/types.test.ts`              | **Drift guard** — asserts `DOCUMENT_KINDS` and `GATE_REQUIRED_KINDS` match `@cema/db`'s `documentKindEnum` + the schema check-constraint kinds.                                                                                                                                                       |
| `src/classify.ts`                | `requiresAttorneyReview(kind)`; `KIND_BY_SIGNAL` synonym table; pure `classify(raw)`.                                                                                                                                                                                                                 |
| `src/classify.test.ts`           | Classification + gate-boolean unit tests.                                                                                                                                                                                                                                                             |
| `src/extract.ts`                 | Pure `extract(documentId, raw, classification) -> InstrumentRecord`; `toIsoDate`/`toAmount`/`toRecordingRef` helpers.                                                                                                                                                                                 |
| `src/extract.test.ts`            | Field-coercion unit tests (date/amount/CRFN-XOR).                                                                                                                                                                                                                                                     |
| `src/adapter.ts`                 | `IdpAdapter` seam + `FixtureIdpAdapter` (canned-or-empty, never fabricates).                                                                                                                                                                                                                          |
| `src/adapter.test.ts`            | Fixture-adapter unit tests.                                                                                                                                                                                                                                                                           |
| `src/orchestrator.ts`            | `runCollateralIdp` core — parent span + 4 child spans; split audit.                                                                                                                                                                                                                                   |
| `src/orchestrator.test.ts`       | classify+persist / unreadable / gate-boolean / split-audit-ordering tests.                                                                                                                                                                                                                            |
| `src/orchestrator.trace.test.ts` | PII-safe span-attribute allowlist guard.                                                                                                                                                                                                                                                              |
| `src/index.ts`                   | Public surface.                                                                                                                                                                                                                                                                                       |
| `evals/fixtures.ts`              | ≥ 20 readable fixtures (14 gate kinds + note + mortgage + variations).                                                                                                                                                                                                                                |
| `evals/scorers.ts`               | 4 pure scorers + `IDP_SCORERS`.                                                                                                                                                                                                                                                                       |
| `evals/scorers.test.ts`          | The offline compliance gate (required Unit tests job).                                                                                                                                                                                                                                                |
| `evals/collateral-idp.eval.ts`   | Braintrust `Eval()` wiring (skip-green unless `BRAINTRUST_API_KEY` set).                                                                                                                                                                                                                              |
| `evals/run.mjs`                  | Eval runner (`pnpm eval`); `REQUIRED_KEYS = ['BRAINTRUST_API_KEY']`.                                                                                                                                                                                                                                  |

### App — `apps/web/lib/agents/collateral-idp/`

| File                                   | Responsibility                                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `deps.ts`                              | Builds `IdpDeps` (DB / RLS / `FixtureIdpAdapter`); co-transactional `idp.documents_classified` inside `persistDocuments`. |
| `run-collateral-idp-action.ts`         | Live `'use server'` shell over `runCollateralIdp` (non-durable).                                                          |
| `idp.steps.ts`                         | The one `'use step'` `runCollateralIdpStep` — rebuilds deps, runs the whole core.                                         |
| `idp.workflow.ts`                      | `'use workflow'` `idpWorkflow` — **single-pass** (one step, no sleep loop).                                               |
| `idp.workflow.test.ts`                 | Mocked-step orchestration guard (the behavioral authority).                                                               |
| `run-collateral-idp-durable-action.ts` | Dormant `'use server'` action: `start()` + `run.returnValue`.                                                             |

### Touched (1 line each)

- `apps/web/package.json` — add `"@cema/agents-collateral-idp": "workspace:*"`.

`pnpm-workspace.yaml` already globs `packages/agents/*` — the new package is auto-discovered.

---

## PR-1: Package scaffold + types + drift guard + public surface

**Files:**

- Create: `packages/agents/collateral-idp/package.json`
- Create: `packages/agents/collateral-idp/tsconfig.json`
- Create: `packages/agents/collateral-idp/src/types.ts`
- Create: `packages/agents/collateral-idp/src/types.test.ts`
- Create: `packages/agents/collateral-idp/src/index.ts`
- Modify: `apps/web/package.json` (add workspace dep)

- [ ] **Step 1: Write the package manifest**

Create `packages/agents/collateral-idp/package.json`:

```json
{
  "name": "@cema/agents-collateral-idp",
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
    "@cema/observability": "workspace:*",
    "@opentelemetry/api": "^1.9.0"
  },
  "devDependencies": {
    "@cema/config": "workspace:*",
    "@cema/db": "workspace:*",
    "@opentelemetry/context-async-hooks": "^2.0.0",
    "@opentelemetry/sdk-trace-base": "^2.0.0",
    "@types/node": "^22.0.0",
    "braintrust": "^3.13.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Write the tsconfig**

Create `packages/agents/collateral-idp/tsconfig.json`:

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

- [ ] **Step 3: Install so the workspace resolves the new package**

Run: `cmd /c "pnpm install"`
Expected: lockfile updates; `@cema/agents-collateral-idp` linked. No errors.

- [ ] **Step 4: Write the types**

Create `packages/agents/collateral-idp/src/types.ts`:

```ts
// The full document_kind enum, re-declared locally so this package never
// imports @cema/db at runtime (the WDK '"use workflow"' sandbox VM cannot load
// it). A drift guard (types.test.ts) keeps this in lockstep with the DB enum.
export const DOCUMENT_KINDS = [
  'note',
  'mortgage',
  'aom',
  'allonge',
  'cema_3172',
  'exhibit_a',
  'exhibit_b',
  'exhibit_c',
  'exhibit_d',
  'consolidated_note',
  'gap_note',
  'gap_mortgage',
  'aff_255',
  'aff_275',
  'mt_15',
  'nyc_rpt',
  'tp_584',
  'acris_cover_pages',
  'county_cover_sheet',
  'payoff_letter',
  'authorization',
  'title_commitment',
  'title_policy',
  'endorsement_111',
  'other',
] as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

// The 14 kinds that legally require an attorney-review gate (hard rule #2 +
// the documents_attorney_gate_required DB check constraint). classify() sets
// attorneyReviewRequired=true for exactly these.
export const GATE_REQUIRED_KINDS = [
  'cema_3172',
  'exhibit_a',
  'exhibit_b',
  'exhibit_c',
  'exhibit_d',
  'gap_note',
  'gap_mortgage',
  'consolidated_note',
  'aom',
  'allonge',
  'aff_255',
  'aff_275',
  'mt_15',
  'county_cover_sheet',
] as const satisfies readonly DocumentKind[];

// A segment whose extraction confidence is below this floor is treated as
// unreadable and is NOT classified/persisted (it surfaces for human review).
export const UNREADABLE_CONFIDENCE_THRESHOLD = 0.5;

export interface RecordingRef {
  readonly reelPage: string | null;
  readonly crfn: string | null;
}

export interface InstrumentRecord {
  readonly documentId: string;
  readonly instrumentKind: DocumentKind;
  readonly assignor: string | null;
  readonly assignee: string | null;
  readonly executedAt: string | null;
  readonly recordedAt: string | null;
  readonly amount: number | null;
  readonly recordingRef: RecordingRef;
  readonly county: string | null;
  readonly references: string | null;
}

// What the (dormant) vendor IDP adapter returns per blob segment. Pure data:
// the raw OCR text, a flat field bag, and a 0..1 confidence.
export interface RawExtraction {
  readonly text: string | null;
  readonly fields: Readonly<Record<string, string | null>>;
  readonly confidence: number;
}

export interface CollateralDocumentRef {
  readonly documentId: string;
  readonly blobUrl: string;
}

export interface IdpContext {
  readonly dealId: string;
  readonly documents: readonly CollateralDocumentRef[];
}

export interface ClassifiedDoc {
  readonly documentId: string;
  readonly kind: DocumentKind;
  readonly attorneyReviewRequired: boolean;
  readonly instrument: InstrumentRecord;
}

export interface UnreadableSegment {
  readonly documentId: string;
  readonly blobUrl: string;
}

// Split-audit actions. emitAudit emits idp.evaluated (always, before any write);
// the app-wiring persistDocuments emits idp.documents_classified co-transactionally.
export interface IdpAuditEvent {
  readonly action: 'idp.evaluated' | 'idp.documents_classified';
  readonly dealId: string;
  readonly documentCount: number;
  readonly unreadableCount: number;
  readonly gateRequiredCount: number;
}

// The dormant vendor seam: one blob -> zero-or-more raw extractions.
export interface IdpAdapter {
  extractDocuments(blobUrl: string): Promise<readonly RawExtraction[]>;
}

// Every effect the core needs, injected. No clock (IDP is not time-based) and
// no LLM (classify/extract are pure deterministic functions).
export interface IdpDeps {
  readonly idp: IdpAdapter;
  loadContext(dealId: string): Promise<IdpContext>;
  persistDocuments(dealId: string, docs: readonly ClassifiedDoc[]): Promise<void>;
  emitAudit(event: IdpAuditEvent): Promise<void>;
}

export interface IdpResult {
  readonly dealId: string;
  readonly documents: readonly ClassifiedDoc[];
  readonly unreadable: readonly UnreadableSegment[];
}
```

- [ ] **Step 5: Write the failing drift-guard test**

Create `packages/agents/collateral-idp/src/types.test.ts`:

```ts
import { documentKindEnum } from '@cema/db';
import { describe, expect, it } from 'vitest';

import { DOCUMENT_KINDS, GATE_REQUIRED_KINDS } from './types';

describe('document-kind drift guard', () => {
  it('DOCUMENT_KINDS matches the DB document_kind enum exactly', () => {
    expect([...DOCUMENT_KINDS].sort()).toEqual([...documentKindEnum.enumValues].sort());
  });

  it('GATE_REQUIRED_KINDS matches the 14 attorney-gated kinds', () => {
    expect([...GATE_REQUIRED_KINDS].sort()).toEqual(
      [
        'aff_255',
        'aff_275',
        'allonge',
        'aom',
        'cema_3172',
        'consolidated_note',
        'county_cover_sheet',
        'exhibit_a',
        'exhibit_b',
        'exhibit_c',
        'exhibit_d',
        'gap_mortgage',
        'gap_note',
        'mt_15',
      ].sort(),
    );
  });
});
```

- [ ] **Step 6: Run the drift guard to verify it passes**

Run: `cmd /c "pnpm --filter @cema/agents-collateral-idp exec vitest run src/types.test.ts"`
Expected: PASS (2 tests). If `DOCUMENT_KINDS` drifts from the DB enum, test 1 fails with a sorted-array diff — that is the guard working.

- [ ] **Step 7: Write the public surface**

Create `packages/agents/collateral-idp/src/index.ts`:

```ts
export * from './types';
```

- [ ] **Step 8: Typecheck the package**

Run: `cmd /c "pnpm --filter @cema/agents-collateral-idp typecheck"`
Expected: PASS (no output).

- [ ] **Step 9: Wire the app workspace dependency**

In `apps/web/package.json`, add to `dependencies` (alphabetical, beside `@cema/agents-servicer-outreach`):

```json
    "@cema/agents-collateral-idp": "workspace:*",
```

- [ ] **Step 10: Re-install + commit**

```bash
cmd /c "pnpm install"
git add packages/agents/collateral-idp/package.json packages/agents/collateral-idp/tsconfig.json packages/agents/collateral-idp/src/types.ts packages/agents/collateral-idp/src/types.test.ts packages/agents/collateral-idp/src/index.ts apps/web/package.json pnpm-lock.yaml
git commit -S -m "feat(m13): collateral-idp package scaffold + types + drift guard"
```

---

## PR-2: FixtureIdpAdapter (dormant vendor seam)

**Files:**

- Create: `packages/agents/collateral-idp/src/adapter.ts`
- Test: `packages/agents/collateral-idp/src/adapter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/agents/collateral-idp/src/adapter.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { FixtureIdpAdapter } from './adapter';
import type { RawExtraction } from './types';

describe('FixtureIdpAdapter', () => {
  it('returns the canned extractions for a known blob', async () => {
    const canned: RawExtraction = {
      text: 'Assignment of Mortgage',
      fields: { documentType: 'Assignment of Mortgage' },
      confidence: 0.9,
    };
    const adapter = new FixtureIdpAdapter({ 'blob://aom': [canned] });

    const out = await adapter.extractDocuments('blob://aom');

    expect(out).toEqual([canned]);
  });

  it('returns a single zero-confidence empty extraction for an unknown blob', async () => {
    const adapter = new FixtureIdpAdapter();

    const out = await adapter.extractDocuments('blob://missing');

    expect(out).toEqual([{ text: null, fields: {}, confidence: 0 }]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cmd /c "pnpm --filter @cema/agents-collateral-idp exec vitest run src/adapter.test.ts"`
Expected: FAIL — `Cannot find module './adapter'`.

- [ ] **Step 3: Write the adapter**

Create `packages/agents/collateral-idp/src/adapter.ts`:

```ts
import type { IdpAdapter, RawExtraction } from './types';

// Dormant vendor seam. The real adapter (Reducto / Textract Lending, ADR
// carry-over #1) implements IdpAdapter over an OCR+extraction vendor. Until
// then this fixture returns canned extractions keyed by blobUrl, or a single
// zero-confidence empty segment for an unknown blob -- it NEVER fabricates a
// readable extraction, so an un-canned blob deterministically lands in the
// orchestrator's "unreadable" bucket rather than producing a phantom record.
export class FixtureIdpAdapter implements IdpAdapter {
  constructor(private readonly canned: Readonly<Record<string, readonly RawExtraction[]>> = {}) {}

  extractDocuments(blobUrl: string): Promise<readonly RawExtraction[]> {
    const hit = this.canned[blobUrl];
    if (hit) return Promise.resolve(hit);
    return Promise.resolve([{ text: null, fields: {}, confidence: 0 }]);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cmd /c "pnpm --filter @cema/agents-collateral-idp exec vitest run src/adapter.test.ts"`
Expected: PASS (2 tests).

- [ ] **Step 5: Export the adapter**

In `packages/agents/collateral-idp/src/index.ts`, append:

```ts
export * from './adapter';
```

- [ ] **Step 6: Typecheck + commit**

```bash
cmd /c "pnpm --filter @cema/agents-collateral-idp typecheck"
git add packages/agents/collateral-idp/src/adapter.ts packages/agents/collateral-idp/src/adapter.test.ts packages/agents/collateral-idp/src/index.ts
git commit -S -m "feat(m13): FixtureIdpAdapter (dormant vendor IDP seam)"
```

---

## PR-3: Pure classify + extract

**Files:**

- Create: `packages/agents/collateral-idp/src/classify.ts`
- Test: `packages/agents/collateral-idp/src/classify.test.ts`
- Create: `packages/agents/collateral-idp/src/extract.ts`
- Test: `packages/agents/collateral-idp/src/extract.test.ts`

- [ ] **Step 1: Write the failing classify test**

Create `packages/agents/collateral-idp/src/classify.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { classify, requiresAttorneyReview } from './classify';
import type { RawExtraction } from './types';

function raw(documentType: string): RawExtraction {
  return { text: null, fields: { documentType }, confidence: 0.9 };
}

describe('requiresAttorneyReview', () => {
  it('is true for a gate-required kind', () => {
    expect(requiresAttorneyReview('aom')).toBe(true);
  });

  it('is false for a non-gate kind', () => {
    expect(requiresAttorneyReview('note')).toBe(false);
  });
});

describe('classify', () => {
  it('maps "Assignment of Mortgage" to aom (gated)', () => {
    const out = classify(raw('Assignment of Mortgage'));
    expect(out.kind).toBe('aom');
    expect(out.attorneyReviewRequired).toBe(true);
  });

  it('maps "Consolidation, Extension and Modification Agreement" to cema_3172 before plain "agreement"', () => {
    const out = classify(raw('Consolidation, Extension and Modification Agreement'));
    expect(out.kind).toBe('cema_3172');
    expect(out.attorneyReviewRequired).toBe(true);
  });

  it('maps "Allonge to Note" to allonge, not note (specific wins)', () => {
    const out = classify(raw('Allonge to Note'));
    expect(out.kind).toBe('allonge');
  });

  it('maps "Section 255 Affidavit" to aff_255', () => {
    const out = classify(raw('Section 255 Affidavit')).kind;
    expect(out).toBe('aff_255');
  });

  it('maps a plain mortgage to mortgage (non-gated)', () => {
    const out = classify(raw('Mortgage'));
    expect(out.kind).toBe('mortgage');
    expect(out.attorneyReviewRequired).toBe(false);
  });

  it('falls back to other when no signal matches', () => {
    const out = classify(raw('Quarterly Escrow Statement'));
    expect(out.kind).toBe('other');
    expect(out.attorneyReviewRequired).toBe(false);
  });

  it('reads the raw text when no documentType field is present', () => {
    const out = classify({ text: 'PROMISSORY NOTE', fields: {}, confidence: 0.8 });
    expect(out.kind).toBe('note');
  });

  it('passes the raw confidence through', () => {
    expect(classify(raw('Mortgage')).confidence).toBe(0.9);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cmd /c "pnpm --filter @cema/agents-collateral-idp exec vitest run src/classify.test.ts"`
Expected: FAIL — `Cannot find module './classify'`.

- [ ] **Step 3: Write classify**

Create `packages/agents/collateral-idp/src/classify.ts`:

```ts
import type { DocumentKind, RawExtraction } from './types';
import { GATE_REQUIRED_KINDS } from './types';

const GATE_SET: ReadonlySet<DocumentKind> = new Set(GATE_REQUIRED_KINDS);

export function requiresAttorneyReview(kind: DocumentKind): boolean {
  return GATE_SET.has(kind);
}

// Ordered most-specific -> most-general. The FIRST signal whose lowercased
// text is a substring of the document's type/text wins, so multi-word
// instrument names (e.g. "allonge to note", "consolidation ... agreement")
// resolve before the bare nouns they contain ("note", "agreement").
//
// LEARNING-MODE CONTRIBUTION POINT: this synonym table is the highest-judgment
// piece of IDP -- it encodes how real collateral-file cover sheets name each
// instrument. Connor may extend/reorder it; ordering is load-bearing.
const KIND_BY_SIGNAL: ReadonlyArray<readonly [string, DocumentKind]> = [
  ['consolidation, extension', 'cema_3172'],
  ['consolidation and extension', 'cema_3172'],
  ['cema', 'cema_3172'],
  ['consolidated note', 'consolidated_note'],
  ['gap note', 'gap_note'],
  ['gap mortgage', 'gap_mortgage'],
  ['assignment of mortgage', 'aom'],
  ['assignment', 'aom'],
  ['allonge', 'allonge'],
  ['section 255', 'aff_255'],
  ['255 affidavit', 'aff_255'],
  ['section 275', 'aff_275'],
  ['275 affidavit', 'aff_275'],
  ['mt-15', 'mt_15'],
  ['mortgage recording tax return', 'mt_15'],
  ['county cover sheet', 'county_cover_sheet'],
  ['acris cover', 'acris_cover_pages'],
  ['tp-584', 'tp_584'],
  ['rpt', 'nyc_rpt'],
  ['payoff', 'payoff_letter'],
  ['authorization', 'authorization'],
  ['title commitment', 'title_commitment'],
  ['title policy', 'title_policy'],
  ['endorsement', 'endorsement_111'],
  ['exhibit a', 'exhibit_a'],
  ['exhibit b', 'exhibit_b'],
  ['exhibit c', 'exhibit_c'],
  ['exhibit d', 'exhibit_d'],
  ['mortgage', 'mortgage'],
  ['promissory note', 'note'],
  ['note', 'note'],
];

export function classify(raw: RawExtraction): {
  kind: DocumentKind;
  attorneyReviewRequired: boolean;
  confidence: number;
} {
  const haystack = (raw.fields.documentType ?? raw.text ?? '').toLowerCase();

  let kind: DocumentKind = 'other';
  for (const [signal, candidate] of KIND_BY_SIGNAL) {
    if (haystack.includes(signal)) {
      kind = candidate;
      break;
    }
  }

  return {
    kind,
    attorneyReviewRequired: requiresAttorneyReview(kind),
    confidence: raw.confidence,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cmd /c "pnpm --filter @cema/agents-collateral-idp exec vitest run src/classify.test.ts"`
Expected: PASS (10 tests).

- [ ] **Step 5: Write the failing extract test**

Create `packages/agents/collateral-idp/src/extract.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { extract } from './extract';
import type { RawExtraction } from './types';

const classification = { kind: 'aom' as const, attorneyReviewRequired: true, confidence: 0.9 };

describe('extract', () => {
  it('maps fields into an InstrumentRecord and stamps the documentId + kind', () => {
    const raw: RawExtraction = {
      text: null,
      fields: {
        assignor: 'Old Servicer LLC',
        assignee: 'New Bank NA',
        executedAt: '2025-03-04',
        recordedAt: '2025-03-10',
        amount: '$420,000.00',
        crfn: '2025000123456',
        county: 'Kings',
        references: 'CRFN 2019000987654',
      },
      confidence: 0.9,
    };

    const rec = extract('doc-1', raw, classification);

    expect(rec.documentId).toBe('doc-1');
    expect(rec.instrumentKind).toBe('aom');
    expect(rec.assignor).toBe('Old Servicer LLC');
    expect(rec.assignee).toBe('New Bank NA');
    expect(rec.executedAt).toBe('2025-03-04');
    expect(rec.recordedAt).toBe('2025-03-10');
    expect(rec.amount).toBe(420000);
    expect(rec.recordingRef).toEqual({ reelPage: null, crfn: '2025000123456' });
    expect(rec.county).toBe('Kings');
    expect(rec.references).toBe('CRFN 2019000987654');
  });

  it('nulls every field absent from the extraction', () => {
    const rec = extract('doc-2', { text: null, fields: {}, confidence: 0.6 }, classification);
    expect(rec).toEqual({
      documentId: 'doc-2',
      instrumentKind: 'aom',
      assignor: null,
      assignee: null,
      executedAt: null,
      recordedAt: null,
      amount: null,
      recordingRef: { reelPage: null, crfn: null },
      county: null,
      references: null,
    });
  });

  it('prefers crfn over reelPage (recording XOR)', () => {
    const rec = extract(
      'doc-3',
      { text: null, fields: { crfn: 'C1', reelPage: 'R1' }, confidence: 0.9 },
      classification,
    );
    expect(rec.recordingRef).toEqual({ reelPage: null, crfn: 'C1' });
  });

  it('keeps reelPage when no crfn is present', () => {
    const rec = extract(
      'doc-4',
      { text: null, fields: { reelPage: 'R1' }, confidence: 0.9 },
      classification,
    );
    expect(rec.recordingRef).toEqual({ reelPage: 'R1', crfn: null });
  });

  it('nulls an unparseable date and an unparseable amount', () => {
    const rec = extract(
      'doc-5',
      { text: null, fields: { executedAt: 'not-a-date', amount: 'N/A' }, confidence: 0.9 },
      classification,
    );
    expect(rec.executedAt).toBeNull();
    expect(rec.amount).toBeNull();
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `cmd /c "pnpm --filter @cema/agents-collateral-idp exec vitest run src/extract.test.ts"`
Expected: FAIL — `Cannot find module './extract'`.

- [ ] **Step 7: Write extract**

Create `packages/agents/collateral-idp/src/extract.ts`:

```ts
import type { DocumentKind, InstrumentRecord, RawExtraction, RecordingRef } from './types';

function toIsoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

function toAmount(value: string | null | undefined): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[$,\s]/g, '');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// CRFN (NYC ACRIS) and reel/page (upstate) are mutually exclusive recording
// identifiers; the DB enforces this via documents_recording_xor. CRFN wins.
function toRecordingRef(fields: Readonly<Record<string, string | null>>): RecordingRef {
  const crfn = fields.crfn ?? null;
  const reelPage = crfn ? null : (fields.reelPage ?? null);
  return { reelPage, crfn };
}

export function extract(
  documentId: string,
  raw: RawExtraction,
  classification: { kind: DocumentKind },
): InstrumentRecord {
  const f = raw.fields;
  return {
    documentId,
    instrumentKind: classification.kind,
    assignor: f.assignor ?? null,
    assignee: f.assignee ?? null,
    executedAt: toIsoDate(f.executedAt),
    recordedAt: toIsoDate(f.recordedAt),
    amount: toAmount(f.amount),
    recordingRef: toRecordingRef(f),
    county: f.county ?? null,
    references: f.references ?? null,
  };
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `cmd /c "pnpm --filter @cema/agents-collateral-idp exec vitest run src/extract.test.ts"`
Expected: PASS (5 tests).

- [ ] **Step 9: Export classify + extract**

In `packages/agents/collateral-idp/src/index.ts`, append:

```ts
export { classify, requiresAttorneyReview } from './classify';
export { extract } from './extract';
```

- [ ] **Step 10: Typecheck + commit**

```bash
cmd /c "pnpm --filter @cema/agents-collateral-idp typecheck"
git add packages/agents/collateral-idp/src/classify.ts packages/agents/collateral-idp/src/classify.test.ts packages/agents/collateral-idp/src/extract.ts packages/agents/collateral-idp/src/extract.test.ts packages/agents/collateral-idp/src/index.ts
git commit -S -m "feat(m13): pure classify (signal table) + extract (field coercion)"
```

---

## PR-4: Orchestrator core + trace guard + app wiring

**Files:**

- Create: `packages/agents/collateral-idp/src/orchestrator.ts`
- Test: `packages/agents/collateral-idp/src/orchestrator.test.ts`
- Test: `packages/agents/collateral-idp/src/orchestrator.trace.test.ts`
- Create: `apps/web/lib/agents/collateral-idp/deps.ts`
- Create: `apps/web/lib/agents/collateral-idp/run-collateral-idp-action.ts`

- [ ] **Step 1: Write the failing orchestrator test**

Create `packages/agents/collateral-idp/src/orchestrator.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

import { runCollateralIdp } from './orchestrator';
import type { IdpAdapter, IdpAuditEvent, IdpContext, ClassifiedDoc, RawExtraction } from './types';

function makeDeps(overrides: {
  context: IdpContext;
  extractions: Readonly<Record<string, readonly RawExtraction[]>>;
}) {
  const events: string[] = [];
  const persisted: ClassifiedDoc[][] = [];
  const idp: IdpAdapter = {
    extractDocuments: (blobUrl) =>
      Promise.resolve(
        overrides.extractions[blobUrl] ?? [{ text: null, fields: {}, confidence: 0 }],
      ),
  };
  const deps = {
    idp,
    loadContext: vi.fn(() => Promise.resolve(overrides.context)),
    persistDocuments: vi.fn((_dealId: string, docs: readonly ClassifiedDoc[]) => {
      persisted.push([...docs]);
      events.push('idp.documents_classified');
      return Promise.resolve();
    }),
    emitAudit: vi.fn((e: IdpAuditEvent) => {
      events.push(e.action);
      return Promise.resolve();
    }),
  };
  return { deps, events, persisted };
}

describe('runCollateralIdp', () => {
  it('classifies + persists readable docs and emits the split audit in order', async () => {
    const { deps, events, persisted } = makeDeps({
      context: { dealId: 'deal-1', documents: [{ documentId: 'doc-1', blobUrl: 'blob://aom' }] },
      extractions: {
        'blob://aom': [
          { text: null, fields: { documentType: 'Assignment of Mortgage' }, confidence: 0.9 },
        ],
      },
    });

    const result = await runCollateralIdp('deal-1', deps);

    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]?.kind).toBe('aom');
    expect(result.documents[0]?.attorneyReviewRequired).toBe(true);
    expect(result.unreadable).toHaveLength(0);
    expect(persisted[0]).toHaveLength(1);
    expect(events).toEqual(['idp.evaluated', 'idp.documents_classified']);
  });

  it('routes a low-confidence segment to unreadable and never persists it', async () => {
    const { deps, events, persisted } = makeDeps({
      context: { dealId: 'deal-1', documents: [{ documentId: 'doc-1', blobUrl: 'blob://blurry' }] },
      extractions: {
        'blob://blurry': [{ text: 'Mortgage', fields: {}, confidence: 0.2 }],
      },
    });

    const result = await runCollateralIdp('deal-1', deps);

    expect(result.documents).toHaveLength(0);
    expect(result.unreadable).toEqual([{ documentId: 'doc-1', blobUrl: 'blob://blurry' }]);
    expect(persisted).toHaveLength(0);
    expect(events).toEqual(['idp.evaluated']);
  });

  it('routes a null-text segment to unreadable', async () => {
    const { deps, persisted } = makeDeps({
      context: {
        dealId: 'deal-1',
        documents: [{ documentId: 'doc-1', blobUrl: 'blob://missing' }],
      },
      extractions: { 'blob://missing': [{ text: null, fields: {}, confidence: 0 }] },
    });

    const result = await runCollateralIdp('deal-1', deps);

    expect(result.unreadable).toHaveLength(1);
    expect(persisted).toHaveLength(0);
  });

  it('sets attorneyReviewRequired=false for a non-gated kind', async () => {
    const { deps } = makeDeps({
      context: { dealId: 'deal-1', documents: [{ documentId: 'doc-1', blobUrl: 'blob://note' }] },
      extractions: {
        'blob://note': [
          { text: null, fields: { documentType: 'Promissory Note' }, confidence: 0.9 },
        ],
      },
    });

    const result = await runCollateralIdp('deal-1', deps);

    expect(result.documents[0]?.kind).toBe('note');
    expect(result.documents[0]?.attorneyReviewRequired).toBe(false);
  });

  it('emits idp.evaluated with accurate counts', async () => {
    const { deps } = makeDeps({
      context: {
        dealId: 'deal-1',
        documents: [
          { documentId: 'doc-1', blobUrl: 'blob://aom' },
          { documentId: 'doc-2', blobUrl: 'blob://blurry' },
        ],
      },
      extractions: {
        'blob://aom': [
          { text: null, fields: { documentType: 'Assignment of Mortgage' }, confidence: 0.9 },
        ],
        'blob://blurry': [{ text: 'x', fields: {}, confidence: 0.1 }],
      },
    });

    await runCollateralIdp('deal-1', deps);

    expect(deps.emitAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'idp.evaluated',
        documentCount: 1,
        unreadableCount: 1,
        gateRequiredCount: 1,
      }),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cmd /c "pnpm --filter @cema/agents-collateral-idp exec vitest run src/orchestrator.test.ts"`
Expected: FAIL — `Cannot find module './orchestrator'`.

- [ ] **Step 3: Write the orchestrator**

Create `packages/agents/collateral-idp/src/orchestrator.ts`:

```ts
import { withChildSpan } from '@cema/observability';
import { SpanStatusCode, trace } from '@opentelemetry/api';

import { classify } from './classify';
import { extract } from './extract';
import type { ClassifiedDoc, IdpDeps, IdpResult, UnreadableSegment } from './types';
import { UNREADABLE_CONFIDENCE_THRESHOLD } from './types';

const tracer = trace.getTracer('@cema/agents-collateral-idp');

/**
 * Orchestration-agnostic Collateral IDP core. Loads the deal's collateral
 * documents, runs each blob through the (dormant) vendor adapter, and
 * deterministically classifies + extracts every readable segment into an
 * InstrumentRecord -- enriching the source documents row 1:1 in place. A
 * segment with null text or sub-threshold confidence is routed to the
 * unreadable bucket (surfaced for human review) and never persisted.
 *
 * Split audit: idp.evaluated is emitted on EVERY run before any write;
 * idp.documents_classified is written co-transactionally with the enrich
 * inside deps.persistDocuments (app wiring), so it only fires when there is
 * something to persist.
 */
export async function runCollateralIdp(dealId: string, deps: IdpDeps): Promise<IdpResult> {
  return tracer.startActiveSpan('idp.run', async (span) => {
    span.setAttribute('idp.deal_id', dealId);
    try {
      const context = await withChildSpan(tracer, 'idp.load_context', () =>
        deps.loadContext(dealId),
      );

      const classified: ClassifiedDoc[] = [];
      const unreadable: UnreadableSegment[] = [];

      await withChildSpan(tracer, 'idp.extract_documents', async () => {
        for (const ref of context.documents) {
          const segments = await deps.idp.extractDocuments(ref.blobUrl);
          const raw = segments[0];
          if (!raw || raw.text === null || raw.confidence < UNREADABLE_CONFIDENCE_THRESHOLD) {
            unreadable.push({ documentId: ref.documentId, blobUrl: ref.blobUrl });
            continue;
          }
          const classification = classify(raw);
          classified.push({
            documentId: ref.documentId,
            kind: classification.kind,
            attorneyReviewRequired: classification.attorneyReviewRequired,
            instrument: extract(ref.documentId, raw, classification),
          });
        }
      });

      const gateRequiredCount = classified.filter((d) => d.attorneyReviewRequired).length;
      span.setAttribute('idp.document_count', classified.length);
      span.setAttribute('idp.unreadable_count', unreadable.length);
      span.setAttribute('idp.gate_required_count', gateRequiredCount);

      await withChildSpan(tracer, 'idp.emit_evaluated', () =>
        deps.emitAudit({
          action: 'idp.evaluated',
          dealId,
          documentCount: classified.length,
          unreadableCount: unreadable.length,
          gateRequiredCount,
        }),
      );

      if (classified.length > 0) {
        await withChildSpan(tracer, 'idp.persist_documents', () =>
          deps.persistDocuments(dealId, classified),
        );
      }

      span.setStatus({ code: SpanStatusCode.OK });
      return { dealId, documents: classified, unreadable };
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

- [ ] **Step 4: Run the test to verify it passes**

Run: `cmd /c "pnpm --filter @cema/agents-collateral-idp exec vitest run src/orchestrator.test.ts"`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the failing trace guard**

Create `packages/agents/collateral-idp/src/orchestrator.trace.test.ts`:

```ts
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import { context, trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runCollateralIdp } from './orchestrator';
import type { IdpAdapter, IdpContext } from './types';

const ALLOWED_ATTR_KEYS = new Set([
  'idp.deal_id',
  'idp.document_count',
  'idp.unreadable_count',
  'idp.gate_required_count',
]);

const ORCHESTRATOR_SPANS = new Set([
  'idp.run',
  'idp.load_context',
  'idp.extract_documents',
  'idp.emit_evaluated',
  'idp.persist_documents',
]);

// PII that must never appear in any span attribute value.
const PII_ASSIGNOR = 'Old Servicer LLC';
const PII_ASSIGNEE = 'New Bank NA';

describe('runCollateralIdp tracing', () => {
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
    const idp: IdpAdapter = {
      extractDocuments: () =>
        Promise.resolve([
          {
            text: null,
            fields: {
              documentType: 'Assignment of Mortgage',
              assignor: PII_ASSIGNOR,
              assignee: PII_ASSIGNEE,
            },
            confidence: 0.9,
          },
        ]),
    };
    const ctx: IdpContext = {
      dealId: 'deal-1',
      documents: [{ documentId: 'doc-1', blobUrl: 'blob://aom' }],
    };
    const deps = {
      idp,
      loadContext: () => Promise.resolve(ctx),
      persistDocuments: () => Promise.resolve(),
      emitAudit: () => Promise.resolve(),
    };

    await runCollateralIdp('deal-1', deps);

    const spans = exporter.getFinishedSpans();
    expect(spans.length).toBeGreaterThan(0);

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

- [ ] **Step 6: Run the trace guard to verify it passes**

Run: `cmd /c "pnpm --filter @cema/agents-collateral-idp exec vitest run src/orchestrator.trace.test.ts"`
Expected: PASS (1 test).

- [ ] **Step 7: Export the orchestrator**

In `packages/agents/collateral-idp/src/index.ts`, append:

```ts
export { runCollateralIdp } from './orchestrator';
```

- [ ] **Step 8: Commit the package core**

```bash
cmd /c "pnpm --filter @cema/agents-collateral-idp typecheck"
git add packages/agents/collateral-idp/src/orchestrator.ts packages/agents/collateral-idp/src/orchestrator.test.ts packages/agents/collateral-idp/src/orchestrator.trace.test.ts packages/agents/collateral-idp/src/index.ts
git commit -S -m "feat(m13): runCollateralIdp core + PII-safe trace guard"
```

- [ ] **Step 9: Write the app deps builder**

Create `apps/web/lib/agents/collateral-idp/deps.ts`:

```ts
import type {
  ClassifiedDoc,
  IdpAdapter,
  IdpAuditEvent,
  IdpContext,
  IdpDeps,
} from '@cema/agents-collateral-idp';
import { emitAuditEvent } from '@cema/compliance';
import { documents } from '@cema/db';
import { and, eq, isNotNull } from 'drizzle-orm';

import { withRls } from '../../with-rls';

interface BuildIdpDepsArgs {
  readonly organizationId: string;
  readonly actorUserId: string;
  readonly idp: IdpAdapter;
}

/**
 * Builds IdpDeps for the app. Every effect runs inside withRls so the deal's
 * documents are tenant-scoped (the documents table has no organizationId
 * column -- tenancy flows through deal_id -> deals). persistDocuments enriches
 * each collateral row 1:1 in place and writes the co-transactional
 * idp.documents_classified audit in the SAME transaction (mirroring M12
 * recordTouch), so the classify + the audit cannot diverge.
 */
export function buildIdpDeps({ organizationId, actorUserId, idp }: BuildIdpDepsArgs): IdpDeps {
  return {
    idp,

    loadContext(dealId: string): Promise<IdpContext> {
      return withRls(organizationId, async (tx) => {
        const rows = await tx
          .select({ documentId: documents.id, blobUrl: documents.blobUrl })
          .from(documents)
          .where(and(eq(documents.dealId, dealId), isNotNull(documents.blobUrl)));
        return {
          dealId,
          documents: rows
            .filter((r): r is { documentId: string; blobUrl: string } => r.blobUrl !== null)
            .map((r) => ({ documentId: r.documentId, blobUrl: r.blobUrl })),
        };
      });
    },

    persistDocuments(dealId: string, docs: readonly ClassifiedDoc[]): Promise<void> {
      return withRls(organizationId, async (tx) => {
        for (const doc of docs) {
          await tx
            .update(documents)
            .set({
              kind: doc.kind,
              attorneyReviewRequired: doc.attorneyReviewRequired,
              extractedData: doc.instrument as unknown as Record<string, unknown>,
            })
            .where(eq(documents.id, doc.documentId));
        }
        const gateRequiredCount = docs.filter((d) => d.attorneyReviewRequired).length;
        await emitAuditEvent(tx, {
          organizationId,
          actorUserId,
          action: 'idp.documents_classified',
          entityType: 'deal',
          entityId: dealId,
          metadata: {
            source: 'collateral-idp',
            documentCount: docs.length,
            gateRequiredCount,
          },
        });
      });
    },

    emitAudit(event: IdpAuditEvent): Promise<void> {
      return withRls(organizationId, (tx) =>
        emitAuditEvent(tx, {
          organizationId,
          actorUserId,
          action: event.action,
          entityType: 'deal',
          entityId: event.dealId,
          metadata: {
            source: 'collateral-idp',
            documentCount: event.documentCount,
            unreadableCount: event.unreadableCount,
            gateRequiredCount: event.gateRequiredCount,
          },
        }).then(() => undefined),
      );
    },
  };
}
```

- [ ] **Step 10: Write the live Server Action**

Create `apps/web/lib/agents/collateral-idp/run-collateral-idp-action.ts`:

```ts
'use server';

import type { IdpResult } from '@cema/agents-collateral-idp';
import { FixtureIdpAdapter, runCollateralIdp } from '@cema/agents-collateral-idp';
import { getCurrentOrganizationId, getCurrentUser } from '@cema/auth';
import { redactPii } from '@cema/compliance';
import { getDb, organizations, users } from '@cema/db';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { buildIdpDeps } from './deps';

const tracer = trace.getTracer('@cema/web');

/**
 * Live (non-durable) Collateral IDP entry point. Resolves the Clerk org/user,
 * builds IdpDeps with the FixtureIdpAdapter (real vendor adapter is ADR
 * carry-over #1), runs the pure core, and revalidates the deal's documents
 * page when anything was enriched.
 */
export async function runCollateralIdpFromDeal(dealId: string): Promise<IdpResult> {
  return tracer.startActiveSpan('idp.run_from_deal', async (span) => {
    span.setAttribute('idp.deal_id', dealId);
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

      const deps = buildIdpDeps({
        organizationId: org.id,
        actorUserId: user.id,
        idp: new FixtureIdpAdapter(),
      });
      const result = await runCollateralIdp(dealId, deps);

      if (result.documents.length > 0) {
        revalidatePath(`/deals/${dealId}/documents`);
      }

      span.setAttribute('idp.document_count', result.documents.length);
      span.setAttribute('idp.unreadable_count', result.unreadable.length);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: redactPii((err as Error).message) });
      throw err;
    } finally {
      span.end();
    }
  });
}
```

- [ ] **Step 11: Typecheck the app + commit the wiring**

Run: `cmd /c "pnpm --filter web typecheck"`
Expected: PASS (no output).

```bash
git add apps/web/lib/agents/collateral-idp/deps.ts apps/web/lib/agents/collateral-idp/run-collateral-idp-action.ts
git commit -S -m "feat(m13): collateral-idp app wiring (deps + live Server Action)"
```

---

## PR-5: Dormant single-pass WDK durable wrap

IDP is **single-pass** (load → extract → persist, no cadence), so unlike M12's
sleep loop the durable wrap is **one `'use step'` called once** — no `sleep`, no
`MAX_ITERATIONS`. Durability here protects against _failure_ (a flaky vendor
call or a mid-run crash), not the passage of time.

**Files:**

- Create: `apps/web/lib/agents/collateral-idp/idp.steps.ts`
- Create: `apps/web/lib/agents/collateral-idp/idp.workflow.ts`
- Test: `apps/web/lib/agents/collateral-idp/idp.workflow.test.ts`
- Create: `apps/web/lib/agents/collateral-idp/run-collateral-idp-durable-action.ts`

- [ ] **Step 1: Write the durable step**

Create `apps/web/lib/agents/collateral-idp/idp.steps.ts`:

```ts
import type { IdpResult } from '@cema/agents-collateral-idp';
import { FixtureIdpAdapter, runCollateralIdp } from '@cema/agents-collateral-idp';

import { buildIdpDeps } from './deps';

/**
 * The one durable step: rebuilds deps internally (the durable boundary is not
 * serializable -- WDK's codec does not carry functions or class instances) and
 * runs the whole IDP core. A rejected effect throws, which WDK treats as a
 * retryable step failure.
 */
export async function runCollateralIdpStep(
  dealId: string,
  organizationId: string,
  actorUserId: string,
): Promise<IdpResult> {
  'use step';

  const deps = buildIdpDeps({ organizationId, actorUserId, idp: new FixtureIdpAdapter() });
  const result = await runCollateralIdp(dealId, deps);

  // PII-safe: ids + counts only (never party names, amounts, or addresses).
  console.log(
    `idp.step deal=${dealId} documents=${result.documents.length} unreadable=${result.unreadable.length}`,
  );

  return result;
}
```

- [ ] **Step 2: Write the durable workflow**

Create `apps/web/lib/agents/collateral-idp/idp.workflow.ts`:

```ts
import type { IdpResult } from '@cema/agents-collateral-idp';

import { runCollateralIdpStep } from './idp.steps';

/**
 * Durable collateral-IDP workflow. Single-pass: IDP has no cadence, so the
 * whole core runs as ONE step with no sleep loop. The durable boundary buys
 * crash-safety + step-level retry of the (future) vendor extraction call, not
 * time-based resumption. Takes three serializable strings (the durable
 * boundary cannot carry deps).
 */
export async function idpWorkflow(
  dealId: string,
  organizationId: string,
  actorUserId: string,
): Promise<IdpResult> {
  'use workflow';

  return runCollateralIdpStep(dealId, organizationId, actorUserId);
}
```

- [ ] **Step 3: Write the failing mocked-step test**

Create `apps/web/lib/agents/collateral-idp/idp.workflow.test.ts`:

```ts
import type { IdpResult } from '@cema/agents-collateral-idp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { idpWorkflow } from './idp.workflow';
import { runCollateralIdpStep } from './idp.steps';

vi.mock('./idp.steps', () => ({ runCollateralIdpStep: vi.fn() }));

const mockedStep = vi.mocked(runCollateralIdpStep);

describe('idpWorkflow', () => {
  beforeEach(() => {
    mockedStep.mockReset();
  });

  it('runs the step exactly once and passes the result through', async () => {
    const result: IdpResult = { dealId: 'deal-1', documents: [], unreadable: [] };
    mockedStep.mockResolvedValue(result);

    const out = await idpWorkflow('deal-1', 'org-1', 'user-1');

    expect(mockedStep).toHaveBeenCalledTimes(1);
    expect(mockedStep).toHaveBeenCalledWith('deal-1', 'org-1', 'user-1');
    expect(out).toBe(result);
  });

  it('propagates a step failure (the durable retry boundary)', async () => {
    mockedStep.mockRejectedValue(new Error('vendor extraction failed'));

    await expect(idpWorkflow('deal-1', 'org-1', 'user-1')).rejects.toThrow(
      'vendor extraction failed',
    );
  });
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cmd /c "pnpm --filter web exec vitest run lib/agents/collateral-idp/idp.workflow.test.ts"`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the dormant durable action**

Create `apps/web/lib/agents/collateral-idp/run-collateral-idp-durable-action.ts`:

```ts
'use server';

import type { IdpResult } from '@cema/agents-collateral-idp';
import { getCurrentOrganizationId, getCurrentUser } from '@cema/auth';
import { getDb, organizations, users } from '@cema/db';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { eq } from 'drizzle-orm';
import { start } from 'workflow/api';

import { idpWorkflow } from './idp.workflow';

const tracer = trace.getTracer('@cema/web');

/**
 * Durable variant of runCollateralIdpFromDeal: starts idpWorkflow and awaits
 * run.returnValue to preserve the synchronous Promise<IdpResult> contract.
 *
 * DORMANT: nothing wires this in M13. Activation prerequisites (Connor-owned):
 * provision a WDK backend + VERCEL_OIDC_TOKEN, exclude /.well-known/workflow/*
 * from the proxy.ts matcher (ADR 0013 Decision 4), then flip a trigger to
 * route collateral-file-ready deals through here behind a flag. (Single-pass,
 * so unlike M12 there is no in-request-vs-fire-and-forget contract concern.)
 */
export async function runCollateralIdpFromDealDurable(dealId: string): Promise<IdpResult> {
  return tracer.startActiveSpan('idp.run_from_deal_durable', async (span) => {
    span.setAttribute('idp.deal_id', dealId);
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

      const run = await start(idpWorkflow, [dealId, org.id, user.id]);
      const result = await run.returnValue;

      span.setAttribute('idp.document_count', result.documents.length);
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

- [ ] **Step 6: Typecheck the app + commit**

Run: `cmd /c "pnpm --filter web typecheck"`
Expected: PASS (no output).

```bash
git add apps/web/lib/agents/collateral-idp/idp.steps.ts apps/web/lib/agents/collateral-idp/idp.workflow.ts apps/web/lib/agents/collateral-idp/idp.workflow.test.ts apps/web/lib/agents/collateral-idp/run-collateral-idp-durable-action.ts
git commit -S -m "feat(m13): dormant single-pass WDK durable wrap (idpWorkflow)"
```

---

## PR-6: Braintrust eval — offline scorers are the real gate

IDP has **no LLM call**, so the eval grades the deterministic classify+extract
pipeline. The offline `scorers.test.ts` is the real compliance gate (required
`Unit tests` job); the live Braintrust run is skip-green unless
`BRAINTRUST_API_KEY` is set (note: `REQUIRED_KEYS` is **`BRAINTRUST_API_KEY`
only** — no `AI_GATEWAY_API_KEY`, since IDP makes no model call).

**Files:**

- Create: `packages/agents/collateral-idp/evals/fixtures.ts`
- Create: `packages/agents/collateral-idp/evals/scorers.ts`
- Test: `packages/agents/collateral-idp/evals/scorers.test.ts`
- Create: `packages/agents/collateral-idp/evals/collateral-idp.eval.ts`
- Create: `packages/agents/collateral-idp/evals/run.mjs`

- [ ] **Step 1: Write the fixtures**

Create `packages/agents/collateral-idp/evals/fixtures.ts`:

```ts
import type { DocumentKind, RawExtraction } from '../src/types';

export interface IdpFixture {
  readonly name: string;
  readonly input: RawExtraction;
  readonly expected: {
    readonly kind: DocumentKind;
    readonly attorneyReviewRequired: boolean;
    readonly nonNullFields: readonly string[];
  };
}

function fx(
  name: string,
  documentType: string,
  fields: Readonly<Record<string, string>>,
  expected: IdpFixture['expected'],
): IdpFixture {
  return {
    name,
    input: { text: null, fields: { documentType, ...fields }, confidence: 0.9 },
    expected,
  };
}

// >= 20 readable fixtures: every one of the 14 gate kinds + note + mortgage +
// representative non-gated kinds + field-coercion variations. Party names are
// synthetic.
export const IDP_FIXTURES: readonly IdpFixture[] = [
  fx(
    'assignment of mortgage',
    'Assignment of Mortgage',
    { assignor: 'Alpha Servicing LLC', assignee: 'Beta Bank NA', crfn: '2025000111111' },
    { kind: 'aom', attorneyReviewRequired: true, nonNullFields: ['assignor', 'assignee'] },
  ),
  fx(
    'allonge to note',
    'Allonge to Note',
    { references: 'Note dated 2019-01-01' },
    { kind: 'allonge', attorneyReviewRequired: true, nonNullFields: ['references'] },
  ),
  fx(
    'cema 3172',
    'Consolidation, Extension and Modification Agreement',
    { amount: '$500,000.00', county: 'Queens' },
    { kind: 'cema_3172', attorneyReviewRequired: true, nonNullFields: ['amount', 'county'] },
  ),
  fx(
    'consolidated note',
    'Consolidated Note',
    { amount: '$500,000.00' },
    { kind: 'consolidated_note', attorneyReviewRequired: true, nonNullFields: ['amount'] },
  ),
  fx(
    'gap note',
    'Gap Note',
    { amount: '$80,000.00' },
    { kind: 'gap_note', attorneyReviewRequired: true, nonNullFields: ['amount'] },
  ),
  fx(
    'gap mortgage',
    'Gap Mortgage',
    { amount: '$80,000.00', county: 'Kings' },
    { kind: 'gap_mortgage', attorneyReviewRequired: true, nonNullFields: ['amount', 'county'] },
  ),
  fx(
    'exhibit a',
    'Exhibit A',
    {},
    { kind: 'exhibit_a', attorneyReviewRequired: true, nonNullFields: [] },
  ),
  fx(
    'exhibit b',
    'Exhibit B',
    {},
    { kind: 'exhibit_b', attorneyReviewRequired: true, nonNullFields: [] },
  ),
  fx(
    'exhibit c',
    'Exhibit C',
    {},
    { kind: 'exhibit_c', attorneyReviewRequired: true, nonNullFields: [] },
  ),
  fx(
    'exhibit d',
    'Exhibit D',
    {},
    { kind: 'exhibit_d', attorneyReviewRequired: true, nonNullFields: [] },
  ),
  fx(
    'section 255 affidavit',
    'Section 255 Affidavit',
    {},
    { kind: 'aff_255', attorneyReviewRequired: true, nonNullFields: [] },
  ),
  fx(
    'section 275 affidavit',
    'Section 275 Affidavit',
    {},
    { kind: 'aff_275', attorneyReviewRequired: true, nonNullFields: [] },
  ),
  fx(
    'mt-15',
    'MT-15 Mortgage Recording Tax Return',
    {},
    {
      kind: 'mt_15',
      attorneyReviewRequired: true,
      nonNullFields: [],
    },
  ),
  fx(
    'county cover sheet',
    'County Cover Sheet',
    { county: 'Nassau' },
    {
      kind: 'county_cover_sheet',
      attorneyReviewRequired: true,
      nonNullFields: ['county'],
    },
  ),
  fx(
    'promissory note',
    'Promissory Note',
    { amount: '$420,000.00' },
    { kind: 'note', attorneyReviewRequired: false, nonNullFields: ['amount'] },
  ),
  fx(
    'mortgage',
    'Mortgage',
    { amount: '$420,000.00', county: 'Bronx', recordedAt: '2019-05-01' },
    {
      kind: 'mortgage',
      attorneyReviewRequired: false,
      nonNullFields: ['amount', 'county', 'recordedAt'],
    },
  ),
  fx(
    'payoff letter',
    'Payoff Letter',
    { amount: '$311,204.55' },
    {
      kind: 'payoff_letter',
      attorneyReviewRequired: false,
      nonNullFields: ['amount'],
    },
  ),
  fx(
    'title commitment',
    'Title Commitment',
    {},
    {
      kind: 'title_commitment',
      attorneyReviewRequired: false,
      nonNullFields: [],
    },
  ),
  fx(
    'title policy',
    'Title Policy',
    {},
    {
      kind: 'title_policy',
      attorneyReviewRequired: false,
      nonNullFields: [],
    },
  ),
  fx(
    'endorsement 11.1',
    'ALTA 11.1-06 Endorsement',
    {},
    {
      kind: 'endorsement_111',
      attorneyReviewRequired: false,
      nonNullFields: [],
    },
  ),
  fx(
    'authorization',
    'Borrower Authorization',
    {},
    {
      kind: 'authorization',
      attorneyReviewRequired: false,
      nonNullFields: [],
    },
  ),
  fx(
    'reel-page mortgage',
    'Mortgage',
    { reelPage: '1234/567' },
    {
      kind: 'mortgage',
      attorneyReviewRequired: false,
      nonNullFields: [],
    },
  ),
  fx(
    'unrecognized doc',
    'Quarterly Escrow Statement',
    {},
    {
      kind: 'other',
      attorneyReviewRequired: false,
      nonNullFields: [],
    },
  ),
];
```

- [ ] **Step 2: Write the scorers**

Create `packages/agents/collateral-idp/evals/scorers.ts`:

```ts
import { classify } from '../src/classify';
import { extract } from '../src/extract';
import type { InstrumentRecord, RawExtraction } from '../src/types';
import type { IdpFixture } from './fixtures';

export type IdpExpected = IdpFixture['expected'];

export interface PipelineOutput {
  readonly kind: string;
  readonly attorneyReviewRequired: boolean;
  readonly instrument: InstrumentRecord;
}

export interface IdpScorerArgs {
  readonly input: RawExtraction;
  readonly expected: IdpExpected;
  readonly output: PipelineOutput;
}

export interface IdpScore {
  readonly name: string;
  readonly score: number;
}

// 1) Classification matches the expected kind.
function classificationCorrect({ output, expected }: IdpScorerArgs): IdpScore {
  return { name: 'classification-correct', score: output.kind === expected.kind ? 1 : 0 };
}

// 2) The attorney-review gate boolean is exactly right (hard rule #2).
function attorneyGateCorrect({ output, expected }: IdpScorerArgs): IdpScore {
  return {
    name: 'attorney-gate-correct',
    score: output.attorneyReviewRequired === expected.attorneyReviewRequired ? 1 : 0,
  };
}

// 3) No raw OCR text leaks into the structured record (PII hygiene): the
//    instrument carries only typed fields, never the free-text blob.
function noPiiLeak({ output }: IdpScorerArgs): IdpScore {
  const leaked = Object.values(output.instrument).some(
    (v) => typeof v === 'string' && v.length > 200,
  );
  return { name: 'no-pii-leak', score: leaked ? 0 : 1 };
}

// 4) Every field the fixture says should be populated is non-null.
function extractionCompleteness({ output, expected }: IdpScorerArgs): IdpScore {
  const rec = output.instrument as unknown as Record<string, unknown>;
  const allPresent = expected.nonNullFields.every((f) => rec[f] !== null && rec[f] !== undefined);
  return { name: 'extraction-completeness', score: allPresent ? 1 : 0 };
}

export const IDP_SCORERS = [
  classificationCorrect,
  attorneyGateCorrect,
  noPiiLeak,
  extractionCompleteness,
] as const;

// Runs the real pipeline for a fixture -- shared by the offline test + the
// live Braintrust task so both grade identical output.
export function runPipeline(input: RawExtraction): PipelineOutput {
  const classification = classify(input);
  return {
    kind: classification.kind,
    attorneyReviewRequired: classification.attorneyReviewRequired,
    instrument: extract('eval-doc', input, classification),
  };
}
```

- [ ] **Step 3: Write the offline gate test**

Create `packages/agents/collateral-idp/evals/scorers.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { IDP_FIXTURES } from './fixtures';
import { IDP_SCORERS, runPipeline } from './scorers';

describe('IDP offline compliance gate', () => {
  it.each(IDP_FIXTURES)('all scorers pass for: $name', (fixture) => {
    const output = runPipeline(fixture.input);
    for (const scorer of IDP_SCORERS) {
      const result = scorer({ input: fixture.input, expected: fixture.expected, output });
      expect(result.score, `${result.name} failed for ${fixture.name}`).toBe(1);
    }
  });
});
```

- [ ] **Step 4: Run the offline gate to verify it passes**

Run: `cmd /c "pnpm --filter @cema/agents-collateral-idp exec vitest run evals/scorers.test.ts"`
Expected: PASS (23 fixtures × all scorers).

- [ ] **Step 5: Write the Braintrust eval wiring**

Create `packages/agents/collateral-idp/evals/collateral-idp.eval.ts`:

```ts
import { Eval } from 'braintrust';

import type { RawExtraction } from '../src/types';
import { IDP_FIXTURES } from './fixtures';
import type { IdpExpected, PipelineOutput } from './scorers';
import { IDP_SCORERS, runPipeline } from './scorers';

// Live Braintrust eval over the deterministic classify+extract pipeline. The
// offline scorers.test.ts is the real gate; this run is skip-green in CI
// unless BRAINTRUST_API_KEY is set (run.mjs guards it).
// IDP_SCORERS already take Braintrust's { input, output, expected } arg shape,
// so they are passed directly -- no wrapper. Generics are pinned so inference
// does not depend on Braintrust's defaults.
void Eval<RawExtraction, PipelineOutput, IdpExpected>('collateral-idp', {
  data: IDP_FIXTURES.map((f) => ({
    input: f.input,
    expected: f.expected,
    metadata: { name: f.name },
  })),
  task: (input) => runPipeline(input),
  scores: [...IDP_SCORERS],
});
```

- [ ] **Step 6: Write the skip-green runner**

Create `packages/agents/collateral-idp/evals/run.mjs`:

```js
import { spawnSync } from 'node:child_process';

// IDP makes no model call, so the only key the live eval needs is Braintrust.
const REQUIRED_KEYS = ['BRAINTRUST_API_KEY'];
const missing = REQUIRED_KEYS.filter((k) => !process.env[k]);

if (missing.length > 0) {
  console.log(`[collateral-idp eval] skipped -- missing env: ${missing.join(', ')}`);
  process.exit(0);
}

const result = spawnSync('pnpm', ['exec', 'braintrust', 'eval', 'evals/collateral-idp.eval.ts'], {
  stdio: 'inherit',
  shell: true,
});

process.exit(result.status ?? 1);
```

- [ ] **Step 7: Verify the runner skips cleanly with no key**

Run: `cmd /c "pnpm --filter @cema/agents-collateral-idp eval"`
Expected: prints `[collateral-idp eval] skipped -- missing env: BRAINTRUST_API_KEY` and exits 0.

- [ ] **Step 8: Typecheck + commit**

```bash
cmd /c "pnpm --filter @cema/agents-collateral-idp typecheck"
git add packages/agents/collateral-idp/evals/fixtures.ts packages/agents/collateral-idp/evals/scorers.ts packages/agents/collateral-idp/evals/scorers.test.ts packages/agents/collateral-idp/evals/collateral-idp.eval.ts packages/agents/collateral-idp/evals/run.mjs
git commit -S -m "feat(m13): Braintrust eval for collateral IDP (offline scorers gate)"
```

---

## Final verification (before opening the PR series)

- [ ] **Whole-package test sweep**

Run: `cmd /c "pnpm --filter @cema/agents-collateral-idp test"`
Expected: PASS — types(2) + adapter(2) + classify(10) + extract(5) + orchestrator(5) + orchestrator.trace(1) + scorers(23 fixtures) all green.

- [ ] **Whole-app test sweep (durable wrap)**

Run: `cmd /c "pnpm --filter web exec vitest run lib/agents/collateral-idp/"`
Expected: PASS — `idp.workflow.test.ts` (2 tests).

- [ ] **Repo-wide gates**

Run: `cmd /c "pnpm typecheck && pnpm lint && pnpm test"`
Expected: all PASS. These are the four required `main` checks (Lint, Typecheck, Unit tests, Build) — Build runs in CI.

---

## Carry-overs (deferred to a later milestone — mirrors design doc §13)

1. **Real vendor IdpAdapter** — implement `IdpAdapter` over Reducto / AWS Textract Lending / Vaultedge; add `packages/integrations/<vendor>/` (hard rule #12) + a spec §16 row. The fixture is the dormant default until then. This is also where **multi-instrument-per-blob** row-minting lands (today's model is 1 blob → 1 readable segment → enrich the source row 1:1).
2. **Wire live triggers** — a collateral-file-ready hook or `deal_status` transition that calls `runCollateralIdpFromDeal` (or the durable variant). Nothing invokes the agent in M13.
3. **`re_chase` / re-extraction activation** — re-running IDP on a corrected/late document (idempotent by `documents.id`, so safe to re-run).
4. **Deal-scoped attorney-review surface** — a workspace view listing every `attorneyReviewRequired=true` document IDP flagged, feeding the Layer 1 attorney gate.
5. **Persist chain edges to `kg_edges`** — Approach A recomputes the chain per run; persisting is a later optimization (and the Chain-of-Title Phase 2 concern).
6. **Promote `InstrumentRecord` to a shared `@cema/collateral` package** — once Chain-of-Title (Phase 2) type-imports it, lift the type out of this package.
7. **Durable pipeline hand-off + `@workflow/vitest` proof** — chain intake → outreach → IDP → chain-of-title durably; add the gated durable integration test (same `@cema/*`-externalization blocker as ADR 0013 carry-over #5).
8. **Provision `BRAINTRUST_API_KEY`** (Connor) — flips the live eval from skip-green to grading. The offline `scorers.test.ts` is the real gate meanwhile.

---

## Chain-of-Title (Phase 2) — separate plan, after IDP lands

Phase 2 (the Chain-of-Title Agent, `@cema/agents-chain-of-title`, spec §9.6) gets
its **own** plan once this IDP package ships, because it type-imports the **real**
`InstrumentRecord` produced here. Its core is a pure function over the persisted
`InstrumentRecord[]` → `ChainAnalysis` (recomputed per run, not persisted —
Approach A). The highest-judgment piece will be `chain.ts`'s break-classification
predicate (design doc §12). Do not start it until `@cema/agents-collateral-idp`
is merged and green.
