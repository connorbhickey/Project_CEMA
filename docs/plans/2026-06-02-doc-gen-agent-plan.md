# Doc-Gen Agent (v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan the core Refi-CEMA document package (deterministic), run a numbers-tie consistency check, and persist each document as a gate-required, enqueued, draft `documents` row with a field-map — behind a dormant DocMagic render seam — triggered by the `doc_prep` deal_status transition.

**Architecture:** New `@cema/agents-doc-gen` package (pure `planDocuments` + `FixtureDocGenAdapter`, reusing `@cema/collateral`'s `DocumentKind`/`GATE_REQUIRED_KINDS`). App-layer `runDocGen` dispatcher that RLS-reads the deal (mockable `loadDocGenInput`), plans, and persists via mockable `hasExistingPackage` + `persistGeneratedDocument` seams (idempotent; reuses the IDP enqueue). Wired into the agent dispatcher (`doc_prep → 'doc_gen'`). 0 migrations.

**Tech Stack:** TypeScript (strict, ESM), Vitest, Drizzle, `@cema/collateral`, `@cema/compliance`, `@cema/auth`, `@opentelemetry/api`.

**Design spec:** `docs/plans/2026-06-02-doc-gen-agent.md`

---

## Task 1: Scaffold `@cema/agents-doc-gen`

**Files:** Create `packages/agents/doc-gen/package.json`, `packages/agents/doc-gen/tsconfig.json`.

- [ ] **Step 1: `package.json`** (note the `@cema/collateral` runtime dep — reuses `GATE_REQUIRED_KINDS`)

```json
{
  "name": "@cema/agents-doc-gen",
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
git add packages/agents/doc-gen/package.json packages/agents/doc-gen/tsconfig.json pnpm-lock.yaml
git commit -S -m "feat(doc-gen): scaffold @cema/agents-doc-gen package"
```

---

## Task 2: Pure core — `types.ts` + `plan.ts` (TDD)

**Files:** Create `src/types.ts`, `src/plan.ts`; Test `src/plan.test.ts`.

- [ ] **Step 1: Write the failing test** — `packages/agents/doc-gen/src/plan.test.ts`

```ts
import { describe, expect, it } from 'vitest';

import { planDocuments } from './plan';
import type { DealDocGenInput } from './types';

const BASE: DealDocGenInput = {
  dealId: 'deal-1',
  cemaType: 'refi_cema',
  newPrincipal: 500000,
  existingLoans: [{ id: 'loan-1', upb: 300000 }],
  county: 'Kings',
  borrowerNames: ['Jane Doe'],
};

const kinds = (i: DealDocGenInput) =>
  planDocuments(i)
    .documents.map((d) => d.kind)
    .sort();

describe('planDocuments', () => {
  it('plans the always-docs + gap docs + one aom per loan for a clean refi with new money', () => {
    const plan = planDocuments(BASE);
    expect(plan.consistency.ok).toBe(true);
    expect(plan.gap).toBe(200000);
    expect(kinds(BASE)).toEqual(
      [
        'aff_255',
        'aff_275',
        'aom',
        'cema_3172',
        'consolidated_note',
        'gap_mortgage',
        'gap_note',
        'mt_15',
      ].sort(),
    );
  });

  it('omits gap_note/gap_mortgage when gap is zero (no new money)', () => {
    const plan = planDocuments({ ...BASE, newPrincipal: 300000 });
    expect(plan.gap).toBe(0);
    expect(plan.documents.some((d) => d.kind === 'gap_note')).toBe(false);
    expect(plan.documents.some((d) => d.kind === 'gap_mortgage')).toBe(false);
  });

  it('emits one aom per existing loan', () => {
    const plan = planDocuments({
      ...BASE,
      newPrincipal: 900000,
      existingLoans: [
        { id: 'l1', upb: 100000 },
        { id: 'l2', upb: 200000 },
      ],
    });
    expect(plan.documents.filter((d) => d.kind === 'aom')).toHaveLength(2);
  });

  it('every generated document is attorney-review-required (hard rule #2)', () => {
    for (const d of planDocuments(BASE).documents) {
      expect(d.attorneyReviewRequired).toBe(true);
    }
  });

  it('flags numbers_do_not_tie + plans nothing when UPB exceeds the new loan', () => {
    const plan = planDocuments({
      ...BASE,
      newPrincipal: 200000,
      existingLoans: [{ id: 'l', upb: 300000 }],
    });
    expect(plan.consistency.ok).toBe(false);
    expect(plan.consistency.issues).toContain('numbers_do_not_tie');
    expect(plan.documents).toEqual([]);
  });

  it('flags non-refi / no-loans / non-positive-principal and plans nothing', () => {
    expect(planDocuments({ ...BASE, cemaType: 'purchase_cema' }).consistency.issues).toContain(
      'not_refi_cema',
    );
    expect(planDocuments({ ...BASE, existingLoans: [] }).consistency.issues).toContain(
      'no_existing_loans',
    );
    expect(planDocuments({ ...BASE, newPrincipal: 0 }).consistency.issues).toContain(
      'new_principal_not_positive',
    );
    expect(planDocuments({ ...BASE, cemaType: 'purchase_cema' }).documents).toEqual([]);
  });

  it('issues + titles are static PII-free strings (no digits)', () => {
    const plan = planDocuments(BASE);
    for (const d of plan.documents) expect(d.title).not.toMatch(/\d/);
    const bad = planDocuments({ ...BASE, newPrincipal: 1, existingLoans: [{ id: 'l', upb: 9 }] });
    for (const issue of bad.consistency.issues) expect(issue).not.toMatch(/\d/);
  });
});
```

- [ ] **Step 2: Run → FAIL** (`pnpm --filter @cema/agents-doc-gen test`) — module not found.

- [ ] **Step 3: Implement `types.ts`** (exactly the interfaces from design §3: `DealDocGenInput`, `PlannedDocument`, `ConsistencyResult`, `DocumentPlan`, `RenderResult`, `DocGenAdapter` — copy from the design spec, importing `type { DocumentKind } from '@cema/collateral'`).

- [ ] **Step 4: Implement `plan.ts`**

```ts
import { GATE_REQUIRED_KINDS, type DocumentKind } from '@cema/collateral';

import type { DealDocGenInput, DocumentPlan, PlannedDocument } from './types';

const GATE_SET = new Set<DocumentKind>(GATE_REQUIRED_KINDS);

// The kinds this v1 emits (Refi-CEMA core). Titles are static + PII-free.
const TITLE_BY_KIND = {
  cema_3172: 'CEMA (NY Form 3172)',
  consolidated_note: 'Consolidated Note',
  gap_note: 'Gap Note',
  gap_mortgage: 'Gap Mortgage',
  aff_255: 'NY Tax Law Section 255 Affidavit',
  aff_275: 'NY Tax Law Section 275 Affidavit',
  mt_15: 'MT-15 Mortgage Recording Tax Return',
  aom: 'Assignment of Mortgage',
} satisfies Partial<Record<DocumentKind, string>>;

type EmittedKind = keyof typeof TITLE_BY_KIND;

// Load-time guard: every emitted kind must be gate-required (hard rule #2) and titled.
for (const kind of Object.keys(TITLE_BY_KIND) as EmittedKind[]) {
  if (!GATE_SET.has(kind)) {
    throw new Error(`doc-gen emits a non-gate-required kind "${kind}" (hard rule #2)`);
  }
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

function make(
  kind: EmittedKind,
  input: DealDocGenInput,
  fields: Record<string, string | number>,
): PlannedDocument {
  return {
    kind,
    attorneyReviewRequired: GATE_SET.has(kind),
    title: TITLE_BY_KIND[kind],
    fields: { dealId: input.dealId, ...fields },
  };
}

/**
 * Pure, deterministic Refi-CEMA document planner (spec §9.7). Computes the gap,
 * runs the numbers-tie consistency check, and (only if consistent) returns the
 * core document set: always cema_3172/consolidated_note/aff_255/aff_275/mt_15;
 * gap_note + gap_mortgage when gap > 0; one aom per existing loan. No clock, no
 * LLM, no IO. PII-safe by construction (static titles + issue tokens).
 */
export function planDocuments(input: DealDocGenInput): DocumentPlan {
  const totalUpb = round2(input.existingLoans.reduce((s, l) => s + l.upb, 0));
  const gap = round2(input.newPrincipal - totalUpb);

  const issues: string[] = [];
  if (input.cemaType !== 'refi_cema') issues.push('not_refi_cema');
  if (input.existingLoans.length === 0) issues.push('no_existing_loans');
  if (input.newPrincipal <= 0) issues.push('new_principal_not_positive');
  if (gap < 0) issues.push('numbers_do_not_tie');

  const consistency = { ok: issues.length === 0, issues };
  if (!consistency.ok) return { documents: [], consistency, gap };

  const documents: PlannedDocument[] = [
    make('cema_3172', input, {
      county: input.county,
      newPrincipal: input.newPrincipal,
      totalUpb,
      gap,
    }),
    make('consolidated_note', input, { newPrincipal: input.newPrincipal, totalUpb }),
    make('aff_255', input, { totalUpb }),
    make('aff_275', input, { totalUpb }),
    make('mt_15', input, { gap, county: input.county }),
  ];
  if (gap > 0) {
    documents.push(make('gap_note', input, { gap }));
    documents.push(make('gap_mortgage', input, { gap, county: input.county }));
  }
  for (const loan of input.existingLoans) {
    documents.push(make('aom', input, { existingLoanId: loan.id, upb: loan.upb }));
  }
  return { documents, consistency, gap };
}
```

- [ ] **Step 5: Run → PASS** (7 tests). **Step 6: Commit**

```bash
git add packages/agents/doc-gen/src/types.ts packages/agents/doc-gen/src/plan.ts packages/agents/doc-gen/src/plan.test.ts
git commit -S -m "feat(doc-gen): pure planDocuments core (Refi-CEMA package + numbers-tie check)"
```

---

## Task 3: `FixtureDocGenAdapter` + `index.ts` (TDD)

**Files:** Create `src/adapter.ts`, `src/index.ts`; Test `src/adapter.test.ts`.

- [ ] **Step 1: Failing test** — `src/adapter.test.ts`

```ts
import { describe, expect, it } from 'vitest';

import { FixtureDocGenAdapter } from './adapter';

describe('FixtureDocGenAdapter', () => {
  it('is dormant — reports not rendered, no blob', async () => {
    const adapter = new FixtureDocGenAdapter();
    const result = await adapter.render({
      kind: 'cema_3172',
      attorneyReviewRequired: true,
      title: 'CEMA (NY Form 3172)',
      fields: { dealId: 'deal-1' },
    });
    expect(result.rendered).toBe(false);
    expect(result.blobUrl).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run → FAIL.** **Step 3: Implement `adapter.ts`**

```ts
import type { DocGenAdapter, PlannedDocument, RenderResult } from './types';

/**
 * Dormant default render adapter. Reports not-rendered without producing a blob
 * -- the wiring default until a real DocMagic adapter is provisioned (vendor key
 * + NY form templates). Also the test double for the dispatcher guard.
 */
export class FixtureDocGenAdapter implements DocGenAdapter {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  render(_doc: PlannedDocument): Promise<RenderResult> {
    return Promise.resolve({ rendered: false });
  }
}
```

- [ ] **Step 4: Implement `index.ts`**

```ts
export * from './types';
export * from './plan';
export * from './adapter';
```

- [ ] **Step 5: Run test + typecheck → PASS (8 total).** **Step 6: Commit**

```bash
git add packages/agents/doc-gen/src/adapter.ts packages/agents/doc-gen/src/adapter.test.ts packages/agents/doc-gen/src/index.ts
git commit -S -m "feat(doc-gen): dormant FixtureDocGenAdapter + package barrel"
```

---

## Task 4: App loader + persistence seams + adapter instance

**Files:** Modify `apps/web/package.json` (+ dep, run `pnpm install`); Create `apps/web/lib/agents/doc-gen/{deal-data.ts,persist.ts,adapter.ts}`.

- [ ] **Step 1: Add dep** — `apps/web/package.json` dependencies, before `@cema/agents-exception-triage`:

```json
    "@cema/agents-doc-gen": "workspace:*",
```

Run `pnpm install`.

- [ ] **Step 2: `apps/web/lib/agents/doc-gen/adapter.ts`**

```ts
import { FixtureDocGenAdapter, type DocGenAdapter } from '@cema/agents-doc-gen';

// Dormant FixtureDocGenAdapter today; the swap point for a real DocMagic adapter.
export const docGenAdapter: DocGenAdapter = new FixtureDocGenAdapter();
```

- [ ] **Step 3: `apps/web/lib/agents/doc-gen/deal-data.ts`** (RLS loader)

```ts
import { type DealDocGenInput } from '@cema/agents-doc-gen';
import { deals, existingLoans, newLoans, parties, properties } from '@cema/db';
import { and, eq, inArray } from 'drizzle-orm';

import { withRls } from '../../with-rls';

/**
 * RLS-read the data planDocuments needs: the deal (cemaType), its new-loan
 * principal, property county, existing-loan UPBs, and borrower/co_borrower names.
 * Returns null if the deal or its required relations are missing. A mockable seam.
 */
export async function loadDocGenInput(
  organizationId: string,
  dealId: string,
): Promise<DealDocGenInput | null> {
  return withRls(organizationId, async (tx) => {
    const [deal] = await tx.select().from(deals).where(eq(deals.id, dealId)).limit(1);
    if (!deal || !deal.newLoanId || !deal.propertyId) return null;

    const [newLoan] = await tx
      .select()
      .from(newLoans)
      .where(eq(newLoans.id, deal.newLoanId))
      .limit(1);
    const [property] = await tx
      .select()
      .from(properties)
      .where(eq(properties.id, deal.propertyId))
      .limit(1);
    if (!newLoan || !property) return null;

    const loans = await tx
      .select({ id: existingLoans.id, upb: existingLoans.upb })
      .from(existingLoans)
      .where(eq(existingLoans.dealId, dealId));

    const borrowerRows = await tx
      .select({ fullName: parties.fullName })
      .from(parties)
      .where(and(eq(parties.dealId, dealId), inArray(parties.role, ['borrower', 'co_borrower'])));

    return {
      dealId,
      cemaType: deal.cemaType,
      newPrincipal: Number(newLoan.principal),
      existingLoans: loans.map((l) => ({ id: l.id, upb: Number(l.upb) })),
      county: property.county,
      borrowerNames: borrowerRows.map((b) => b.fullName).filter((n): n is string => !!n),
    };
  });
}
```

- [ ] **Step 4: `apps/web/lib/agents/doc-gen/persist.ts`** (idempotency check + per-doc persist)

```ts
import { type PlannedDocument } from '@cema/agents-doc-gen';
import { emitAuditEvent } from '@cema/compliance';
import { documentReviewQueue, documents } from '@cema/db';
import { and, eq } from 'drizzle-orm';

import { withRls } from '../../with-rls';

/** Idempotency: a deal has exactly one cema_3172. If one exists, the package was
 *  already generated -> the run is a no-op. */
export async function hasExistingPackage(organizationId: string, dealId: string): Promise<boolean> {
  return withRls(organizationId, async (tx) => {
    const [row] = await tx
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.dealId, dealId), eq(documents.kind, 'cema_3172')))
      .limit(1);
    return !!row;
  });
}

/**
 * Insert one generated document (draft, gate flag from the plan, field-map in
 * extractedData, no blob yet) and enqueue it into the attorney review queue
 * (idempotent; emits document.submitted_for_review on a real insert) -- the IDP
 * pattern. Co-transactional within one withRls.
 */
export async function persistGeneratedDocument(
  organizationId: string,
  actorUserId: string,
  dealId: string,
  doc: PlannedDocument,
): Promise<void> {
  await withRls(organizationId, async (tx) => {
    const [inserted] = await tx
      .insert(documents)
      .values({
        organizationId,
        dealId,
        kind: doc.kind,
        status: 'draft',
        attorneyReviewRequired: doc.attorneyReviewRequired,
        extractedData: doc.fields,
      })
      .returning({ id: documents.id, version: documents.version });
    if (!inserted) return;

    if (doc.attorneyReviewRequired) {
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
      if (queued) {
        await emitAuditEvent(tx, {
          organizationId,
          actorUserId,
          action: 'document.submitted_for_review',
          entityType: 'document',
          entityId: inserted.id,
          metadata: { queueId: queued.id, version: inserted.version, source: 'doc-gen' },
        });
      }
    }
  });
}
```

> NOTE: confirm `documents` has an `organizationId` column when implementing (it may be deal-owned via RLS only). If there is no `organizationId` column on `documents`, drop it from the insert — RLS scopes by deal/org. Check `packages/db/src/schema/documents.ts` first and match its insert shape (the IDP `persistDocuments` is the reference).

- [ ] **Step 5: Commit** (after Task 5's test is green — these seams are exercised by the dispatcher test + the Neon integration in Task 6; commit together with Task 5).

---

## Task 5: App dispatcher — `runDocGen` (TDD)

**Files:** Create `apps/web/lib/agents/doc-gen/run-doc-gen.ts`; Test `apps/web/lib/agents/doc-gen/run-doc-gen.test.ts`.

- [ ] **Step 1: Failing test** — `run-doc-gen.test.ts`

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@cema/auth', () => ({
  getCurrentOrganizationId: vi.fn().mockResolvedValue('clerk-org-1'),
  getCurrentUser: vi.fn().mockResolvedValue({ id: 'clerk-user-1' }),
}));
vi.mock('./deal-data', () => ({ loadDocGenInput: vi.fn() }));
vi.mock('./persist', () => ({ hasExistingPackage: vi.fn(), persistGeneratedDocument: vi.fn() }));
vi.mock('@cema/compliance', async (o) => ({
  ...(await o<typeof import('@cema/compliance')>()),
  emitAuditEvent: vi.fn(),
}));
vi.mock('../../with-rls', () => ({
  withRls: vi.fn((_o: string, cb: (tx: unknown) => unknown) => cb({})),
}));
// resolveActor returns {organizationId, actorUserId}; mock it if extracted, else mock the org/user lookups.
vi.mock('../../actor', () => ({
  resolveActor: vi.fn().mockResolvedValue({ organizationId: 'org-1', actorUserId: 'user-1' }),
}));

import { emitAuditEvent } from '@cema/compliance';

import { loadDocGenInput } from './deal-data';
import { hasExistingPackage, persistGeneratedDocument } from './persist';
import { runDocGen } from './run-doc-gen';

const INPUT = {
  dealId: 'deal-1',
  cemaType: 'refi_cema',
  newPrincipal: 500000,
  existingLoans: [{ id: 'l1', upb: 300000 }],
  county: 'Kings',
  borrowerNames: ['Jane Doe'],
};

beforeEach(() => {
  vi.mocked(hasExistingPackage).mockResolvedValue(false);
  vi.mocked(loadDocGenInput).mockResolvedValue(INPUT as never);
  vi.mocked(persistGeneratedDocument).mockResolvedValue(undefined);
  vi.mocked(emitAuditEvent).mockResolvedValue(undefined);
});
afterEach(() => vi.clearAllMocks());

describe('runDocGen', () => {
  it('persists each planned document + split-audits on a clean refi', async () => {
    await runDocGen('deal-1');
    // clean refi w/ gap>0 + 1 loan => 8 docs
    expect(persistGeneratedDocument).toHaveBeenCalledTimes(8);
    const actions = vi.mocked(emitAuditEvent).mock.calls.map((c) => c[1].action);
    expect(actions).toContain('docgen.evaluated');
    expect(actions).toContain('docgen.generated');
  });

  it('skips (idempotent) when a cema_3172 already exists', async () => {
    vi.mocked(hasExistingPackage).mockResolvedValue(true);
    await runDocGen('deal-1');
    expect(loadDocGenInput).not.toHaveBeenCalled();
    expect(persistGeneratedDocument).not.toHaveBeenCalled();
  });

  it('records docgen.inconsistent + persists nothing when numbers do not tie', async () => {
    vi.mocked(loadDocGenInput).mockResolvedValue({ ...INPUT, newPrincipal: 100000 } as never);
    await runDocGen('deal-1');
    expect(persistGeneratedDocument).not.toHaveBeenCalled();
    expect(vi.mocked(emitAuditEvent).mock.calls.map((c) => c[1].action)).toContain(
      'docgen.inconsistent',
    );
  });

  it('no-ops when the deal data is missing', async () => {
    vi.mocked(loadDocGenInput).mockResolvedValue(null);
    await runDocGen('deal-1');
    expect(persistGeneratedDocument).not.toHaveBeenCalled();
  });

  it('audit metadata is PII-safe (no borrower name / amounts)', async () => {
    await runDocGen('deal-1');
    for (const call of vi.mocked(emitAuditEvent).mock.calls) {
      const meta = JSON.stringify(call[1].metadata ?? {});
      expect(meta).not.toContain('Jane Doe');
      expect(meta).not.toContain('500000');
    }
  });
});
```

> NOTE: identity resolution — match how `runOutreachFromDeal` resolves org/actor (it calls `getCurrentOrganizationId`/`getCurrentUser` then maps clerk→internal ids inside a `withRls`). If a shared `resolveActor` helper does not exist, inline that resolution in `run-doc-gen.ts` and mock `@cema/auth` + the org/user lookups in the test instead of `../../actor`. Read `run-outreach-action.ts` and mirror it exactly.

- [ ] **Step 2: Run → FAIL.** **Step 3: Implement `run-doc-gen.ts`** — orchestrate: resolve org+actor (mirror `runOutreachFromDeal`); `tracer.startActiveSpan('docgen.run', ...)` with PII-safe attrs (`docgen.deal_id`, `docgen.document_count`, `docgen.consistent`); `if (await hasExistingPackage(org, dealId)) return;`; `const input = await loadDocGenInput(org, dealId); if (!input) return;`; `const plan = planDocuments(input);`; emit `docgen.evaluated` (`{ count: plan.documents.length, consistent: plan.consistency.ok }`); if `!plan.consistency.ok` emit `docgen.inconsistent` (`{ issues: plan.consistency.issues }`) + return; else `for (const doc of plan.documents) { await persistGeneratedDocument(org, actor, dealId, doc); await docGenAdapter.render(doc); }` then emit `docgen.generated` (`{ count: plan.documents.length }`). All audits via `withRls(org, tx => emitAuditEvent(tx, {... actorUserId: actor ...}))`. (Run is invoked from the best-effort dispatcher, which swallows + records `deal.agent_dispatch_failed` — no per-run try/catch needed here; the run may throw and the dispatcher handles it.)

- [ ] **Step 4: Run → PASS (5 tests).** **Step 5: Commit** (with Task 4's seams)

```bash
git add apps/web/lib/agents/doc-gen/ apps/web/package.json pnpm-lock.yaml
git commit -S -m "feat(doc-gen): runDocGen dispatcher + RLS loader + persist/enqueue seams"
```

---

## Task 6: Neon integration test for the real persist (skip-green)

**Files:** Create `apps/web/tests/integration/doc-gen-persist.test.ts`.

- [ ] **Step 1: Write the integration test** — `describe.skipIf(!process.env.DATABASE_URL)`. Seed (owner connection) an org + user + deal (`cema_type='refi_cema'`) + property + newLoan + existing_loan, all under a unique stable namespace (e.g. ids prefixed `dg1`, clerkOrgId `dgci1` — see [[neon-integration-test-parallel-flake]]). Then:
  - Call `persistGeneratedDocument(org.id, user.id, deal.id, { kind: 'cema_3172', attorneyReviewRequired: true, title: 'x', fields: { dealId: deal.id } })`; assert a `documents` row exists with `attorneyReviewRequired = true`, `status = 'draft'`; assert a `document_review_queue` row exists for it; assert a `document.submitted_for_review` audit exists.
  - Idempotent enqueue: call again with the SAME inserted document path is not applicable (new insert each call) — instead assert calling `hasExistingPackage` returns `true` after a `cema_3172` exists.
  - RLS: a second org cannot see the document (cross-org isolation positive/negative control).

  (Model it on `apps/web/tests/integration/idp-auto-enqueue.test.ts` — same enqueue + audit assertions.)

- [ ] **Step 2: Run** `pnpm --filter web exec vitest run tests/integration/doc-gen-persist --no-file-parallelism` (with `.env.local`) → PASS; in CI (no `DATABASE_URL`) it skips-green.

- [ ] **Step 3: Commit**

```bash
git add apps/web/tests/integration/doc-gen-persist.test.ts
git commit -S -m "test(doc-gen): Neon-gated persist/enqueue/RLS integration (skip-green)"
```

---

## Task 7: Trigger wiring — `doc_prep → 'doc_gen'` (TDD)

**Files:** Modify `apps/web/lib/agents/on-deal-status-changed-core.ts`, `on-deal-status-changed.ts`, and their tests.

- [ ] **Step 1: Extend the core test** — in `on-deal-status-changed-core.test.ts` (or wherever `triggerForStatus` is unit-tested), add:

```ts
it("maps 'doc_prep' to the doc_gen trigger", () => {
  expect(triggerForStatus('doc_prep')).toBe('doc_gen');
});
```

- [ ] **Step 2: Run → FAIL.** **Step 3: Extend `triggerForStatus`** in `on-deal-status-changed-core.ts`: add `'doc_gen'` to the `AgentTrigger` union and a `case 'doc_prep': return 'doc_gen';`.

- [ ] **Step 4: Extend the dispatcher test** — `on-deal-status-changed.test.ts`: `vi.mock('./doc-gen/run-doc-gen', () => ({ runDocGen: vi.fn() }))`; import `runDocGen`; add a case asserting `await onDealStatusChanged('deal-1', 'doc_prep', CTX)` calls `runDocGen('deal-1')`.

- [ ] **Step 5: Run → FAIL.** **Step 6: Wire the dispatcher** in `on-deal-status-changed.ts`: import `runDocGen`; in the `trigger` switch/branch, add `if (trigger === 'doc_gen') { await runDocGen(dealId); }` (alongside the existing `collateral_pipeline`/`outreach` branches), keeping the existing best-effort try/catch + `deal.agent_dispatch_failed` audit wrapping it.

- [ ] **Step 7: Run → PASS.** **Step 8: Commit**

```bash
git add apps/web/lib/agents/on-deal-status-changed-core.ts apps/web/lib/agents/on-deal-status-changed-core.test.ts apps/web/lib/agents/on-deal-status-changed.ts apps/web/lib/agents/on-deal-status-changed.test.ts
git commit -S -m "feat(doc-gen): trigger runDocGen on the doc_prep deal_status transition"
```

---

## Task 8: Full verification

- [ ] **Step 1:** `pnpm format:check` (only the git-ignored `.well-known/workflow/*` artifacts may warn); `pnpm --filter web lint` (0 errors); `pnpm typecheck` (all packages); `pnpm --filter @cema/agents-doc-gen test` (8); `pnpm --filter web test` (new run-doc-gen 5 + trigger cases; the Neon integration skips or, run serially, passes). If a full-parallel web run flakes on a Neon integration test, re-run `pnpm --filter web exec vitest run tests/integration --no-file-parallelism` to confirm it is the shared-branch race, not a regression.

- [ ] **Step 2:** Commit any `pnpm format` fixups.

---

## Self-Review (author checklist — completed)

**1. Spec coverage:** pure planner + consistency (§3 → Task 2), dormant render seam (§3 → Task 3), RLS loader + persist/enqueue + idempotency (§4 → Tasks 4–5), dispatcher orchestration + split audit + span (§4 → Task 5), real-DB verification (§6/§7 → Task 6), trigger (§5 → Task 7), hard-rule-#2 gate (§6 — load-time guard in `plan.ts` + DB CHECK + enqueue), PII (§6 — field-map in extractedData, PII-free audits), testing (§7 → all). ✓

**2. Placeholder scan:** the two NOTE callouts (documents insert shape; identity resolution) are explicit "verify against existing code X and mirror it" directives with the reference file named — not vague TODOs. Every code step shows complete code. ✓

**3. Type consistency:** `DealDocGenInput`/`PlannedDocument`/`DocumentPlan`/`DocGenAdapter` (Task 2–3), `loadDocGenInput(orgId, dealId)`, `hasExistingPackage(orgId, dealId)`, `persistGeneratedDocument(orgId, actorId, dealId, doc)`, `runDocGen(dealId)`, `triggerForStatus → 'doc_gen'`, audits `docgen.evaluated`/`docgen.generated`/`docgen.inconsistent` + reused `document.submitted_for_review` — consistent across tasks. App imports use `../../`. ✓
