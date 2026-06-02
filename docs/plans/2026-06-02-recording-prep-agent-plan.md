# Recording Prep Agent (v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a deal enters `recording`, determine the recording venue (NYC borough → ACRIS vs. upstate → county clerk), compose the venue-specific cover-sheet package, compute placeholder recording fees, persist each cover sheet as a draft `documents` row (gated where required), submit via a dormant `FixtureRecordingAdapter`, poll once, and record the outcome — reel/page or CRFN to `deals.metadata` on acceptance, a PII-safe `recording.rejected` audit on rejection.

**Architecture:** New `@cema/agents-recording-prep` package (pure `resolveVenue` + `planRecording` + `FixtureRecordingAdapter`, reusing `@cema/collateral`'s `DocumentKind`/`GATE_REQUIRED_KINDS`/`RecordingRef`). App-layer `runRecordingPrep` dispatcher that RLS-reads the deal (mockable `loadRecordingInput`), plans, and persists via mockable `hasExistingRecordingPackage` + `persistCoverSheet` + `persistRecordingCoordinates` seams (idempotent; reuses the IDP/Doc-Gen enqueue). Wired into the agent dispatcher (`recording → 'recording_prep'`). 0 migrations.

**Tech Stack:** TypeScript (strict, ESM), Vitest, Drizzle, `@cema/collateral`, `@cema/compliance`, `@cema/auth`, `@cema/db`, `@opentelemetry/api`.

**Design spec:** `docs/plans/2026-06-02-recording-prep-agent.md`

---

## Task 1: Scaffold `@cema/agents-recording-prep`

**Files:** Create `packages/agents/recording-prep/package.json`, `packages/agents/recording-prep/tsconfig.json`.

- [ ] **Step 1: `package.json`** (note the `@cema/collateral` runtime dep — reuses `GATE_REQUIRED_KINDS`)

```json
{
  "name": "@cema/agents-recording-prep",
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
    "@cema/collateral": "workspace:*"
  },
  "devDependencies": {
    "@cema/config": "workspace:*",
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: `tsconfig.json`**

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

- [ ] **Step 3: Install + commit**

Run: `pnpm install`

```bash
git add packages/agents/recording-prep/package.json packages/agents/recording-prep/tsconfig.json pnpm-lock.yaml
git commit -S -m "feat(recording-prep): scaffold @cema/agents-recording-prep package"
```

---

## Task 2: Pure core — `types.ts` + `venue.ts` (TDD)

**Files:** Create `src/types.ts`, `src/venue.ts`; Test `src/venue.test.ts`.

- [ ] **Step 1: Write the failing test** — `packages/agents/recording-prep/src/venue.test.ts`

```ts
import { describe, expect, it } from 'vitest';

import type { DealRecordingInput } from './types';
import { resolveVenue } from './venue';

const base = (over: Partial<DealRecordingInput>): DealRecordingInput => ({
  dealId: 'd1',
  cemaType: 'refi_cema',
  county: 'Albany',
  acrisBbl: null,
  ...over,
});

describe('resolveVenue', () => {
  it('routes each NYC borough via the acrisBbl borough digit', () => {
    expect(resolveVenue(base({ acrisBbl: '1-00100-0001' }))).toEqual({
      venue: 'acris',
      borough: 1,
    });
    expect(resolveVenue(base({ acrisBbl: '3-09999-1234' }))).toEqual({
      venue: 'acris',
      borough: 3,
    });
    expect(resolveVenue(base({ acrisBbl: '5-00001-0001' }))).toEqual({
      venue: 'acris',
      borough: 5,
    });
  });

  it('falls back to NYC county / borough-alias names when acrisBbl is absent', () => {
    expect(resolveVenue(base({ county: 'Kings' }))).toEqual({ venue: 'acris', borough: 3 });
    expect(resolveVenue(base({ county: 'Brooklyn' }))).toEqual({ venue: 'acris', borough: 3 });
    expect(resolveVenue(base({ county: 'New York' }))).toEqual({ venue: 'acris', borough: 1 });
    expect(resolveVenue(base({ county: 'Richmond' }))).toEqual({ venue: 'acris', borough: 5 });
  });

  it('routes upstate counties to the county clerk', () => {
    expect(resolveVenue(base({ county: 'Nassau' }))).toEqual({ venue: 'county', borough: null });
    expect(resolveVenue(base({ county: 'Erie' }))).toEqual({ venue: 'county', borough: null });
  });

  it('prefers acrisBbl over a conflicting county name', () => {
    // bbl says borough 2 (Bronx); county text says Nassau (upstate) -> bbl wins
    expect(resolveVenue(base({ county: 'Nassau', acrisBbl: '2-00100-0001' }))).toEqual({
      venue: 'acris',
      borough: 2,
    });
  });

  it('is case- and whitespace-insensitive on the county fallback', () => {
    expect(resolveVenue(base({ county: '  queens ' }))).toEqual({ venue: 'acris', borough: 4 });
  });
});
```

- [ ] **Step 2: Run → FAIL** (`pnpm --filter @cema/agents-recording-prep test`) — module not found.

- [ ] **Step 3: Implement `types.ts`**

```ts
import type { DocumentKind, RecordingRef } from '@cema/collateral';

// Recording venue. 'acris' = one of the five NYC boroughs (borough 1-5); 'county'
// = an upstate county clerk.
export type RecordingVenue = 'acris' | 'county';

// Plain data the planner needs (decoupled from @cema/db). The loader passes the raw
// enum value for cemaType; acrisBbl is the NYC Borough-Block-Lot ("1-00123-0045")
// or null upstate; pageCount defaults to the placeholder estimate.
export interface DealRecordingInput {
  readonly dealId: string;
  readonly cemaType: string; // 'refi_cema' | 'purchase_cema'
  readonly county: string; // properties.county
  readonly acrisBbl: string | null; // properties.acrisBbl (NYC only)
  readonly pageCount?: number; // estimated; defaults to ESTIMATED_CEMA_PAGE_COUNT
}

// Resolved venue + borough (1-5 for ACRIS, null upstate).
export interface VenueResolution {
  readonly venue: RecordingVenue;
  readonly borough: number | null;
}

// A planned cover sheet: its kind, the hard-rule-#2 gate flag, a human title, and a
// thin deterministic field-map. `fields` is the document's own content (venue, fee)
// -- stored in documents.extractedData (the IDP/Doc-Gen precedent), NOT logged.
export interface PlannedCoverSheet {
  readonly kind: DocumentKind;
  readonly attorneyReviewRequired: boolean;
  readonly title: string;
  readonly fields: Readonly<Record<string, string | number>>;
}

// Placeholder recording-fee breakdown (Connor-gated schedule). Amounts in dollars.
export interface FeeBreakdown {
  readonly baseFee: number;
  readonly perPageFee: number;
  readonly pageCount: number;
  readonly flatCountyFee: number; // e.g. Nassau $355, Suffolk $300; 0 otherwise
  readonly total: number;
}

export interface RecordingPlan {
  readonly venue: RecordingVenue;
  readonly borough: number | null;
  readonly coverSheets: readonly PlannedCoverSheet[];
  readonly fees: FeeBreakdown;
}

// Dormant submission seam (Simplifile + ACRIS later).
export type RecordingStatus = 'not_submitted' | 'pending' | 'accepted' | 'rejected';

export interface RecordingSubmission {
  readonly submissionId: string | null;
  readonly submitted: boolean;
}

export interface RecordingPollResult {
  readonly status: RecordingStatus;
  readonly recordingRef?: RecordingRef; // present iff accepted
  readonly rejectionReason?: string; // a static token, never authority free-text
}

export interface RecordingAdapter {
  submit(plan: RecordingPlan): Promise<RecordingSubmission>;
  poll(submissionId: string): Promise<RecordingPollResult>;
}
```

- [ ] **Step 4: Implement `venue.ts`**

```ts
import type { DealRecordingInput, VenueResolution } from './types';

// NYC counties (+ borough aliases) -> borough number. The fallback signal when
// acrisBbl is absent. Manhattan=1, Bronx=2, Brooklyn=3, Queens=4, Staten Island=5.
const NYC_BOROUGH_BY_COUNTY: Record<string, number> = {
  'new york': 1,
  manhattan: 1,
  bronx: 2,
  kings: 3,
  brooklyn: 3,
  queens: 4,
  richmond: 5,
  'staten island': 5,
};

/**
 * Resolve the recording venue. Primary signal: the acrisBbl borough digit (the DB
 * enforces ^[1-5]-\d{1,5}-\d{1,4}$). Fallback: the county name (NYC county or
 * borough alias). Else upstate county clerk. Pure, no IO.
 */
export function resolveVenue(input: DealRecordingInput): VenueResolution {
  const bbl = input.acrisBbl?.match(/^([1-5])-/);
  if (bbl) return { venue: 'acris', borough: Number(bbl[1]) };
  const borough = NYC_BOROUGH_BY_COUNTY[input.county.trim().toLowerCase()];
  if (borough) return { venue: 'acris', borough };
  return { venue: 'county', borough: null };
}
```

- [ ] **Step 5: Run → PASS** (5 tests). **Step 6: Commit**

```bash
git add packages/agents/recording-prep/src/types.ts packages/agents/recording-prep/src/venue.ts packages/agents/recording-prep/src/venue.test.ts
git commit -S -m "feat(recording-prep): pure venue routing (ACRIS borough vs upstate county)"
```

---

## Task 3: Pure core — `plan.ts` + fee math (TDD)

**Files:** Create `src/plan.ts`; Test `src/plan.test.ts`.

- [ ] **Step 1: Write the failing test** — `packages/agents/recording-prep/src/plan.test.ts`

```ts
import { GATE_REQUIRED_KINDS } from '@cema/collateral';
import { describe, expect, it } from 'vitest';

import { computeFees, planRecording } from './plan';
import type { DealRecordingInput } from './types';

const NYC_REFI: DealRecordingInput = {
  dealId: 'd1',
  cemaType: 'refi_cema',
  county: 'Kings',
  acrisBbl: '3-00100-0001',
};
const UPSTATE_REFI: DealRecordingInput = {
  dealId: 'd1',
  cemaType: 'refi_cema',
  county: 'Nassau',
  acrisBbl: null,
};
const NYC_PURCHASE: DealRecordingInput = {
  dealId: 'd1',
  cemaType: 'purchase_cema',
  county: 'Queens',
  acrisBbl: '4-00100-0001',
};
const UPSTATE_PURCHASE: DealRecordingInput = {
  dealId: 'd1',
  cemaType: 'purchase_cema',
  county: 'Erie',
  acrisBbl: null,
};

const kinds = (i: DealRecordingInput) =>
  planRecording(i)
    .coverSheets.map((s) => s.kind)
    .sort();

describe('planRecording', () => {
  it('NYC refi -> just acris_cover_pages', () => {
    expect(kinds(NYC_REFI)).toEqual(['acris_cover_pages']);
    expect(planRecording(NYC_REFI).venue).toBe('acris');
  });

  it('upstate refi -> just county_cover_sheet', () => {
    expect(kinds(UPSTATE_REFI)).toEqual(['county_cover_sheet']);
    expect(planRecording(UPSTATE_REFI).venue).toBe('county');
  });

  it('NYC purchase -> acris_cover_pages + nyc_rpt + tp_584', () => {
    expect(kinds(NYC_PURCHASE)).toEqual(['acris_cover_pages', 'nyc_rpt', 'tp_584'].sort());
  });

  it('upstate purchase -> county_cover_sheet + tp_584 (no nyc_rpt)', () => {
    expect(kinds(UPSTATE_PURCHASE)).toEqual(['county_cover_sheet', 'tp_584'].sort());
  });

  it('only county_cover_sheet is attorney-gated; the others are not', () => {
    const gate = new Set<string>(GATE_REQUIRED_KINDS);
    for (const s of planRecording(NYC_PURCHASE).coverSheets) {
      expect(s.attorneyReviewRequired).toBe(gate.has(s.kind));
    }
    const county = planRecording(UPSTATE_REFI).coverSheets[0];
    expect(county.kind).toBe('county_cover_sheet');
    expect(county.attorneyReviewRequired).toBe(true);
    expect(planRecording(NYC_REFI).coverSheets[0].attorneyReviewRequired).toBe(false);
  });

  it('computes fees with the flat county add-on (placeholder schedule)', () => {
    const f = computeFees('Nassau', 40);
    expect(f.flatCountyFee).toBe(355);
    expect(f.total).toBe(40 + 5 * 40 + 355); // base + per-page*pages + flat
    expect(computeFees('Albany', 40).flatCountyFee).toBe(0);
  });

  it('uses the placeholder page-count default when none is supplied', () => {
    expect(planRecording(NYC_REFI).fees.pageCount).toBe(40);
    expect(planRecording({ ...NYC_REFI, pageCount: 50 }).fees.pageCount).toBe(50);
  });

  it('cover-sheet fields are PII-free (whitelisted keys only, no SSN)', () => {
    for (const s of planRecording(NYC_PURCHASE).coverSheets) {
      expect(Object.keys(s.fields).sort()).toEqual(['county', 'dealId', 'total', 'venue']);
      expect(JSON.stringify(s.fields)).not.toMatch(/\d{3}-?\d{2}-?\d{4}/);
    }
  });
});
```

- [ ] **Step 2: Run → FAIL.** **Step 3: Implement `plan.ts`**

```ts
import { GATE_REQUIRED_KINDS, type DocumentKind } from '@cema/collateral';

import type {
  DealRecordingInput,
  FeeBreakdown,
  PlannedCoverSheet,
  RecordingPlan,
  RecordingVenue,
} from './types';
import { resolveVenue } from './venue';

const GATE_SET = new Set<DocumentKind>(GATE_REQUIRED_KINDS);

// Placeholder recording-fee schedule (Connor-gated -- see design spec section 1/7).
// Real per-county schedules replace these; until then every fee is preliminary.
export const ESTIMATED_CEMA_PAGE_COUNT = 40; // spec section 9.8: CEMA packages 35-45 pages
const BASE_FEE = 40; // placeholder clerk base filing fee ($)
const PER_PAGE_FEE = 5; // placeholder per-page fee ($)
// Flat county add-on fees keyed by lowercased county (placeholder examples, spec 9.8).
const FLAT_COUNTY_FEE: Record<string, number> = {
  nassau: 355, // Tax Lot Verification Letter
  suffolk: 300, // Mortgage Verification Fee
};

// Cover-sheet kinds this agent emits (a subset of DOCUMENT_KINDS). Title per kind;
// the gate flag is derived PER-KIND from GATE_SET (the IDP pattern) -- unlike
// Doc-Gen, the emitted set MIXES gated (county_cover_sheet) and non-gated kinds.
const TITLE_BY_KIND = {
  acris_cover_pages: 'ACRIS Recording & Endorsement Cover Pages',
  county_cover_sheet: 'County Clerk Recording Cover Sheet',
  nyc_rpt: 'NYC Real Property Transfer Tax Return (NYC-RPT)',
  tp_584: 'NY TP-584 Combined Transfer Tax Return',
} satisfies Partial<Record<DocumentKind, string>>;

type EmittedKind = keyof typeof TITLE_BY_KIND;

// Load-time guard: our per-kind gate derivation must agree with @cema/collateral
// (+ the documents_attorney_gate_required DB CHECK). county_cover_sheet is gated;
// the others are not. A future edit that flips a kind's gate status in only one
// place is caught here at module load.
const EXPECTED_GATED: Record<EmittedKind, boolean> = {
  acris_cover_pages: false,
  county_cover_sheet: true,
  nyc_rpt: false,
  tp_584: false,
};
for (const kind of Object.keys(TITLE_BY_KIND) as EmittedKind[]) {
  if (GATE_SET.has(kind) !== EXPECTED_GATED[kind]) {
    throw new Error(`recording-prep gate mismatch for "${kind}" vs GATE_REQUIRED_KINDS`);
  }
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Placeholder recording-fee math: base + per-page * pages + flat county add-on. */
export function computeFees(county: string, pageCount: number): FeeBreakdown {
  const flatCountyFee = FLAT_COUNTY_FEE[county.trim().toLowerCase()] ?? 0;
  const total = round2(BASE_FEE + PER_PAGE_FEE * pageCount + flatCountyFee);
  return { baseFee: BASE_FEE, perPageFee: PER_PAGE_FEE, pageCount, flatCountyFee, total };
}

function make(
  kind: EmittedKind,
  input: DealRecordingInput,
  venue: RecordingVenue,
  fees: FeeBreakdown,
): PlannedCoverSheet {
  return {
    kind,
    attorneyReviewRequired: GATE_SET.has(kind),
    title: TITLE_BY_KIND[kind],
    fields: { dealId: input.dealId, venue, county: input.county, total: fees.total },
  };
}

/**
 * Pure, deterministic recording-package planner (spec section 9.8). Resolves the
 * venue, composes the venue x CEMA-type cover-sheet set, and computes the
 * placeholder recording fees. No clock, no LLM, no IO. PII-safe (static titles;
 * fields carry only venue/county/fee -- the document's own content).
 */
export function planRecording(input: DealRecordingInput): RecordingPlan {
  const { venue, borough } = resolveVenue(input);
  const isPurchase = input.cemaType === 'purchase_cema';
  const pageCount = input.pageCount ?? ESTIMATED_CEMA_PAGE_COUNT;
  const fees = computeFees(input.county, pageCount);

  const kinds: EmittedKind[] = [];
  if (venue === 'acris') kinds.push('acris_cover_pages');
  else kinds.push('county_cover_sheet');
  if (venue === 'acris' && isPurchase) kinds.push('nyc_rpt');
  if (isPurchase) kinds.push('tp_584');

  const coverSheets = kinds.map((kind) => make(kind, input, venue, fees));
  return { venue, borough, coverSheets, fees };
}
```

- [ ] **Step 4: Run → PASS (8 tests).** **Step 5: Commit**

```bash
git add packages/agents/recording-prep/src/plan.ts packages/agents/recording-prep/src/plan.test.ts
git commit -S -m "feat(recording-prep): pure planRecording core (cover-sheet composition + fee math)"
```

---

## Task 4: `FixtureRecordingAdapter` + `index.ts` (TDD)

**Files:** Create `src/adapter.ts`, `src/index.ts`; Test `src/adapter.test.ts`.

- [ ] **Step 1: Failing test** — `src/adapter.test.ts`

```ts
import { describe, expect, it } from 'vitest';

import { FixtureRecordingAdapter } from './adapter';

describe('FixtureRecordingAdapter', () => {
  it('submit is dormant — transmits nothing', async () => {
    const result = await new FixtureRecordingAdapter().submit({
      venue: 'county',
      borough: null,
      coverSheets: [],
      fees: { baseFee: 40, perPageFee: 5, pageCount: 40, flatCountyFee: 0, total: 240 },
    });
    expect(result.submitted).toBe(false);
    expect(result.submissionId).toBeNull();
  });

  it('poll reports not_submitted', async () => {
    const result = await new FixtureRecordingAdapter().poll('sub-1');
    expect(result.status).toBe('not_submitted');
  });
});
```

- [ ] **Step 2: Run → FAIL.** **Step 3: Implement `adapter.ts`**

```ts
import type {
  RecordingAdapter,
  RecordingPlan,
  RecordingPollResult,
  RecordingSubmission,
} from './types';

/**
 * Dormant default recording adapter. submit() transmits nothing (submitted:false,
 * no submissionId) and poll() reports not_submitted -- the wiring default until
 * real Simplifile (statewide) + ACRIS (NYC) adapters are provisioned (vendor keys).
 * Also the test double for the dispatcher's dormant path.
 *
 * Methods are not `async` (they do no awaiting) -- they return resolved Promises to
 * satisfy the RecordingAdapter contract without tripping require-await. The
 * underscore-prefixed params satisfy no-unused-vars.
 */
export class FixtureRecordingAdapter implements RecordingAdapter {
  submit(_plan: RecordingPlan): Promise<RecordingSubmission> {
    return Promise.resolve({ submissionId: null, submitted: false });
  }

  poll(_submissionId: string): Promise<RecordingPollResult> {
    return Promise.resolve({ status: 'not_submitted' });
  }
}
```

- [ ] **Step 4: Implement `index.ts`**

```ts
export * from './types';
export * from './venue';
export * from './plan';
export * from './adapter';
```

- [ ] **Step 5: Run test + typecheck → PASS (10 total).** **Step 6: Commit**

```bash
git add packages/agents/recording-prep/src/adapter.ts packages/agents/recording-prep/src/adapter.test.ts packages/agents/recording-prep/src/index.ts
git commit -S -m "feat(recording-prep): dormant FixtureRecordingAdapter + package barrel"
```

---

## Task 5: App loader + persistence seams + adapter instance

**Files:** Modify `apps/web/package.json` (+ dep, run `pnpm install`); Create `apps/web/lib/agents/recording-prep/{deal-data.ts,persist.ts,adapter.ts}`.

- [ ] **Step 1: Add dep** — `apps/web/package.json` dependencies (alphabetical, next to the other `@cema/agents-*`):

```json
    "@cema/agents-recording-prep": "workspace:*",
```

Run `pnpm install`.

- [ ] **Step 2: `apps/web/lib/agents/recording-prep/adapter.ts`**

```ts
import { FixtureRecordingAdapter, type RecordingAdapter } from '@cema/agents-recording-prep';

// Dormant FixtureRecordingAdapter today; the swap point for real Simplifile
// (statewide) + ACRIS (NYC) submission/polling adapters once vendor keys land.
export const recordingAdapter: RecordingAdapter = new FixtureRecordingAdapter();
```

- [ ] **Step 3: `apps/web/lib/agents/recording-prep/deal-data.ts`** (RLS loader)

```ts
import { type DealRecordingInput } from '@cema/agents-recording-prep';
import { deals, properties } from '@cema/db';
import { eq } from 'drizzle-orm';

import { withRls } from '../../with-rls';

/**
 * RLS-read the data planRecording needs: the deal (cemaType) + its property
 * (county, acrisBbl). Returns null if the deal or property is missing. A mockable
 * seam (the dispatcher test never touches the Drizzle chain). pageCount is left
 * undefined -- the core applies ESTIMATED_CEMA_PAGE_COUNT.
 */
export async function loadRecordingInput(
  organizationId: string,
  dealId: string,
): Promise<DealRecordingInput | null> {
  return withRls(organizationId, async (tx) => {
    const [deal] = await tx.select().from(deals).where(eq(deals.id, dealId)).limit(1);
    if (!deal || !deal.propertyId) return null;

    const [property] = await tx
      .select({ county: properties.county, acrisBbl: properties.acrisBbl })
      .from(properties)
      .where(eq(properties.id, deal.propertyId))
      .limit(1);
    if (!property) return null;

    return {
      dealId,
      cemaType: deal.cemaType,
      county: property.county,
      acrisBbl: property.acrisBbl,
    };
  });
}
```

- [ ] **Step 4: `apps/web/lib/agents/recording-prep/persist.ts`** (idempotency + per-sheet persist + coordinates)

```ts
import { type PlannedCoverSheet } from '@cema/agents-recording-prep';
import { type RecordingRef } from '@cema/collateral';
import { emitAuditEvent } from '@cema/compliance';
import { deals, documentReviewQueue, documents } from '@cema/db';
import { and, eq, inArray } from 'drizzle-orm';

import { withRls } from '../../with-rls';

// Either venue cover sheet is the idempotency anchor (exactly one applies per deal).
const COVER_SHEET_ANCHORS = ['acris_cover_pages', 'county_cover_sheet'] as const;

/**
 * Idempotency: if a venue cover sheet already exists for the deal, the package was
 * already prepared -> the run is a no-op. Cheap, migration-free.
 */
export async function hasExistingRecordingPackage(
  organizationId: string,
  dealId: string,
): Promise<boolean> {
  return withRls(organizationId, async (tx) => {
    const [row] = await tx
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.dealId, dealId), inArray(documents.kind, [...COVER_SHEET_ANCHORS])))
      .limit(1);
    return !!row;
  });
}

/**
 * Insert one cover sheet (draft, gate flag from the plan, field-map in
 * extractedData, no blob) and, if gate-required (county_cover_sheet), enqueue into
 * the attorney review queue (idempotent; emits document.submitted_for_review on a
 * real insert) -- the IDP/Doc-Gen pattern. Co-transactional within one withRls.
 * `documents` is deal-owned (no organizationId column).
 */
export async function persistCoverSheet(
  organizationId: string,
  actorUserId: string,
  dealId: string,
  sheet: PlannedCoverSheet,
): Promise<void> {
  await withRls(organizationId, async (tx) => {
    const [inserted] = await tx
      .insert(documents)
      .values({
        dealId,
        kind: sheet.kind,
        status: 'draft',
        attorneyReviewRequired: sheet.attorneyReviewRequired,
        extractedData: sheet.fields as Record<string, unknown>,
      })
      .returning({ id: documents.id, version: documents.version });
    if (!inserted) return;

    if (!sheet.attorneyReviewRequired) return;

    const [queued] = await tx
      .insert(documentReviewQueue)
      .values({
        organizationId,
        documentId: inserted.id,
        documentVersion: inserted.version,
        submittedById: actorUserId,
      })
      .onConflictDoNothing({
        target: [documentReviewQueue.documentId, documentReviewQueue.documentVersion],
      })
      .returning({ id: documentReviewQueue.id });
    if (!queued) return;

    await emitAuditEvent(tx, {
      organizationId,
      actorUserId,
      action: 'document.submitted_for_review',
      entityType: 'document',
      entityId: inserted.id,
      metadata: { queueId: queued.id, version: inserted.version, source: 'recording-prep' },
    });
  });
}

/**
 * Persist the recording coordinates (reel/page OR CRFN) to deals.metadata.recording
 * on acceptance. Read-modify-write the jsonb under one withRls. Asserts the
 * reel-page-XOR-CRFN invariant. Dormant/test-only until a real adapter returns
 * accepted.
 */
export async function persistRecordingCoordinates(
  organizationId: string,
  dealId: string,
  venue: string,
  ref: RecordingRef,
  recordedAt: string,
): Promise<void> {
  const hasReel = !!ref.reelPage;
  const hasCrfn = !!ref.crfn;
  if (hasReel === hasCrfn) {
    throw new Error('recording coordinates must carry exactly one of reelPage / crfn');
  }
  await withRls(organizationId, async (tx) => {
    const [deal] = await tx
      .select({ metadata: deals.metadata })
      .from(deals)
      .where(eq(deals.id, dealId))
      .limit(1);
    if (!deal) return;
    await tx
      .update(deals)
      .set({
        metadata: {
          ...deal.metadata,
          recording: { venue, reelPage: ref.reelPage, crfn: ref.crfn, recordedAt },
        },
      })
      .where(eq(deals.id, dealId));
  });
}
```

- [ ] **Step 5: Commit** (these seams are exercised by Task 6's dispatcher test + Task 7's Neon integration; commit together with Task 6).

---

## Task 6: App dispatcher — `runRecordingPrep` (TDD)

**Files:** Create `apps/web/lib/agents/recording-prep/run-recording-prep.ts`; Test `apps/web/lib/agents/recording-prep/run-recording-prep.test.ts`.

- [ ] **Step 1: Failing test** — `run-recording-prep.test.ts` (mirrors `run-doc-gen.test.ts`'s mock layout exactly, incl. the `drizzle-orm` `eq` mock)

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Identity resolution (mirrors runDocGen / runOutreachFromDeal): clerk -> internal.
vi.mock('@cema/auth', () => ({
  getCurrentOrganizationId: vi.fn().mockResolvedValue('clerk-org-1'),
  getCurrentUser: vi.fn().mockResolvedValue({ id: 'clerk-user-1' }),
}));
vi.mock('@cema/db', () => ({
  getDb: vi.fn(() => ({
    query: {
      organizations: { findFirst: vi.fn().mockResolvedValue({ id: 'org-1' }) },
      users: { findFirst: vi.fn().mockResolvedValue({ id: 'user-1' }) },
    },
  })),
  organizations: {},
  users: {},
}));
vi.mock('drizzle-orm', () => ({ eq: vi.fn().mockReturnValue({}) }));

vi.mock('./deal-data', () => ({ loadRecordingInput: vi.fn() }));
vi.mock('./persist', () => ({
  hasExistingRecordingPackage: vi.fn(),
  persistCoverSheet: vi.fn(),
  persistRecordingCoordinates: vi.fn(),
}));
vi.mock('./adapter', () => ({ recordingAdapter: { submit: vi.fn(), poll: vi.fn() } }));
vi.mock('@cema/compliance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@cema/compliance')>();
  return { ...actual, emitAuditEvent: vi.fn() };
});
vi.mock('../../with-rls', () => ({
  withRls: vi.fn((_orgId: string, cb: (tx: unknown) => unknown) => cb({})),
}));

import { emitAuditEvent } from '@cema/compliance';

import { recordingAdapter } from './adapter';
import { loadRecordingInput } from './deal-data';
import {
  hasExistingRecordingPackage,
  persistCoverSheet,
  persistRecordingCoordinates,
} from './persist';
import { runRecordingPrep } from './run-recording-prep';

const NYC_REFI = {
  dealId: 'deal-1',
  cemaType: 'refi_cema',
  county: 'Kings',
  acrisBbl: '3-00100-0001',
};
const UPSTATE_REFI = { dealId: 'deal-1', cemaType: 'refi_cema', county: 'Nassau', acrisBbl: null };

const auditActions = () => vi.mocked(emitAuditEvent).mock.calls.map((c) => c[1].action);

beforeEach(() => {
  vi.mocked(hasExistingRecordingPackage).mockResolvedValue(false);
  vi.mocked(loadRecordingInput).mockResolvedValue(NYC_REFI);
  vi.mocked(persistCoverSheet).mockResolvedValue(undefined);
  vi.mocked(persistRecordingCoordinates).mockResolvedValue(undefined);
  vi.mocked(emitAuditEvent).mockResolvedValue(undefined);
  vi.mocked(recordingAdapter.submit).mockResolvedValue({ submissionId: null, submitted: false });
  vi.mocked(recordingAdapter.poll).mockResolvedValue({ status: 'not_submitted' });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('runRecordingPrep', () => {
  it('persists the venue cover sheet + split-audits (NYC refi -> acris)', async () => {
    await runRecordingPrep('deal-1');
    expect(persistCoverSheet).toHaveBeenCalledTimes(1);
    expect(vi.mocked(persistCoverSheet).mock.calls[0][3].kind).toBe('acris_cover_pages');
    expect(auditActions()).toContain('recording.evaluated');
    expect(auditActions()).toContain('recording.prepared');
  });

  it('persists the gated county_cover_sheet (upstate refi)', async () => {
    vi.mocked(loadRecordingInput).mockResolvedValue(UPSTATE_REFI);
    await runRecordingPrep('deal-1');
    expect(vi.mocked(persistCoverSheet).mock.calls[0][3].kind).toBe('county_cover_sheet');
  });

  it('is idempotent — skips when a cover sheet already exists', async () => {
    vi.mocked(hasExistingRecordingPackage).mockResolvedValue(true);
    await runRecordingPrep('deal-1');
    expect(loadRecordingInput).not.toHaveBeenCalled();
    expect(persistCoverSheet).not.toHaveBeenCalled();
    expect(emitAuditEvent).not.toHaveBeenCalled();
  });

  it('no-ops when the deal data is missing', async () => {
    vi.mocked(loadRecordingInput).mockResolvedValue(null);
    await runRecordingPrep('deal-1');
    expect(persistCoverSheet).not.toHaveBeenCalled();
  });

  it('on acceptance persists coordinates + recording.completed', async () => {
    vi.mocked(recordingAdapter.submit).mockResolvedValue({
      submissionId: 'sub-1',
      submitted: true,
    });
    vi.mocked(recordingAdapter.poll).mockResolvedValue({
      status: 'accepted',
      recordingRef: { reelPage: null, crfn: '2026000123456' },
    });
    await runRecordingPrep('deal-1');
    expect(persistRecordingCoordinates).toHaveBeenCalledTimes(1);
    expect(auditActions()).toContain('recording.completed');
    expect(auditActions()).not.toContain('recording.rejected');
  });

  it('on rejection emits recording.rejected + no coordinates', async () => {
    vi.mocked(recordingAdapter.submit).mockResolvedValue({
      submissionId: 'sub-1',
      submitted: true,
    });
    vi.mocked(recordingAdapter.poll).mockResolvedValue({
      status: 'rejected',
      rejectionReason: 'bad_legal_description',
    });
    await runRecordingPrep('deal-1');
    expect(persistRecordingCoordinates).not.toHaveBeenCalled();
    expect(auditActions()).toContain('recording.rejected');
    expect(auditActions()).not.toContain('recording.completed');
  });

  it('audit metadata is PII-safe (county name not leaked; venue token only)', async () => {
    await runRecordingPrep('deal-1');
    for (const call of vi.mocked(emitAuditEvent).mock.calls) {
      const meta = JSON.stringify(call[1].metadata ?? {});
      expect(meta).not.toContain('Kings'); // county name never in audit metadata
    }
  });
});
```

> NOTE: identity resolution mirrors `run-doc-gen.ts` exactly — `getCurrentOrganizationId`/`getCurrentUser`, then `getDb().query.organizations.findFirst({ where: eq(organizations.clerkOrgId, ...) })` + the same for `users`. Read `run-doc-gen.ts` and copy the resolution block verbatim.

- [ ] **Step 2: Run → FAIL.** **Step 3: Implement `run-recording-prep.ts`**

```ts
import { planRecording } from '@cema/agents-recording-prep';
import { getCurrentOrganizationId, getCurrentUser } from '@cema/auth';
import { emitAuditEvent } from '@cema/compliance';
import { getDb, organizations, users } from '@cema/db';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { eq } from 'drizzle-orm';

import { withRls } from '../../with-rls';

import { recordingAdapter } from './adapter';
import { loadRecordingInput } from './deal-data';
import {
  hasExistingRecordingPackage,
  persistCoverSheet,
  persistRecordingCoordinates,
} from './persist';

const tracer = trace.getTracer('@cema/web-recording-prep');

/**
 * Post-commit Recording Prep dispatcher (spec section 9.8). When a deal enters
 * `recording`, resolve the venue, compose + persist the venue cover sheets (gated
 * where required), submit via the dormant adapter, poll once (single-pass), and
 * record the outcome.
 *
 * Self-resolves identity (mirrors runDocGen). Idempotent: skips a deal whose
 * package already exists. Invoked from the best-effort agent dispatcher, which
 * swallows + records `deal.agent_dispatch_failed` on failure, so this may throw.
 */
export async function runRecordingPrep(dealId: string): Promise<void> {
  return tracer.startActiveSpan('recording.run', async (span) => {
    span.setAttribute('recording.deal_id', dealId);
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

      // Idempotency: the package was already prepared for this deal.
      if (await hasExistingRecordingPackage(org.id, dealId)) {
        span.setAttribute('recording.skipped', 'already_prepared');
        span.setStatus({ code: SpanStatusCode.OK });
        return;
      }

      const input = await loadRecordingInput(org.id, dealId);
      if (!input) {
        span.setAttribute('recording.skipped', 'missing_data');
        span.setStatus({ code: SpanStatusCode.OK });
        return;
      }

      const plan = planRecording(input);
      span.setAttribute('recording.venue', plan.venue);
      span.setAttribute('recording.cover_sheet_count', plan.coverSheets.length);

      // Split audit (part 1): the decision BEFORE any write. PII-safe metadata.
      await withRls(org.id, (tx) =>
        emitAuditEvent(tx, {
          organizationId: org.id,
          actorUserId: user.id,
          action: 'recording.evaluated',
          entityType: 'deal',
          entityId: dealId,
          metadata: { venue: plan.venue, count: plan.coverSheets.length },
        }),
      );

      for (const sheet of plan.coverSheets) {
        await persistCoverSheet(org.id, user.id, dealId, sheet);
      }

      // Split audit (part 2): cover sheets persisted -- the dormant/pending terminal.
      await withRls(org.id, (tx) =>
        emitAuditEvent(tx, {
          organizationId: org.id,
          actorUserId: user.id,
          action: 'recording.prepared',
          entityType: 'deal',
          entityId: dealId,
          metadata: { venue: plan.venue, count: plan.coverSheets.length },
        }),
      );

      const submission = await recordingAdapter.submit(plan);
      // Live/test-only: the dormant Fixture returns submitted:false, so the
      // accepted/rejected branches below never run in production until a real
      // Simplifile/ACRIS adapter is wired.
      if (submission.submitted && submission.submissionId) {
        const result = await recordingAdapter.poll(submission.submissionId);
        span.setAttribute('recording.status', result.status);
        if (result.status === 'accepted' && result.recordingRef) {
          await persistRecordingCoordinates(
            org.id,
            dealId,
            plan.venue,
            result.recordingRef,
            new Date().toISOString(),
          );
          await withRls(org.id, (tx) =>
            emitAuditEvent(tx, {
              organizationId: org.id,
              actorUserId: user.id,
              action: 'recording.completed',
              entityType: 'deal',
              entityId: dealId,
              metadata: { venue: plan.venue },
            }),
          );
        } else if (result.status === 'rejected') {
          await withRls(org.id, (tx) =>
            emitAuditEvent(tx, {
              organizationId: org.id,
              actorUserId: user.id,
              action: 'recording.rejected',
              entityType: 'deal',
              entityId: dealId,
              metadata: { venue: plan.venue, reason: result.rejectionReason ?? 'unspecified' },
            }),
          );
        }
      }
      span.setStatus({ code: SpanStatusCode.OK });
    } finally {
      span.end();
    }
  });
}
```

- [ ] **Step 4: Run → PASS (7 tests).** **Step 5: Commit** (with Task 5's seams)

```bash
git add apps/web/lib/agents/recording-prep/ apps/web/package.json pnpm-lock.yaml
git commit -S -m "feat(recording-prep): runRecordingPrep dispatcher + RLS loader + persist/coordinate seams"
```

---

## Task 7: Neon integration test for the real persist (skip-green)

**Files:** Create `apps/web/tests/integration/recording-prep-persist.test.ts`.

- [ ] **Step 1: Write the integration test** — `describe.skipIf(!process.env.DATABASE_URL)`. Model it on `apps/web/tests/integration/doc-gen-persist.test.ts` (same seed + enqueue + audit + RLS assertions). Use a UNIQUE stable namespace to dodge the shared-Neon-branch collision hazard — ids prefixed `rp1`, `clerkOrgId` `rpci1`, distinct names/slugs/emails carrying the same `rp1`/`rpci1` prefix; `grep` other `tests/integration/*.ts` for those ids first to confirm no collision. Seed (owner connection) an org + user + deal (`cema_type='refi_cema'`, `status='recording'`) + an upstate property (`county='Nassau'`, `acris_bbl=null`). Then:
  - **Gated persist + enqueue:** call `persistCoverSheet(org.id, user.id, deal.id, { kind: 'county_cover_sheet', attorneyReviewRequired: true, title: 'x', fields: { dealId: deal.id, venue: 'county', county: 'Nassau', total: 595 } })`; assert a `documents` row exists (`kind='county_cover_sheet'`, `attorneyReviewRequired=true`, `status='draft'`); assert a `document_review_queue` row exists for it; assert a `document.submitted_for_review` audit (`source: 'recording-prep'`) exists.
  - **Non-gated persist (no enqueue):** call `persistCoverSheet(...)` with `{ kind: 'acris_cover_pages', attorneyReviewRequired: false, ... }`; assert the `documents` row exists but NO `document_review_queue` row was added for it.
  - **Coordinates:** call `persistRecordingCoordinates(org.id, deal.id, 'county', { reelPage: 'R123-P45', crfn: null }, '2026-06-02T00:00:00.000Z')`; re-select the deal and assert `metadata.recording.reelPage === 'R123-P45'` and `metadata.recording.crfn === null`.
  - **XOR guard:** `await expect(persistRecordingCoordinates(org.id, deal.id, 'county', { reelPage: 'x', crfn: 'y' }, 't')).rejects.toThrow()`.
  - **RLS:** a second org cannot see the document (cross-org isolation control), mirroring `doc-gen-persist.test.ts`.

- [ ] **Step 2: Run** `pnpm --filter web exec vitest run tests/integration/recording-prep-persist --no-file-parallelism` (with `.env.local`) → PASS; in CI (no `DATABASE_URL`) it skips-green.

- [ ] **Step 3: Commit**

```bash
git add apps/web/tests/integration/recording-prep-persist.test.ts
git commit -S -m "test(recording-prep): Neon-gated persist/enqueue/coordinate/RLS integration (skip-green)"
```

---

## Task 8: Trigger wiring — `recording → 'recording_prep'` (TDD)

**Files:** Modify `apps/web/lib/agents/on-deal-status-changed-core.ts`, `on-deal-status-changed-core.test.ts`, `on-deal-status-changed.ts`, `on-deal-status-changed.test.ts`.

- [ ] **Step 1: Extend the core test** — `on-deal-status-changed-core.test.ts`: (a) REMOVE `'recording'` from the `UNWIRED` array (it is now wired); (b) add the mapping assertion:

```ts
it("maps 'recording' to the recording_prep agent", () => {
  expect(triggerForStatus('recording')).toBe('recording_prep');
});
```

- [ ] **Step 2: Run → FAIL** (`pnpm --filter web exec vitest run lib/agents/on-deal-status-changed-core`). **Step 3: Extend `triggerForStatus`** in `on-deal-status-changed-core.ts`:
  - Add `'recording_prep'` to the `AgentTrigger` union: `export type AgentTrigger = 'collateral_pipeline' | 'outreach' | 'doc_gen' | 'recording_prep';`
  - Add a case before `default`: `case 'recording': return 'recording_prep';`
  - Update the JSDoc comment listing the triggers to mention `recording → 'recording_prep'`.

- [ ] **Step 4: Extend the dispatcher test** — `on-deal-status-changed.test.ts`: add the mock + import + a case (mirrors the `doc_prep` case):

```ts
// add alongside the other agent mocks:
vi.mock('./recording-prep/run-recording-prep', () => ({
  runRecordingPrep: vi.fn(),
}));
```

```ts
// add to imports:
import { runRecordingPrep } from './recording-prep/run-recording-prep';
```

```ts
// add to beforeEach:
vi.mocked(runRecordingPrep).mockResolvedValue(undefined);
```

```ts
// add the test case:
it("runs the recording-prep agent when a deal enters 'recording'", async () => {
  await onDealStatusChanged('deal-1', 'recording', CTX);

  expect(runRecordingPrep).toHaveBeenCalledWith('deal-1');
  expect(runCollateralPipeline).not.toHaveBeenCalled();
  expect(runOutreachFromDeal).not.toHaveBeenCalled();
  expect(runDocGen).not.toHaveBeenCalled();
});
```

Also extend the existing "does nothing for a status with no wired agent" assertions to include `expect(runRecordingPrep).not.toHaveBeenCalled();`.

- [ ] **Step 5: Run → FAIL.** **Step 6: Wire the dispatcher** in `on-deal-status-changed.ts`:
  - Import: `import { runRecordingPrep } from './recording-prep/run-recording-prep';`
  - In the trigger branch (alongside `collateral_pipeline`/`doc_gen`/else), add a branch. The existing shape is `if (trigger === 'collateral_pipeline') {...} else if (trigger === 'doc_gen') {...} else {...}` where the final `else` is `runOutreachFromDeal`. Convert the tail so each trigger is explicit:

```ts
if (trigger === 'collateral_pipeline') {
  await runCollateralPipeline(dealId);
} else if (trigger === 'doc_gen') {
  await runDocGen(dealId);
} else if (trigger === 'recording_prep') {
  await runRecordingPrep(dealId);
} else {
  await runOutreachFromDeal(dealId);
}
```

- [ ] **Step 7: Run → PASS** (`pnpm --filter web exec vitest run lib/agents/on-deal-status-changed`). **Step 8: Commit**

```bash
git add apps/web/lib/agents/on-deal-status-changed-core.ts apps/web/lib/agents/on-deal-status-changed-core.test.ts apps/web/lib/agents/on-deal-status-changed.ts apps/web/lib/agents/on-deal-status-changed.test.ts
git commit -S -m "feat(recording-prep): trigger runRecordingPrep on the recording deal_status transition"
```

---

## Task 9: Agent-activity labels for the `recording.*` audit actions (TDD)

**Files:** Modify `apps/web/lib/agent-activity/describe-audit-event.ts`, `describe-audit-event.test.ts`.

- [ ] **Step 1: Extend the test** — `describe-audit-event.test.ts`:

```ts
it('labels the recording agent actions', () => {
  expect(describeAuditEvent('recording.evaluated', {}).label).toBe('Recording prep evaluated');
  expect(describeAuditEvent('recording.prepared', {}).label).toBe('Recording package prepared');
  expect(describeAuditEvent('recording.completed', {}).label).toBe('Recording completed');
  expect(describeAuditEvent('recording.rejected', {}).label).toBe('Recording rejected');
});

it('builds PII-safe recording details from whitelisted fields', () => {
  expect(describeAuditEvent('recording.prepared', { count: 1 }).detail).toBe('1 cover sheets');
  expect(describeAuditEvent('recording.completed', { venue: 'acris' }).detail).toBe('via acris');
  expect(describeAuditEvent('recording.rejected', { reason: 'bad_legal_description' }).detail).toBe(
    'reason: bad_legal_description',
  );
});
```

- [ ] **Step 2: Run → FAIL** (`pnpm --filter web exec vitest run lib/agent-activity/describe-audit-event`). **Step 3: Add the labels + detail builders** in `describe-audit-event.ts`:

In `LABEL_BY_ACTION` (after the `docgen.*` entries):

```ts
  'recording.evaluated': 'Recording prep evaluated',
  'recording.prepared': 'Recording package prepared',
  'recording.completed': 'Recording completed',
  'recording.rejected': 'Recording rejected',
```

In `DETAIL_BY_ACTION`:

```ts
  'recording.evaluated': (m) => (typeof m.count === 'number' ? `${m.count} planned` : null),
  'recording.prepared': (m) => (typeof m.count === 'number' ? `${m.count} cover sheets` : null),
  'recording.completed': (m) => (typeof m.venue === 'string' ? `via ${m.venue}` : null),
  'recording.rejected': (m) => (typeof m.reason === 'string' ? `reason: ${m.reason}` : null),
```

- [ ] **Step 4: Run → PASS.** **Step 5: Commit**

```bash
git add apps/web/lib/agent-activity/describe-audit-event.ts apps/web/lib/agent-activity/describe-audit-event.test.ts
git commit -S -m "feat(recording-prep): agent-activity labels for the recording.* audit actions"
```

---

## Task 10: Full verification

- [ ] **Step 1: Format + lint + typecheck + tests**
  - `pnpm prettier --check "docs/plans/2026-06-02-recording-prep-agent*.md" "packages/agents/recording-prep/**/*.ts" "apps/web/lib/agents/recording-prep/**/*.ts"` (fix with `--write` if needed — recall lint-staged runs eslint AFTER prettier, so check before pushing).
  - `pnpm --filter web lint` → 0 errors.
  - `pnpm typecheck` → all packages clean. (Run this SEPARATELY from tests — vitest/esbuild is transpile-only, so a type error in the new package or the `documents` insert can pass tests yet fail the Typecheck CI job.)
  - `pnpm --filter @cema/agents-recording-prep test` → 15 (venue 5 + plan 8 + adapter 2).
  - `pnpm --filter web test` → new `run-recording-prep` 7 + the extended trigger + describe-audit-event cases; the Neon integration skips (no `DATABASE_URL`) or, run serially, passes.

- [ ] **Step 2:** If a full-parallel web run flakes on a Neon integration test, re-run `pnpm --filter web exec vitest run tests/integration/recording-prep-persist --no-file-parallelism` to confirm it is the shared-branch race, not a regression.

- [ ] **Step 3:** Commit any `pnpm format` fixups.

```bash
git add -A
git commit -S -m "chore(recording-prep): format + verification fixups" || echo "nothing to commit"
```

---

## Self-Review (author checklist — completed)

**1. Spec coverage:**

- Venue routing (design §3 `resolveVenue`) → Task 2. ✓
- Cover-sheet composition + fee math + load-time guards (§3 `planRecording`/`computeFees`) → Task 3. ✓
- Dormant adapter seam (§3 `FixtureRecordingAdapter`) → Task 4. ✓
- RLS loader + persist/enqueue + coordinates + idempotency (§4) → Tasks 5–6. ✓
- Dispatcher orchestration + split audit (`evaluated`/`prepared`/`completed`/`rejected`) + OTel span + single-pass submit/poll branches (§4) → Task 6. ✓
- Real-DB verification incl. the XOR guard + non-gated-no-enqueue (§8) → Task 7. ✓
- Trigger `recording → 'recording_prep'` (§5) → Task 8 (incl. removing `'recording'` from `UNWIRED`). ✓
- UI legibility labels (§6) → Task 9. ✓
- Hard rule #2 (gate): `county_cover_sheet` gated + enqueued; per-kind `GATE_SET` derivation + load-time consistency guard + DB CHECK backstop (§7) → Tasks 3, 5, 7. ✓
- Hard rule #3 (PII): fields in extractedData; audits/logs/spans carry venue/count/tokens only; rejection reason a static token (§7) → Tasks 3, 6 (PII test). ✓
- Hard rule #6 (recording): reel/page-XOR-CRFN to `deals.metadata`; agent never flips the deal to completed (§7) → Tasks 5–6. ✓
- Placeholders flagged (`RECORDING_FEE_SCHEDULE` / `ESTIMATED_CEMA_PAGE_COUNT`) (§1/§7) → Task 3 (named constants + comments). ✓

**2. Placeholder scan:** the one NOTE callout (identity resolution) is an explicit "copy `run-doc-gen.ts` verbatim" directive with the reference file named — not a vague TODO. Every code step shows complete code. No "TBD"/"implement later". ✓

**3. Type consistency:** `DealRecordingInput`/`VenueResolution`/`PlannedCoverSheet`/`FeeBreakdown`/`RecordingPlan`/`RecordingAdapter`/`RecordingSubmission`/`RecordingPollResult` (Task 2–4); `resolveVenue(input)`, `computeFees(county, pageCount)`, `planRecording(input)` (Task 2–3); `loadRecordingInput(orgId, dealId)`, `hasExistingRecordingPackage(orgId, dealId)`, `persistCoverSheet(orgId, actorId, dealId, sheet)`, `persistRecordingCoordinates(orgId, dealId, venue, ref, recordedAt)` (Task 5); `runRecordingPrep(dealId)` (Task 6); `triggerForStatus → 'recording_prep'` (Task 8); audits `recording.evaluated`/`recording.prepared`/`recording.completed`/`recording.rejected` + reused `document.submitted_for_review` consistent across Tasks 6, 7, 9. App imports use `../../`. ✓

```

```
