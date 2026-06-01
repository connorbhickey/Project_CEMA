# Deal-Scoped Review Surface Implementation Plan (M14 Slice 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `/deals/[id]/documents` route that renders IDP-classified collateral instruments (with the gate-required ones surfaced for attorney action) and the Chain-of-Title `re_chase` / `attorney_review` findings for a single deal.

**Architecture:** Two RLS-scoped server loaders read already-persisted state — `getDealDocumentsReview` left-joins `documents` to `document_review_queue`; `getDealChainFindings` reads `documents.extractedData`, then recomputes findings live via the pure `analyzeChain` + `route` core (no migration, no persistence). An RSC page renders both; a small client island adds one affordance (submit-when-unqueued) on top of the existing `ReviewDetailPanel`. Reuses the entire existing approval pipeline (`submitForReview → claimReview → approveDocument / rejectDocument`) unchanged.

**Tech Stack:** Next.js 16 (App Router / RSC / Server Actions), TypeScript strict, Drizzle + Neon Postgres, `@cema/agents-chain-of-title` (pure core), `@cema/collateral` (`InstrumentRecord` vocabulary), `@cema/attorney` (`ReviewState`), Tailwind, Vitest (node env).

**Spec:** `docs/superpowers/specs/2026-05-31-deal-review-surface-design.md`

**Resolves:** ADR 0015 carry-over #4 (deal-scoped attorney-review surface — rendering half) + ADR 0016 carry-over #1 (render Chain-of-Title `re_chase` / `attorney_review` findings — rendering half).

---

## Branch & PR strategy

- **PR-1** reuses the existing `feat/m14-slice3-review-surface` branch (it already holds the committed spec). Tasks 1–3.
- **PR-2** and **PR-3** each branch fresh off `main` after the prior PR merges. Tasks 4–8 (PR-2), Tasks 9–10 (PR-3).
- Every commit signed (`-S`). Auto-merge each PR: `gh pr merge <n> --auto --squash --delete-branch`.
- Co-author trailer on every commit: `Co-authored-by: Claude Opus 4.7 <noreply@anthropic.com>`.
- Run all `pnpm` / `git` / `gh` via Bash, each prefixed `cd "C:/Users/conno/Code/Project_CEMA_v1.0.0" &&`.

---

## File Structure

| File                                                                                | Responsibility                                                                                                                                      | PR   |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `apps/web/package.json`                                                             | Add `@cema/collateral` workspace dep (the loaders import `InstrumentRecord` from its canonical home, not via the IDP re-export).                    | PR-1 |
| `apps/web/lib/queries/deal-chain-findings.ts`                                       | `getDealChainFindings` loader + `isInstrumentRecord` type guard + `DealChainFindings` type. RLS read of `documents.extractedData` → pure recompute. | PR-1 |
| `apps/web/lib/queries/deal-chain-findings.test.ts`                                  | Unit: recompute correctness (clean / missing-assignment / lost-note / empty / no-org). Real chain-of-title core, mocked RLS+DB boundary.            | PR-1 |
| `apps/web/lib/queries/deal-documents-review.ts`                                     | `getDealDocumentsReview` loader + `DealDocumentReviewItem` type. RLS left-join `documents ⟕ document_review_queue`, gate-first ordering.            | PR-1 |
| `apps/web/lib/queries/deal-documents-review.test.ts`                                | Unit: join shape, ordering, `reviewerIsCurrentUser`, null handling, no-org.                                                                         | PR-1 |
| `apps/web/lib/review-action-mode.ts`                                                | Pure `reviewActionMode` helper — the client island's decision logic, node-testable.                                                                 | PR-2 |
| `apps/web/lib/review-action-mode.test.ts`                                           | Unit: the three modes.                                                                                                                              | PR-2 |
| `apps/web/components/deal-document-review-actions.tsx`                              | Client island: `submit` mode (unqueued + gate-required) vs `review` mode (wraps existing `ReviewDetailPanel`) vs `none`.                            | PR-2 |
| `apps/web/app/(app)/deals/[id]/documents/page.tsx`                                  | RSC page: Section 1 instruments table + Section 2 chain findings.                                                                                   | PR-2 |
| `apps/web/app/(app)/deals/[id]/page.tsx`                                            | Add a nav link to `/documents` (minimal, between `<h1>` and the grid).                                                                              | PR-2 |
| `apps/web/tests/integration/deal-review-surface.test.ts`                            | Neon-gated: deal-scoped read + gate-first ordering + clean-chain recompute + cross-org RLS isolation.                                               | PR-2 |
| `docs/adr/0015-phase-1-month-13-collateral-idp.md`                                  | Annotate carry-over #4 rendering half resolved; record auto-enqueue fast-follow.                                                                    | PR-3 |
| `docs/adr/0016-phase-1-month-13-chain-of-title.md`                                  | Annotate carry-over #1 rendering half resolved; actuator half still open.                                                                           | PR-3 |
| `CLAUDE.md`                                                                         | §2 Phase line + Next step + counts; Changelog row.                                                                                                  | PR-3 |
| `~/.claude/.../memory/status-2026-05-31-m14-slice3-review-surface.md` + `MEMORY.md` | Memory status file + index pointer.                                                                                                                 | PR-3 |

---

## Verified interface facts (do not re-derive)

- `@cema/agents-chain-of-title` exports: `analyzeChain(instruments: readonly InstrumentRecord[]): ChainAnalysis`, `route(dealId: string, breaks: readonly ChainBreak[]): RouteDecision[]`, and (via `export * from './types'`) the types `ChainStatus = 'clean' | 'broken' | 'ambiguous'`, `RouteKind = 'advisory_pass' | 're_chase' | 'attorney_review'`, `ChainAnalysis = { status, edges, breaks }`, `RouteDecision = { dealId, kind: RouteKind, documentId: string | null, reason: string }`.
- `route(dealId, [])` returns exactly `[{ dealId, kind: 'advisory_pass', documentId: null, reason: '…advisory pass.' }]`. Non-empty breaks map each via `ROUTE_BY_BREAK` (`missing_assignment → re_chase`; `lost_note` / `ambiguous_assignment` / `unrecorded_instrument → attorney_review`).
- `@cema/collateral` exports `InstrumentRecord` = `{ documentId, instrumentKind: DocumentKind, assignor: string|null, assignee: string|null, executedAt: string|null, recordedAt: string|null, amount: number|null, recordingRef: { reelPage: string|null, crfn: string|null }, county: string|null, references: string|null }`.
- `@cema/attorney` exports `ReviewState = 'pending' | 'claimed' | 'approved' | 'rejected'`.
- `documentReviewQueue` columns: `id`, `organizationId`, `documentId`, `documentVersion`, `submittedById`, `submittedAt`, `state`, `reviewerId`, `claimedAt`, `decidedAt`, `rejectionReason`, `createdAt`, `updatedAt`.
- `documents` columns relevant here: `id`, `dealId`, `kind`, `status`, `version`, `attorneyReviewRequired`, `extractedData` (jsonb, `.$type<Record<string, unknown>>().default({}).notNull()`).
- Canonical loader pattern (from `apps/web/lib/actions/get-deal.ts`): `getCurrentOrganizationId()` → `getDb()` → `db.query.organizations.findFirst({ where: eq(organizations.clerkOrgId, clerkOrgId) })` → `if (!org) return <empty>` → `withRls(org.id, async (tx) => { …query through tx… })`.
- User resolution (from `submit-for-review.ts`): `getCurrentUser()` → `db.query.users.findFirst({ where: eq(users.clerkUserId, clerkUser.id) })` → internal `users.id`.
- `withRls` imported as `@/lib/with-rls` from page/query files; the IDP write casts `instrument as unknown as Record<string, unknown>` for the jsonb column (mirror this in the integration seed).
- `ReviewDetailPanel` (in `apps/web/components/review-detail-panel.tsx`) is a named export with props `{ queueId: string; state: 'pending'|'claimed'|'approved'|'rejected'; reviewerIsCurrentUser: boolean }`.
- `@cema/ui` exports only `Button`, `Card`, `CardContent`, `CardHeader`, `CardTitle`, `Input`, `Label`, `cn` — **no Table/Badge** → use semantic HTML + Tailwind.
- apps/web vitest env is `node` (no jsdom / testing-library) → **no `.test.tsx` React render tests**; UI verified by the Neon integration test + browser.

---

# PR-1 — Data loaders + tests (no UI)

### Task 1: Add `@cema/collateral` to apps/web dependencies

**Files:**

- Modify: `apps/web/package.json` (deps block — insert between `@cema/cache` and `@cema/compliance`)

- [ ] **Step 1: Add the dependency line**

In `apps/web/package.json`, the dependencies currently read:

```json
    "@cema/cache": "workspace:*",
    "@cema/compliance": "workspace:*",
```

Change to:

```json
    "@cema/cache": "workspace:*",
    "@cema/collateral": "workspace:*",
    "@cema/compliance": "workspace:*",
```

- [ ] **Step 2: Install**

Run: `cd "C:/Users/conno/Code/Project_CEMA_v1.0.0" && pnpm install`
Expected: lockfile updates, `@cema/collateral` linked into `apps/web`; no errors.

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/conno/Code/Project_CEMA_v1.0.0" && git add apps/web/package.json pnpm-lock.yaml && git commit -S -m "$(cat <<'EOF'
chore(m14-s3): add @cema/collateral dep to apps/web

The deal-review loaders import InstrumentRecord from its canonical
@cema/collateral home rather than via the IDP agent re-export, keeping
the app decoupled from the agent package's type surface.

Co-authored-by: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `getDealChainFindings` loader + `isInstrumentRecord` guard

**Files:**

- Create: `apps/web/lib/queries/deal-chain-findings.ts`
- Test: `apps/web/lib/queries/deal-chain-findings.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/queries/deal-chain-findings.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the auth + DB + RLS boundary. Leave the chain-of-title pure core and
// @cema/collateral REAL — we are exercising the real recompute.
const findFirstOrg = vi.fn();

vi.mock('@cema/auth', () => ({
  getCurrentOrganizationId: () => Promise.resolve('clerk-org'),
  getCurrentUser: () => Promise.resolve({ id: 'clerk-user' }),
}));

vi.mock('@cema/db', () => ({
  getDb: () => ({ query: { organizations: { findFirst: findFirstOrg } } }),
  documents: {
    id: 'documents.id',
    dealId: 'documents.dealId',
    extractedData: 'documents.extractedData',
  },
  organizations: { clerkOrgId: 'organizations.clerkOrgId' },
}));

vi.mock('drizzle-orm', () => ({
  eq: (...a: unknown[]) => ({ eq: a }),
  and: (...a: unknown[]) => ({ and: a }),
}));

let txRows: Array<{ extractedData: unknown }> = [];
vi.mock('@/lib/with-rls', () => ({
  withRls: (_orgId: string, fn: (tx: unknown) => unknown) => {
    const chain = {
      select: () => chain,
      from: () => chain,
      where: () => Promise.resolve(txRows),
    };
    return fn(chain);
  },
}));

import type { DocumentKind, InstrumentRecord } from '@cema/collateral';

import { getDealChainFindings, isInstrumentRecord } from './deal-chain-findings';

function inst(
  p: Partial<InstrumentRecord> & { documentId: string; instrumentKind: DocumentKind },
): InstrumentRecord {
  return {
    assignor: null,
    assignee: null,
    executedAt: null,
    recordedAt: null,
    amount: null,
    recordingRef: { reelPage: null, crfn: `crfn-${p.documentId}` },
    county: null,
    references: null,
    ...p,
  };
}

beforeEach(() => {
  findFirstOrg.mockResolvedValue({ id: '00000000-0000-0000-0000-0000000000a7' });
  txRows = [];
});

describe('isInstrumentRecord', () => {
  it('accepts a real InstrumentRecord and rejects the empty jsonb default', () => {
    expect(isInstrumentRecord(inst({ documentId: 'm1', instrumentKind: 'mortgage' }))).toBe(true);
    expect(isInstrumentRecord({})).toBe(false);
    expect(isInstrumentRecord(null)).toBe(false);
    expect(isInstrumentRecord({ instrumentKind: 123 })).toBe(false);
  });
});

describe('getDealChainFindings', () => {
  it('returns { analyzed: false } when no instruments are persisted', async () => {
    txRows = [{ extractedData: {} }, { extractedData: {} }];
    const r = await getDealChainFindings('deal-1');
    expect(r).toEqual({ analyzed: false, status: null, routes: [] });
  });

  it('clean chain → advisory_pass', async () => {
    txRows = [
      { extractedData: inst({ documentId: 'm1', instrumentKind: 'mortgage' }) },
      {
        extractedData: inst({
          documentId: 'a1',
          instrumentKind: 'aom',
          assignor: 'Lender A',
          assignee: 'Lender B',
          recordedAt: '2026-01-01',
        }),
      },
    ];
    const r = await getDealChainFindings('deal-1');
    expect(r.analyzed).toBe(true);
    expect(r.status).toBe('clean');
    expect(r.routes).toHaveLength(1);
    expect(r.routes[0]!.kind).toBe('advisory_pass');
  });

  it('missing assignment → broken + re_chase', async () => {
    txRows = [
      { extractedData: inst({ documentId: 'm1', instrumentKind: 'mortgage' }) },
      {
        extractedData: inst({
          documentId: 'a1',
          instrumentKind: 'aom',
          assignor: 'A',
          assignee: 'B',
          recordedAt: '2026-01-01',
        }),
      },
      {
        extractedData: inst({
          documentId: 'a2',
          instrumentKind: 'aom',
          assignor: 'C',
          assignee: 'D',
          recordedAt: '2026-02-01',
        }),
      },
    ];
    const r = await getDealChainFindings('deal-1');
    expect(r.status).toBe('broken');
    expect(r.routes.some((x) => x.kind === 're_chase')).toBe(true);
  });

  it('lost note → ambiguous + attorney_review', async () => {
    txRows = [{ extractedData: inst({ documentId: 'n1', instrumentKind: 'note' }) }];
    const r = await getDealChainFindings('deal-1');
    expect(r.status).toBe('ambiguous');
    expect(r.routes.some((x) => x.kind === 'attorney_review')).toBe(true);
  });

  it('returns empty findings when the org cannot be resolved', async () => {
    findFirstOrg.mockResolvedValue(undefined);
    const r = await getDealChainFindings('deal-1');
    expect(r).toEqual({ analyzed: false, status: null, routes: [] });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd "C:/Users/conno/Code/Project_CEMA_v1.0.0" && pnpm --filter web test deal-chain-findings`
Expected: FAIL — `Cannot find module './deal-chain-findings'` (file not created yet).

- [ ] **Step 3: Write the implementation**

Create `apps/web/lib/queries/deal-chain-findings.ts`:

```ts
import {
  analyzeChain,
  route,
  type ChainStatus,
  type RouteDecision,
} from '@cema/agents-chain-of-title';
import { getCurrentOrganizationId } from '@cema/auth';
import type { InstrumentRecord } from '@cema/collateral';
import { documents, getDb, organizations } from '@cema/db';
import { eq } from 'drizzle-orm';

import { withRls } from '@/lib/with-rls';

export interface DealChainFindings {
  readonly analyzed: boolean;
  readonly status: ChainStatus | null;
  readonly routes: readonly RouteDecision[];
}

const EMPTY: DealChainFindings = { analyzed: false, status: null, routes: [] };

/**
 * Discriminates a real persisted InstrumentRecord from the jsonb column's
 * empty `{}` default. The column never holds `null` (default is `{}` and
 * NOT NULL), so the presence of a string `instrumentKind` is the signal.
 */
export function isInstrumentRecord(value: unknown): value is InstrumentRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    'instrumentKind' in value &&
    typeof (value as { instrumentKind: unknown }).instrumentKind === 'string'
  );
}

/**
 * Recomputes chain-of-title findings for a deal from the InstrumentRecord[]
 * the IDP persisted into documents.extractedData. Pure (no clock, no LLM, no
 * DB write) — Decision 1 of the slice design.
 */
export async function getDealChainFindings(dealId: string): Promise<DealChainFindings> {
  const clerkOrgId = await getCurrentOrganizationId();
  const db = getDb();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) return EMPTY;

  return withRls(org.id, async (tx) => {
    const rows = await tx
      .select({ extractedData: documents.extractedData })
      .from(documents)
      .where(eq(documents.dealId, dealId));

    const instruments = rows.map((r) => r.extractedData).filter(isInstrumentRecord);

    // Do NOT analyze an empty chain — analyzeChain([]) reports phantom breaks.
    if (instruments.length === 0) return EMPTY;

    const analysis = analyzeChain(instruments);
    const routes = route(dealId, analysis.breaks);
    return { analyzed: true, status: analysis.status, routes };
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd "C:/Users/conno/Code/Project_CEMA_v1.0.0" && pnpm --filter web test deal-chain-findings`
Expected: PASS — 6 tests green.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/conno/Code/Project_CEMA_v1.0.0" && git add apps/web/lib/queries/deal-chain-findings.ts apps/web/lib/queries/deal-chain-findings.test.ts && git commit -S -m "$(cat <<'EOF'
feat(m14-s3): getDealChainFindings loader (recompute from extractedData)

RLS-scoped read of documents.extractedData; recomputes chain findings live
via the pure analyzeChain + route core. Empty deals short-circuit to
{ analyzed: false } so an empty chain never reports phantom breaks.

Co-authored-by: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `getDealDocumentsReview` loader

**Files:**

- Create: `apps/web/lib/queries/deal-documents-review.ts`
- Test: `apps/web/lib/queries/deal-documents-review.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/queries/deal-documents-review.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const findFirstOrg = vi.fn();
const findFirstUser = vi.fn();

vi.mock('@cema/auth', () => ({
  getCurrentOrganizationId: () => Promise.resolve('clerk-org'),
  getCurrentUser: () => Promise.resolve({ id: 'clerk-user' }),
}));

vi.mock('@cema/db', () => ({
  getDb: () => ({
    query: {
      organizations: { findFirst: findFirstOrg },
      users: { findFirst: findFirstUser },
    },
  }),
  documents: {
    id: 'd.id',
    dealId: 'd.dealId',
    kind: 'd.kind',
    status: 'd.status',
    version: 'd.version',
    attorneyReviewRequired: 'd.arr',
    extractedData: 'd.ed',
  },
  documentReviewQueue: {
    id: 'q.id',
    documentId: 'q.docId',
    documentVersion: 'q.docVer',
    state: 'q.state',
    reviewerId: 'q.reviewerId',
  },
  organizations: { clerkOrgId: 'o.clerkOrgId' },
  users: { clerkUserId: 'u.clerkUserId' },
}));

vi.mock('drizzle-orm', () => ({
  eq: (...a: unknown[]) => ({ eq: a }),
  and: (...a: unknown[]) => ({ and: a }),
}));

let joinedRows: unknown[] = [];
vi.mock('@/lib/with-rls', () => ({
  withRls: (_orgId: string, fn: (tx: unknown) => unknown) => {
    const chain = {
      select: () => chain,
      from: () => chain,
      leftJoin: () => chain,
      where: () => Promise.resolve(joinedRows),
    };
    return fn(chain);
  },
}));

import type { DocumentKind, InstrumentRecord } from '@cema/collateral';

import { getDealDocumentsReview } from './deal-documents-review';

function inst(documentId: string, instrumentKind: DocumentKind): InstrumentRecord {
  return {
    documentId,
    instrumentKind,
    assignor: null,
    assignee: null,
    executedAt: null,
    recordedAt: null,
    amount: null,
    recordingRef: { reelPage: null, crfn: `crfn-${documentId}` },
    county: null,
    references: null,
  };
}

beforeEach(() => {
  findFirstOrg.mockResolvedValue({ id: 'org-uuid' });
  findFirstUser.mockResolvedValue({ id: 'user-uuid' });
  joinedRows = [];
});

describe('getDealDocumentsReview', () => {
  it('orders gate-required first, then by kind', async () => {
    joinedRows = [
      {
        documentId: 'd2',
        kind: 'note',
        status: 'draft',
        version: 1,
        attorneyReviewRequired: false,
        extractedData: {},
        queueId: null,
        reviewState: null,
        reviewerId: null,
      },
      {
        documentId: 'd1',
        kind: 'aom',
        status: 'attorney_review',
        version: 1,
        attorneyReviewRequired: true,
        extractedData: inst('d1', 'aom'),
        queueId: 'q1',
        reviewState: 'pending',
        reviewerId: null,
      },
    ];
    const items = await getDealDocumentsReview('deal-1');
    expect(items.map((i) => i.documentId)).toEqual(['d1', 'd2']);
    expect(items[0]!.attorneyReviewRequired).toBe(true);
    expect(items[0]!.instrument?.instrumentKind).toBe('aom');
    expect(items[0]!.queueId).toBe('q1');
    expect(items[0]!.reviewState).toBe('pending');
  });

  it('null instrument + null reviewState when unqueued with empty extractedData', async () => {
    joinedRows = [
      {
        documentId: 'd2',
        kind: 'note',
        status: 'draft',
        version: 1,
        attorneyReviewRequired: false,
        extractedData: {},
        queueId: null,
        reviewState: null,
        reviewerId: null,
      },
    ];
    const items = await getDealDocumentsReview('deal-1');
    expect(items[0]!.instrument).toBeNull();
    expect(items[0]!.reviewState).toBeNull();
    expect(items[0]!.queueId).toBeNull();
    expect(items[0]!.reviewerIsCurrentUser).toBe(false);
  });

  it('reviewerIsCurrentUser true only when the queue reviewer matches current user', async () => {
    joinedRows = [
      {
        documentId: 'd1',
        kind: 'aom',
        status: 'attorney_review',
        version: 1,
        attorneyReviewRequired: true,
        extractedData: inst('d1', 'aom'),
        queueId: 'q1',
        reviewState: 'claimed',
        reviewerId: 'user-uuid',
      },
    ];
    const items = await getDealDocumentsReview('deal-1');
    expect(items[0]!.reviewerIsCurrentUser).toBe(true);
  });

  it('reviewerIsCurrentUser false when a different reviewer holds the claim', async () => {
    joinedRows = [
      {
        documentId: 'd1',
        kind: 'aom',
        status: 'attorney_review',
        version: 1,
        attorneyReviewRequired: true,
        extractedData: inst('d1', 'aom'),
        queueId: 'q1',
        reviewState: 'claimed',
        reviewerId: 'someone-else',
      },
    ];
    const items = await getDealDocumentsReview('deal-1');
    expect(items[0]!.reviewerIsCurrentUser).toBe(false);
  });

  it('returns [] when the org cannot be resolved', async () => {
    findFirstOrg.mockResolvedValue(undefined);
    const items = await getDealDocumentsReview('deal-1');
    expect(items).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd "C:/Users/conno/Code/Project_CEMA_v1.0.0" && pnpm --filter web test deal-documents-review`
Expected: FAIL — `Cannot find module './deal-documents-review'`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/lib/queries/deal-documents-review.ts`:

```ts
import { getCurrentOrganizationId, getCurrentUser } from '@cema/auth';
import type { ReviewState } from '@cema/attorney';
import type { InstrumentRecord } from '@cema/collateral';
import { documentReviewQueue, documents, getDb, organizations, users } from '@cema/db';
import { and, eq } from 'drizzle-orm';

import { withRls } from '@/lib/with-rls';
import { isInstrumentRecord } from './deal-chain-findings';

export interface DealDocumentReviewItem {
  readonly documentId: string;
  readonly kind: string;
  readonly status: string;
  readonly version: number;
  readonly attorneyReviewRequired: boolean;
  readonly instrument: InstrumentRecord | null;
  readonly queueId: string | null;
  readonly reviewState: ReviewState | null;
  readonly reviewerIsCurrentUser: boolean;
}

/**
 * Loads every document on a deal, left-joined to its active review-queue row
 * (one per document_id + version). Gate-required documents sort first so the
 * attorney/processor sees actionable items at the top. RLS-scoped: tenancy
 * flows documents.dealId -> deals.organizationId, enforced by withRls.
 */
export async function getDealDocumentsReview(dealId: string): Promise<DealDocumentReviewItem[]> {
  const clerkOrgId = await getCurrentOrganizationId();
  const clerkUser = await getCurrentUser();
  const db = getDb();

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) return [];

  let currentUserId: string | null = null;
  if (clerkUser) {
    const u = await db.query.users.findFirst({
      where: eq(users.clerkUserId, clerkUser.id),
    });
    currentUserId = u?.id ?? null;
  }

  return withRls(org.id, async (tx) => {
    const rows = await tx
      .select({
        documentId: documents.id,
        kind: documents.kind,
        status: documents.status,
        version: documents.version,
        attorneyReviewRequired: documents.attorneyReviewRequired,
        extractedData: documents.extractedData,
        queueId: documentReviewQueue.id,
        reviewState: documentReviewQueue.state,
        reviewerId: documentReviewQueue.reviewerId,
      })
      .from(documents)
      .leftJoin(
        documentReviewQueue,
        and(
          eq(documentReviewQueue.documentId, documents.id),
          eq(documentReviewQueue.documentVersion, documents.version),
        ),
      )
      .where(eq(documents.dealId, dealId));

    const items: DealDocumentReviewItem[] = rows.map((r) => ({
      documentId: r.documentId,
      kind: r.kind,
      status: r.status,
      version: r.version,
      attorneyReviewRequired: r.attorneyReviewRequired,
      instrument: isInstrumentRecord(r.extractedData) ? r.extractedData : null,
      queueId: r.queueId ?? null,
      reviewState: (r.reviewState as ReviewState | null) ?? null,
      reviewerIsCurrentUser:
        r.reviewerId !== null && currentUserId !== null && r.reviewerId === currentUserId,
    }));

    items.sort((a, b) => {
      if (a.attorneyReviewRequired !== b.attorneyReviewRequired) {
        return a.attorneyReviewRequired ? -1 : 1;
      }
      return a.kind.localeCompare(b.kind);
    });

    return items;
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd "C:/Users/conno/Code/Project_CEMA_v1.0.0" && pnpm --filter web test deal-documents-review`
Expected: PASS — 5 tests green.

- [ ] **Step 5: Typecheck + lint the package**

Run: `cd "C:/Users/conno/Code/Project_CEMA_v1.0.0" && pnpm --filter web typecheck && pnpm --filter web lint`
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/conno/Code/Project_CEMA_v1.0.0" && git add apps/web/lib/queries/deal-documents-review.ts apps/web/lib/queries/deal-documents-review.test.ts && git commit -S -m "$(cat <<'EOF'
feat(m14-s3): getDealDocumentsReview loader (documents ⟕ review queue)

RLS-scoped left-join of documents to document_review_queue on
(document_id, version); gate-required rows sort first. Returns the persisted
InstrumentRecord per row plus review state and reviewerIsCurrentUser.

Co-authored-by: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 7: Push PR-1 + open/auto-merge**

```bash
cd "C:/Users/conno/Code/Project_CEMA_v1.0.0" && git push -u origin feat/m14-slice3-review-surface
```

Open the PR (title `feat(m14-s3): deal-review data loaders`), then:

```bash
cd "C:/Users/conno/Code/Project_CEMA_v1.0.0" && gh pr merge <n> --auto --squash --delete-branch
```

Wait for green (Lint, Typecheck, Unit tests, Build) + auto-merge. Then `git checkout main && git pull --rebase origin main` before PR-2.

---

# PR-2 — Page + components + nav + integration test

### Task 4: `reviewActionMode` pure helper

**Files:**

- Create: `apps/web/lib/review-action-mode.ts`
- Test: `apps/web/lib/review-action-mode.test.ts`

Branch first: `cd "C:/Users/conno/Code/Project_CEMA_v1.0.0" && git checkout -b feat/m14-slice3-review-page`

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/review-action-mode.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { reviewActionMode } from './review-action-mode';

describe('reviewActionMode', () => {
  it('queued → review (regardless of gate flag)', () => {
    expect(reviewActionMode({ queueId: 'q1', attorneyReviewRequired: true })).toBe('review');
    expect(reviewActionMode({ queueId: 'q1', attorneyReviewRequired: false })).toBe('review');
  });

  it('unqueued + gate-required → submit', () => {
    expect(reviewActionMode({ queueId: null, attorneyReviewRequired: true })).toBe('submit');
  });

  it('unqueued + not gate-required → none', () => {
    expect(reviewActionMode({ queueId: null, attorneyReviewRequired: false })).toBe('none');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd "C:/Users/conno/Code/Project_CEMA_v1.0.0" && pnpm --filter web test review-action-mode`
Expected: FAIL — `Cannot find module './review-action-mode'`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/lib/review-action-mode.ts`:

```ts
export type ReviewActionMode = 'submit' | 'review' | 'none';

/**
 * Decides which affordance the deal-document review island renders:
 * - 'review' — a queue row exists; defer to the claim/approve/reject panel.
 * - 'submit' — no queue row yet but the doc is gate-required; offer submit.
 * - 'none'   — nothing actionable.
 * Pure so it can be unit-tested in the node vitest env (no jsdom in apps/web).
 */
export function reviewActionMode(input: {
  queueId: string | null;
  attorneyReviewRequired: boolean;
}): ReviewActionMode {
  if (input.queueId !== null) return 'review';
  if (input.attorneyReviewRequired) return 'submit';
  return 'none';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd "C:/Users/conno/Code/Project_CEMA_v1.0.0" && pnpm --filter web test review-action-mode`
Expected: PASS — 3 tests green.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/conno/Code/Project_CEMA_v1.0.0" && git add apps/web/lib/review-action-mode.ts apps/web/lib/review-action-mode.test.ts && git commit -S -m "$(cat <<'EOF'
feat(m14-s3): reviewActionMode pure helper

Extracts the review island's submit/review/none decision into a pure,
node-testable function (apps/web vitest has no jsdom for component render).

Co-authored-by: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `DealDocumentReviewActions` client island

**Files:**

- Create: `apps/web/components/deal-document-review-actions.tsx`

No unit test (client component, node env has no jsdom). Verified by the integration test (Task 8) + browser.

- [ ] **Step 1: Write the component**

Create `apps/web/components/deal-document-review-actions.tsx`:

```tsx
'use client';

import type { ReviewState } from '@cema/attorney';
import { useState, useTransition } from 'react';

import { submitForReview } from '@/lib/actions/submit-for-review';
import { reviewActionMode } from '@/lib/review-action-mode';

import { ReviewDetailPanel } from './review-detail-panel';

interface Props {
  documentId: string;
  attorneyReviewRequired: boolean;
  queueId: string | null;
  state: ReviewState | null;
  reviewerIsCurrentUser: boolean;
}

export function DealDocumentReviewActions({
  documentId,
  attorneyReviewRequired,
  queueId,
  state,
  reviewerIsCurrentUser,
}: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const mode = reviewActionMode({ queueId, attorneyReviewRequired });

  if (mode === 'review' && queueId !== null && state !== null) {
    return (
      <ReviewDetailPanel
        queueId={queueId}
        state={state}
        reviewerIsCurrentUser={reviewerIsCurrentUser}
      />
    );
  }

  if (mode === 'submit') {
    return (
      <div>
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              try {
                await submitForReview(documentId);
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Failed to submit for review');
              }
            });
          }}
          className="inline-flex items-center rounded-md border bg-blue-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {isPending ? 'Submitting…' : 'Submit for attorney review'}
        </button>
        {error ? <p className="mt-2 text-xs text-red-700">{error}</p> : null}
      </div>
    );
  }

  return null;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd "C:/Users/conno/Code/Project_CEMA_v1.0.0" && pnpm --filter web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/conno/Code/Project_CEMA_v1.0.0" && git add apps/web/components/deal-document-review-actions.tsx && git commit -S -m "$(cat <<'EOF'
feat(m14-s3): DealDocumentReviewActions client island

Submit-for-review affordance on gate-required docs lacking a queue row
(Decision 2 — UI-driven bridge of the IDP flag->queue gap); otherwise wraps
the existing ReviewDetailPanel claim/approve/reject controls.

Co-authored-by: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `/deals/[id]/documents` RSC page

**Files:**

- Create: `apps/web/app/(app)/deals/[id]/documents/page.tsx`

- [ ] **Step 1: Write the page**

Create `apps/web/app/(app)/deals/[id]/documents/page.tsx`:

```tsx
import { notFound } from 'next/navigation';

import { DealDocumentReviewActions } from '@/components/deal-document-review-actions';
import { getDeal } from '@/lib/actions/get-deal';
import { getDealChainFindings } from '@/lib/queries/deal-chain-findings';
import { getDealDocumentsReview } from '@/lib/queries/deal-documents-review';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const deal = await getDeal(id);
  if (!deal) notFound();

  const [items, findings] = await Promise.all([
    getDealDocumentsReview(id),
    getDealChainFindings(id),
  ]);

  const reChase = findings.routes.filter((r) => r.kind === 're_chase');
  const attorneyReview = findings.routes.filter((r) => r.kind === 'attorney_review');

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Documents &amp; chain of title</h1>

      <section>
        <h2 className="mb-3 text-sm font-medium">Collateral instruments ({items.length})</h2>
        {items.length === 0 ? (
          <div className="text-muted-foreground rounded-lg border border-dashed p-12 text-center text-sm">
            No documents on this deal yet.
          </div>
        ) : (
          <ul className="space-y-3" role="list">
            {items.map((item) => (
              <li key={`${item.documentId}:${item.version}`} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{item.kind}</span>
                  <span className="text-muted-foreground">v{item.version}</span>
                  <span className="rounded bg-gray-100 px-2 py-0.5 text-xs">{item.status}</span>
                  {item.attorneyReviewRequired ? (
                    <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                      attorney gate
                    </span>
                  ) : null}
                  <span className="text-muted-foreground rounded px-2 py-0.5 text-xs">
                    {item.reviewState ?? '—'}
                  </span>
                </div>

                {item.attorneyReviewRequired && item.instrument ? (
                  <dl className="text-muted-foreground mt-3 grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                    <div className="flex gap-1">
                      <dt>Assignor → Assignee:</dt>
                      <dd className="text-foreground">
                        {item.instrument.assignor ?? '—'} → {item.instrument.assignee ?? '—'}
                      </dd>
                    </div>
                    <div className="flex gap-1">
                      <dt>Amount:</dt>
                      <dd className="text-foreground">
                        {item.instrument.amount !== null ? `$${item.instrument.amount}` : '—'}
                      </dd>
                    </div>
                    <div className="flex gap-1">
                      <dt>Recording:</dt>
                      <dd className="text-foreground">
                        {item.instrument.recordingRef.crfn ??
                          item.instrument.recordingRef.reelPage ??
                          '—'}
                      </dd>
                    </div>
                    <div className="flex gap-1">
                      <dt>County:</dt>
                      <dd className="text-foreground">{item.instrument.county ?? '—'}</dd>
                    </div>
                  </dl>
                ) : null}

                <div className="mt-3">
                  <DealDocumentReviewActions
                    documentId={item.documentId}
                    attorneyReviewRequired={item.attorneyReviewRequired}
                    queueId={item.queueId}
                    state={item.reviewState}
                    reviewerIsCurrentUser={item.reviewerIsCurrentUser}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium">Chain of title</h2>
        {!findings.analyzed ? (
          <div className="text-muted-foreground rounded-lg border border-dashed p-12 text-center text-sm">
            Not yet analyzed — no collateral instruments have been classified for this deal.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Status:</span>
              <span
                className={
                  findings.status === 'clean'
                    ? 'rounded bg-green-100 px-2 py-0.5 text-xs text-green-800'
                    : 'rounded bg-red-100 px-2 py-0.5 text-xs text-red-800'
                }
              >
                {findings.status}
              </span>
            </div>

            {reChase.length === 0 && attorneyReview.length === 0 ? (
              <p className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
                No chain breaks detected.
              </p>
            ) : (
              <div className="space-y-4">
                {reChase.length > 0 ? (
                  <div>
                    <h3 className="text-muted-foreground mb-2 text-xs font-semibold uppercase">
                      Re-chase ({reChase.length})
                    </h3>
                    <ul className="space-y-2" role="list">
                      {reChase.map((r, i) => (
                        <li key={`rc-${i}`} className="rounded-lg border p-3 text-sm">
                          <p>{r.reason}</p>
                          {r.documentId ? (
                            <p className="text-muted-foreground mt-1 text-xs">
                              Document: {r.documentId}
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {attorneyReview.length > 0 ? (
                  <div>
                    <h3 className="text-muted-foreground mb-2 text-xs font-semibold uppercase">
                      Attorney review ({attorneyReview.length})
                    </h3>
                    <ul className="space-y-2" role="list">
                      {attorneyReview.map((r, i) => (
                        <li key={`ar-${i}`} className="rounded-lg border p-3 text-sm">
                          <p>{r.reason}</p>
                          {r.documentId ? (
                            <p className="text-muted-foreground mt-1 text-xs">
                              Document: {r.documentId}
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `cd "C:/Users/conno/Code/Project_CEMA_v1.0.0" && pnpm --filter web typecheck && pnpm --filter web lint`
Expected: both PASS.

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/conno/Code/Project_CEMA_v1.0.0" && git add "apps/web/app/(app)/deals/[id]/documents/page.tsx" && git commit -S -m "$(cat <<'EOF'
feat(m14-s3): /deals/[id]/documents review surface page

RSC page: Section 1 lists collateral instruments (gate-required first, with
the InstrumentRecord summary + review actions); Section 2 renders chain-of-title
status and grouped re_chase / attorney_review findings. The IDP action's
existing revalidatePath('/deals/[id]/documents') now targets a live route.

Co-authored-by: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Deal-overview nav link

**Files:**

- Modify: `apps/web/app/(app)/deals/[id]/page.tsx`

- [ ] **Step 1: Add the import**

At the top of `apps/web/app/(app)/deals/[id]/page.tsx`, the imports currently are:

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@cema/ui';
import { notFound } from 'next/navigation';

import { getDeal } from '@/lib/actions/get-deal';
```

Add the `next/link` import:

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@cema/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getDeal } from '@/lib/actions/get-deal';
```

- [ ] **Step 2: Insert the nav link between the `<h1>` and the grid**

The page body currently is:

```tsx
      <h1 className="mb-6 text-2xl font-semibold">
        {deal.cemaType === 'refi_cema' ? 'Refi CEMA' : 'Purchase CEMA'} · {deal.status}
      </h1>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
```

Change to:

```tsx
      <h1 className="mb-6 text-2xl font-semibold">
        {deal.cemaType === 'refi_cema' ? 'Refi CEMA' : 'Purchase CEMA'} · {deal.status}
      </h1>
      <nav className="mb-6 flex gap-4 text-sm">
        <Link href={`/deals/${id}/documents`} className="text-blue-600 hover:underline">
          Documents &amp; chain of title
        </Link>
      </nav>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
```

- [ ] **Step 3: Typecheck + lint**

Run: `cd "C:/Users/conno/Code/Project_CEMA_v1.0.0" && pnpm --filter web typecheck && pnpm --filter web lint`
Expected: both PASS.

- [ ] **Step 4: Commit**

```bash
cd "C:/Users/conno/Code/Project_CEMA_v1.0.0" && git add "apps/web/app/(app)/deals/[id]/page.tsx" && git commit -S -m "$(cat <<'EOF'
feat(m14-s3): link deal overview to the documents review surface

Co-authored-by: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Neon-gated integration test (deal-scoped read + RLS isolation)

**Files:**

- Create: `apps/web/tests/integration/deal-review-surface.test.ts`

- [ ] **Step 1: Write the integration test**

Create `apps/web/tests/integration/deal-review-surface.test.ts`:

```ts
import type { InstrumentRecord } from '@cema/collateral';
import { deals, documentReviewQueue, documents, getDb, organizations, users } from '@cema/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const skip = !process.env.DATABASE_URL;

// Mutable current-org so a single suite can assert cross-org RLS isolation.
let currentClerkOrgId = 'org_review_a';
const currentClerkUser = { id: 'user_review_a' };

vi.mock('@cema/auth', () => ({
  getCurrentOrganizationId: () => Promise.resolve(currentClerkOrgId),
  getCurrentUser: () => Promise.resolve(currentClerkUser),
}));

// Import the loaders AFTER the mock is registered.
const { getDealChainFindings } = await import('@/lib/queries/deal-chain-findings');
const { getDealDocumentsReview } = await import('@/lib/queries/deal-documents-review');

const ORG_A = '00000000-0000-0000-0000-0000000000a1';
const ORG_B = '00000000-0000-0000-0000-0000000000b1';
const USER_A = '00000000-0000-0000-0000-000000000a01';
const DEAL_A = '00000000-0000-0000-0000-0000000000e1';
const DOC_MORT = '00000000-0000-0000-0000-0000000000d1';
const DOC_AOM = '00000000-0000-0000-0000-0000000000d2';

function inst(
  documentId: string,
  instrumentKind: InstrumentRecord['instrumentKind'],
  extra: Partial<InstrumentRecord> = {},
): InstrumentRecord {
  return {
    documentId,
    instrumentKind,
    assignor: null,
    assignee: null,
    executedAt: null,
    recordedAt: null,
    amount: null,
    recordingRef: { reelPage: null, crfn: `crfn-${documentId}` },
    county: null,
    references: null,
    ...extra,
  };
}

describe.skipIf(skip)('deal review surface (Neon integration)', () => {
  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(organizations)
      .values([
        { id: ORG_A, clerkOrgId: 'org_review_a', name: 'Review A', slug: 'review-a' },
        { id: ORG_B, clerkOrgId: 'org_review_b', name: 'Review B', slug: 'review-b' },
      ])
      .onConflictDoNothing();
    await db
      .insert(users)
      .values({ id: USER_A, clerkUserId: 'user_review_a', email: 'review-a@example.invalid' })
      .onConflictDoNothing();
    await db
      .insert(deals)
      .values({
        id: DEAL_A,
        organizationId: ORG_A,
        cemaType: 'refi_cema',
        status: 'doc_prep',
        createdById: USER_A,
      })
      .onConflictDoNothing();
    await db
      .insert(documents)
      .values([
        {
          id: DOC_MORT,
          dealId: DEAL_A,
          kind: 'mortgage',
          status: 'draft',
          attorneyReviewRequired: false,
          version: 1,
          extractedData: inst(DOC_MORT, 'mortgage') as unknown as Record<string, unknown>,
        },
        {
          id: DOC_AOM,
          dealId: DEAL_A,
          kind: 'aom',
          status: 'draft',
          attorneyReviewRequired: true,
          version: 1,
          extractedData: inst(DOC_AOM, 'aom', {
            assignor: 'Lender A',
            assignee: 'Lender B',
            recordedAt: '2026-01-01',
          }) as unknown as Record<string, unknown>,
        },
      ])
      .onConflictDoNothing();
  });

  afterAll(async () => {
    const db = getDb();
    // Only clean queue rows we might have created; leave seed rows in place
    // (onConflictDoNothing makes the suite idempotent across runs).
    await db.delete(documentReviewQueue).where(eq(documentReviewQueue.documentId, DOC_AOM));
  });

  it('returns deal-scoped documents, gate-required first, with the AOM instrument', async () => {
    currentClerkOrgId = 'org_review_a';
    const items = await getDealDocumentsReview(DEAL_A);
    expect(items).toHaveLength(2);
    expect(items[0]!.attorneyReviewRequired).toBe(true);
    expect(items[0]!.kind).toBe('aom');
    expect(items[0]!.instrument?.assignee).toBe('Lender B');
    expect(items[1]!.kind).toBe('mortgage');
  });

  it('recomputes a clean chain → advisory_pass', async () => {
    currentClerkOrgId = 'org_review_a';
    const findings = await getDealChainFindings(DEAL_A);
    expect(findings.analyzed).toBe(true);
    expect(findings.status).toBe('clean');
    expect(findings.routes).toHaveLength(1);
    expect(findings.routes[0]!.kind).toBe('advisory_pass');
  });

  it('is invisible to another org (RLS isolation)', async () => {
    currentClerkOrgId = 'org_review_b';
    expect(await getDealDocumentsReview(DEAL_A)).toEqual([]);
    expect(await getDealChainFindings(DEAL_A)).toEqual({
      analyzed: false,
      status: null,
      routes: [],
    });
  });
});
```

- [ ] **Step 2: Run the test (skips green without DATABASE_URL; runs against Neon when set)**

Run: `cd "C:/Users/conno/Code/Project_CEMA_v1.0.0" && pnpm --filter web test deal-review-surface`
Expected: with no `DATABASE_URL` → SKIPPED (green). With a Neon `DATABASE_URL` exported → 3 tests PASS.

- [ ] **Step 3: Full web suite + typecheck + lint**

Run: `cd "C:/Users/conno/Code/Project_CEMA_v1.0.0" && pnpm --filter web test && pnpm --filter web typecheck && pnpm --filter web lint`
Expected: all PASS (the new integration file skips without a DB).

- [ ] **Step 4: Browser verification**

Run `cd "C:/Users/conno/Code/Project_CEMA_v1.0.0" && pnpm dev`, open an existing deal, click "Documents & chain of title", and confirm: the instruments list renders gate-first; a gate-required doc with no queue row shows "Submit for attorney review"; clicking it transitions the row to a claim/approve/reject panel; the chain section shows status + findings (or the not-yet-analyzed empty state). If the dev environment lacks seeded IDP data, state this explicitly rather than claiming success.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/conno/Code/Project_CEMA_v1.0.0" && git add apps/web/tests/integration/deal-review-surface.test.ts && git commit -S -m "$(cat <<'EOF'
test(m14-s3): Neon-gated deal review surface integration test

Seeds an org with a mortgage + gate-required AOM (both with persisted
InstrumentRecords), asserts deal-scoped gate-first ordering and a clean-chain
advisory_pass recompute, and verifies cross-org RLS isolation. Skips green
without DATABASE_URL.

Co-authored-by: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Push PR-2 + open/auto-merge**

```bash
cd "C:/Users/conno/Code/Project_CEMA_v1.0.0" && git push -u origin feat/m14-slice3-review-page
```

Open the PR (title `feat(m14-s3): deal review surface page + wiring`), then `gh pr merge <n> --auto --squash --delete-branch`. Wait for green + merge. Then `git checkout main && git pull --rebase origin main` before PR-3.

---

# PR-3 — Docs close-out

### Task 9: Annotate the two ADR carry-overs

**Files:**

- Modify: `docs/adr/0015-phase-1-month-13-collateral-idp.md`
- Modify: `docs/adr/0016-phase-1-month-13-chain-of-title.md`

Branch first: `cd "C:/Users/conno/Code/Project_CEMA_v1.0.0" && git checkout -b docs/m14-slice3-closeout`

- [ ] **Step 1: Annotate ADR 0015 carry-over #4**

Open `docs/adr/0015-phase-1-month-13-collateral-idp.md`, find carry-over #4 (the "deal-scoped attorney-review surface" item), and append a resolution note in the style of the other resolved carry-overs in that file (read the file first to match its exact format). The note must state:

- The rendering half is RESOLVED by M14 Slice 3 (PRs for this slice): the route `/deals/[id]/documents` now renders gate-required instruments and offers UI-driven `submitForReview` (Decision 2).
- The IDP action's `revalidatePath('/deals/[id]/documents')` is no longer a no-op.
- **New fast-follow carry-over:** auto-enqueue gate-required docs from the IDP `persistDocuments` path (so a processor need not submit each manually) — deferred per Decision 2 (would couple the agent to the queue + need an agent actor user + idempotency).

- [ ] **Step 2: Annotate ADR 0016 carry-over #1**

Open `docs/adr/0016-phase-1-month-13-chain-of-title.md`, find carry-over #1 (the "real route actuators / render findings" item), and append a resolution note matching the file's format stating:

- The **rendering** half is RESOLVED by M14 Slice 3: `/deals/[id]/documents` renders chain status + grouped `re_chase` / `attorney_review` findings, recomputed live from `documents.extractedData` (Decision 1 — no migration, no `chain_routes` table).
- The **actuator** half remains OPEN: `routeReChase` / `openAttorneyReview` are still dormant no-ops; no real re-chase hand-off to the Outreach Agent and no durable per-break dispatch yet.

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/conno/Code/Project_CEMA_v1.0.0" && git add docs/adr/0015-phase-1-month-13-collateral-idp.md docs/adr/0016-phase-1-month-13-chain-of-title.md && git commit -S -m "$(cat <<'EOF'
docs(m14-s3): annotate ADR 0015 #4 + ADR 0016 #1 rendering halves resolved

Records the deal review surface as the rendering resolution for both carry-overs;
notes the IDP auto-enqueue fast-follow and the still-open chain actuator half.

Co-authored-by: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: CLAUDE.md + memory status file

**Files:**

- Modify: `CLAUDE.md` (§2 Phase line + Next step + counts; Changelog)
- Create: `C:\Users\conno\.claude\projects\C--Users-conno-Code-Project-CEMA-v1-0-0\memory\status-2026-05-31-m14-slice3-review-surface.md`
- Modify: `C:\Users\conno\.claude\projects\C--Users-conno-Code-Project-CEMA-v1-0-0\memory\MEMORY.md`

- [ ] **Step 1: Update CLAUDE.md §2**

Read the current §2 first. Then:

- In the Phase line, add an M14 Slice 3 sentence: the deal-scoped review surface (`/deals/[id]/documents`) shipped — two RLS-scoped loaders (`getDealDocumentsReview`, `getDealChainFindings`), an RSC page, the `DealDocumentReviewActions` client island, a deal-overview nav link; resolves the **rendering** halves of ADR 0015 #4 + ADR 0016 #1; recompute-not-persist (Decision 1) so **0 new migrations**; UI-driven submit bridges the IDP→queue gap (Decision 2). No new package.
- In **Next step**, mark Slice 3 DONE; the remaining M14 slice is **Slice 2** (real integration adapters behind the Fixture seams — Connor-gated on vendor keys). Note the two new carry-overs (IDP auto-enqueue; chain actuator activation).
- Update test counts: +14 apps/web tests (6 chain-findings + 5 documents-review + 3 review-action-mode) + 1 Neon-gated integration file (3 cases, skip-green); still 0 new migrations.

- [ ] **Step 2: Add a Changelog row**

Append to the `# Changelog` table:

```
| 2026-05-31 | M14 Slice 3 deal-scoped review surface shipped: `/deals/[id]/documents` renders IDP gate-required instruments (with UI-driven submitForReview, Decision 2) + Chain-of-Title re_chase/attorney_review findings recomputed live from extractedData (Decision 1 — no migration). Two RLS loaders + RSC page + DealDocumentReviewActions island + nav link. Resolves the rendering halves of ADR 0015 #4 + ADR 0016 #1; opens 2 carry-overs (IDP auto-enqueue; chain actuator activation). +14 unit tests + 1 Neon-gated integration file; 0 new migrations; no new package. | Claude Opus 4.8 + Connor |
```

- [ ] **Step 3: Write the memory status file**

Create `C:\Users\conno\.claude\projects\C--Users-conno-Code-Project-CEMA-v1-0-0\memory\status-2026-05-31-m14-slice3-review-surface.md`:

```markdown
---
name: status-2026-05-31-m14-slice3-review-surface
description: M14 Slice 3 (deal-scoped /deals/[id]/documents review surface) shipped — renders IDP gate-required instruments + Chain-of-Title findings
metadata:
  node_type: memory
  type: project
---

M14 Slice 3 — **deal-scoped review surface** — shipped 2026-05-31. New route `/deals/[id]/documents` renders (1) IDP-classified collateral instruments, gate-required first, each with a `DealDocumentReviewActions` island that offers UI-driven `submitForReview` when unqueued+gate-required (Decision 2) else wraps the existing `ReviewDetailPanel` claim/approve/reject; (2) Chain-of-Title `re_chase`/`attorney_review` findings + status, **recomputed live** from `documents.extractedData` via the pure `analyzeChain`+`route` core (Decision 1 — no `chain_routes` table, **0 migrations**). Two RLS-scoped loaders in `apps/web/lib/queries/` (`getDealDocumentsReview`, `getDealChainFindings` + an `isInstrumentRecord` jsonb-`{}`-vs-real guard); a pure node-testable `reviewActionMode` helper; a deal-overview nav link. apps/web gained a direct `@cema/collateral` dep (InstrumentRecord from its canonical home, not the IDP re-export). +14 unit tests + 1 Neon-gated integration file (3 cases incl. cross-org RLS isolation); no new package.

**Why:** turns two pieces of already-computed-but-invisible state (the IDP gate flag + InstrumentRecord, and the Chain-of-Title route decisions) into a working processor/attorney surface — the IDP action's `revalidatePath('/deals/[id]/documents')` was a no-op until this route existed.

**How to apply:** Slice 3 is DONE + merged. Resolves the **rendering** halves of ADR 0015 carry-over #4 + ADR 0016 carry-over #1. Two NEW carry-overs opened: (a) **auto-enqueue** gate-required docs from the IDP `persistDocuments` path (so processors needn't submit each manually — deferred per Decision 2); (b) **activate the chain route actuators** (`routeReChase`/`openAttorneyReview` are still dormant no-ops — rendering is done, acting is not). The remaining M14 slice is **Slice 2** (real Encompass/Resend/OCR adapters behind the Fixture seams — Connor-gated on vendor keys; each per hard rule #12 needs `packages/integrations/<name>` + a spec §16 row). Point-in-time snapshot — verify against `git log` before acting.

Related: [[status-2026-05-31-m14-slice4-collateral]], [[status-2026-05-31-m14-slice1-triggers]], [[status-2026-05-31-m13-chain-of-title]], [[connor-owned-phase1-gating-items]], [[project-cema]].
```

- [ ] **Step 4: Add the MEMORY.md index pointer**

In `C:\Users\conno\.claude\projects\C--Users-conno-Code-Project-CEMA-v1-0-0\memory\MEMORY.md`, add one line near the other status entries:

```
- [Status M14 Slice 3 2026-05-31](status-2026-05-31-m14-slice3-review-surface.md) — deal-scoped /deals/[id]/documents review surface; renders IDP instruments + Chain-of-Title findings; resolves rendering halves of ADR 0015 #4 + 0016 #1
```

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/conno/Code/Project_CEMA_v1.0.0" && git add CLAUDE.md && git commit -S -m "$(cat <<'EOF'
docs(m14-s3): CLAUDE.md §2 + Changelog for deal review surface close-out

Co-authored-by: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

(The memory files live outside the repo — they are written but not committed to git.)

- [ ] **Step 6: Push PR-3 + open/auto-merge**

```bash
cd "C:/Users/conno/Code/Project_CEMA_v1.0.0" && git push -u origin docs/m14-slice3-closeout
```

Open the PR (title `docs(m14-s3): Slice 3 close-out`), then `gh pr merge <n> --auto --squash --delete-branch`. Wait for green + merge. Then `git checkout main && git pull --rebase origin main`.

- [ ] **Step 7: Finish the branch**

Use `superpowers:finishing-a-development-branch` to verify the suite is green on `main` and confirm all three PRs merged.

---

## Carry-overs created by this slice (recorded in PR-3)

1. **Auto-enqueue gate-required docs from the IDP path** (Decision 2 deferral) — so a processor need not manually submit each instrument.
2. **Activate the Chain-of-Title route actuators** — real re-chase hand-off to the Outreach Agent + durable per-break dispatch (the actuator half of ADR 0016 carry-over #1).
3. **Persist chain edges to `kg_edges`** (ADR 0015 carry-over #6) remains independent of this slice.
