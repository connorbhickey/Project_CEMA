# Recording Prep Agent (v1) — Design Spec

> **Status:** Approved (Connor, 2026-06-02) — implementation pending.
> **Milestone:** **Phase 2** (the second Phase-2 agent — spec §9.8). Refi- and Purchase-CEMA.
> **Authoritative spec:** `docs/superpowers/specs/2026-05-12-cema-ai-processor-design.md` §9.8.

---

## 1. Goal & scope

When a deal enters `recording`, determine the **recording venue** (NYC borough → ACRIS vs. upstate →
county clerk), compose the **venue-specific cover-sheet package**, compute **placeholder recording
fees** from page count, persist each cover sheet as a **draft `documents` row** (gate-required where
the kind demands), then **submit via a dormant `FixtureRecordingAdapter`** and record the outcome —
on acceptance the reel/page or CRFN, on rejection a durable Exception-Triage signal. Single-pass.
This is the same proven blueprint (pure deterministic core + dormant vendor seam + attorney gate +
review-queue enqueue + split audit + OTel span) the Phase-1 agents and Doc-Gen use, applied to
recording submission.

**In scope:**

- A pure deterministic core (`resolveVenue` + `planRecording`) in a new `@cema/agents-recording-prep`
  package (no `@cema/db`/clock/LLM) — decides the venue, the cover-sheet set, and the recording-fee
  math.
- A dormant `FixtureRecordingAdapter` behind a `RecordingAdapter` seam (the swap point for real
  Simplifile + ACRIS submission/polling).
- An app-layer `runRecordingPrep` dispatcher that RLS-reads the deal's data, plans, persists each
  cover sheet + enqueues every gate-required one (reusing the IDP/Doc-Gen enqueue pattern), submits,
  polls once, and records the outcome — with split audit + OTel span. Idempotent.
- On acceptance: persist reel/page **or** CRFN to `deals.metadata.recording` (0 migrations). On
  rejection: emit a PII-safe `recording.rejected` audit (the Exception-Triage signal).
- Triggered by the `recording` `deal_status` transition via the existing agent dispatcher.

**Out of scope (deferred — carry-overs):**

- Real **Simplifile** (statewide) + **ACRIS** (NYC) submission/polling adapters (vendor-gated — each
  adds `packages/integrations/<name>` + a spec §16 row per hard rule #12; one-line swap in the
  dispatcher). Dormant (`FixtureRecordingAdapter`) until then.
- The **LLM (Claude Opus) rejection-reason diagnosis** (spec §9.8 LLM use) — dormant; v1 records a
  static rejection token (matching the no-LLM agents: IDP, Chain-of-Title, Doc-Gen).
- **Confirm the NY county recording-fee schedules** + real **page count** (from rendered documents) —
  Connor-gated, like the Intake Agent's NY recording-tax table. Until then `planRecording` runs on a
  `RECORDING_FEE_SCHEDULE` placeholder + an `ESTIMATED_CEMA_PAGE_COUNT` placeholder, and every fee is
  preliminary.
- **Promote `deals.metadata.recording` → first-class deal columns** (`recorded_reel_page` /
  `recorded_crfn` / `recorded_at`, mirroring `existing_loans` with the reel-page-XOR-CRFN check) at
  live activation, when real CRFNs actually flow.
- The **Exception Triage `rejected_recording` derivation** (add the kind + derive it from the
  `recording.rejected` audit in `getOrgExceptions`) — a focused **immediate follow-up PR**, keeping
  this PR single-purpose. The durable signal ships here; the cross-deal `/exceptions` surfacing
  follows.
- The **ALTA 11.1-06 endorsement request to title** (spec §9.8 step 2) — a title-platform (Qualia)
  integration, deferred.
- The **durable poll cadence** (sleep + poll loop + timeout) at live activation — v1 is single-pass
  (submit-or-poll-once per invocation; re-poll on a future trigger). The dormant WDK durable wrap is
  **omitted** (following Doc-Gen, the most recent precedent — durable activation is a Connor-gated
  carry-over for the whole agent family).
- A Braintrust eval — the deterministic unit tests are the v1 gate (matching the no-LLM agents).

## 2. Why plan-and-submit, why single-pass

Real e-recording needs Simplifile + ACRIS credentials (vendor-gated), so v1 cannot actually submit.
But the **domain logic** is fully buildable now and is where the value sits: **venue routing** (the
five ACRIS boroughs vs. the upstate county clerk), **cover-sheet composition** (which forms each
venue × CEMA-type requires), and the **recording-fee math**. The submit/poll lifecycle is
single-pass (submit if not yet submitted, else poll once, record the outcome, exit) because the real
polling schedule — intervals, timeout, retry — is vendor-specific and unknowable while dormant;
deferring it to live activation avoids baking in a cadence we can't validate, and matches the three
most recent agents (IDP, Chain-of-Title, Doc-Gen are all single-pass). The agent handles **both**
CEMA types (the cover-sheet rules generalize for free); Purchase-CEMA simply adds the NYC-RPT /
TP-584 transfer-tax forms.

**Distinction:** Recording Prep computes the **recording fee** (the clerk's filing fee, a function of
page count + flat county fees) — _not_ the **mortgage recording tax** (the §255-exempt computation on
the gap, owned by Intake/Doc-Gen via MT-15). Recording Prep does **not** regenerate MT-15 (Doc-Gen
owns it); it composes only the venue cover sheets that nothing else emits.

## 3. Pure core — `@cema/agents-recording-prep` (new 29th package)

No `@cema/db`, takes plain data (`DealRecordingInput`), node-testable. Reuses `DocumentKind` +
`GATE_REQUIRED_KINDS` + `RecordingRef` from `@cema/collateral`.

```ts
// types.ts
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
// thin deterministic field-map. `fields` is the document's own content (venue, fee
// amounts) — stored in documents.extractedData (the IDP/Doc-Gen precedent), NOT logged.
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

```ts
// venue.ts (sketch)
// NYC counties (and borough aliases) — the fallback signal when acrisBbl is absent.
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

// Primary signal: the acrisBbl borough digit (the DB enforces ^[1-5]-\d{1,5}-\d{1,4}$).
// Fallback: the county name. Else upstate.
export function resolveVenue(input: DealRecordingInput): VenueResolution {
  const bbl = input.acrisBbl?.match(/^([1-5])-/);
  if (bbl) return { venue: 'acris', borough: Number(bbl[1]) };
  const borough = NYC_BOROUGH_BY_COUNTY[input.county.trim().toLowerCase()];
  if (borough) return { venue: 'acris', borough };
  return { venue: 'county', borough: null };
}
```

```ts
// plan.ts (sketch)
import { GATE_REQUIRED_KINDS, type DocumentKind } from '@cema/collateral';
import { resolveVenue } from './venue';

const GATE_SET = new Set<DocumentKind>(GATE_REQUIRED_KINDS);

// The cover-sheet kinds this agent emits (a subset of DOCUMENT_KINDS). Title +
// gate flag per kind. Unlike Doc-Gen, the emitted set is a MIX of gated and
// non-gated kinds (county_cover_sheet is gated; acris/rpt/584 are not), so the
// gate flag is derived per-kind from GATE_SET (the IDP pattern), not asserted
// "all gated".
const TITLE_BY_KIND = {
  acris_cover_pages: 'ACRIS Recording & Endorsement Cover Pages',
  county_cover_sheet: 'County Clerk Recording Cover Sheet',
  nyc_rpt: 'NYC Real Property Transfer Tax Return (NYC-RPT)',
  tp_584: 'NY TP-584 Combined Transfer Tax Return',
} satisfies Partial<Record<DocumentKind, string>>;

type EmittedKind = keyof typeof TITLE_BY_KIND;

// Load-time guards: every emitted kind is a real DocumentKind with a title (TS
// `satisfies`), AND its gate membership is internally consistent — i.e. the gate
// flag we will persist equals GATE_SET.has(kind). (A future edit that flips a
// kind's gate status without the DB CHECK agreeing would be caught here + by the
// documents_attorney_gate_required CHECK + by the enqueue.)

export function planRecording(input: DealRecordingInput): RecordingPlan {
  const { venue, borough } = resolveVenue(input);
  const isPurchase = input.cemaType === 'purchase_cema';
  const pageCount = input.pageCount ?? ESTIMATED_CEMA_PAGE_COUNT;

  const kinds: EmittedKind[] = [];
  if (venue === 'acris') kinds.push('acris_cover_pages');
  else kinds.push('county_cover_sheet');
  if (venue === 'acris' && isPurchase) kinds.push('nyc_rpt'); // NYC RPT
  if (isPurchase) kinds.push('tp_584'); // statewide transfer return

  const fees = computeFees(input.county, pageCount); // placeholder schedule
  const coverSheets = kinds.map((kind) => make(kind, input, venue, fees));
  return { venue, borough, coverSheets, fees };
}
// make(kind, input, venue, fees) -> { kind, attorneyReviewRequired: GATE_SET.has(kind),
//   title: TITLE_BY_KIND[kind], fields: { dealId, venue, total: fees.total, ... } }
```

### The cover-sheet set (by venue × CEMA type)

| Cover sheet          | When                        | Gate-required |
| -------------------- | --------------------------- | ------------- |
| `acris_cover_pages`  | venue = ACRIS (NYC)         | —             |
| `county_cover_sheet` | venue = county (upstate)    | ✅            |
| `nyc_rpt`            | ACRIS **and** Purchase-CEMA | —             |
| `tp_584`             | Purchase-CEMA (any venue)   | —             |

Only `county_cover_sheet` is in `GATE_REQUIRED_KINDS`, so only it is enqueued to the attorney review
queue. (For the ~75% Refi-CEMA case: NYC → just `acris_cover_pages`; upstate → just
`county_cover_sheet`.)

## 4. App dispatcher — `apps/web/lib/agents/recording-prep/`

- `deal-data.ts` — `loadRecordingInput(organizationId, dealId): Promise<DealRecordingInput | null>`:
  RLS-reads the deal (`cemaType`, `propertyId → properties.county` + `properties.acrisBbl`). Returns
  `null` if the deal or property is missing. `pageCount` is left undefined (the core applies the
  placeholder). A mockable seam (the dispatcher test never touches the Drizzle chain).
- `persist.ts` —
  - `hasExistingRecordingPackage(organizationId, dealId): Promise<boolean>`: idempotency anchor — a
    `documents` row of kind ∈ {`acris_cover_pages`, `county_cover_sheet`} already exists for the
    deal. (Exactly one cover-sheet venue applies per deal, so either anchor means already-prepared.)
  - `persistCoverSheet(organizationId, actorUserId, dealId, sheet)`: insert one `documents` row
    (`kind`, gate flag from the plan, `status: 'draft'`, `extractedData: fields`, no blob) and, if
    gate-required, enqueue into `document_review_queue` (`onConflictDoNothing` on
    `(documentId, documentVersion)`, `submittedById = actorUserId`) + emit
    `document.submitted_for_review` on a real insert (`source: 'recording-prep'`). The IDP/Doc-Gen
    pattern, co-transactional in one `withRls`. `documents` is deal-owned (no `organizationId`
    column).
  - `persistRecordingCoordinates(organizationId, dealId, venue, ref)`: write
    `deals.metadata.recording = { venue, reelPage, crfn, recordedAt }` under `withRls` (merge into
    the existing jsonb). Asserts exactly one of `reelPage` / `crfn` is present (the
    reel-page-XOR-CRFN invariant; `recordedAt` is the agent's processing time — see note).
- `adapter.ts` — `recordingAdapter` = `new FixtureRecordingAdapter()` (the Simplifile/ACRIS swap
  point).
- `run-recording-prep.ts` — `runRecordingPrep(dealId)`:
  - **Self-resolves** org + actor (`getCurrentOrganizationId`/`getCurrentUser`, like
    `runDocGen`/`runOutreachFromDeal`); opens span `recording.run` (PII-safe attrs:
    `recording.deal_id`, `recording.venue`, `recording.cover_sheet_count`, `recording.status`).
  - **Idempotency:** if `hasExistingRecordingPackage` → skip (already prepared).
  - `loadRecordingInput`; if `null` → return. `planRecording(input)`.
  - **Split audit** `recording.evaluated` (`metadata { venue, count }`) — before any write.
  - **Per cover sheet** (co-transactional): `persistCoverSheet`.
  - `recordingAdapter.submit(plan)` → `poll(submissionId)` once (single-pass), then branch on
    `status`:
    - `not_submitted` / `pending` (the dormant + live-in-flight path) → audit `recording.submitted`
      (`metadata { venue, count }`).
    - `accepted` (dormant / test) → `persistRecordingCoordinates` + audit `recording.completed`
      (`metadata { venue }`). The agent does **not** flip the deal to `completed` (a
      processor/`transitionDealStatus` action — hard rule #6 stays a human-gated step; avoids agent
      re-entrancy into the status write path).
    - `rejected` (dormant / test) → audit `recording.rejected` (`metadata { venue, reason }` — a
      static token). The durable Exception-Triage signal.

  Inherits the dispatcher's best-effort swallow + `deal.agent_dispatch_failed` audit (this may throw;
  the dispatcher handles it).

> **Note on `recordedAt`:** the recording authority's true recorded-at timestamp arrives in the
> (dormant) poll result. v1 stores the value the adapter returns; the Fixture path is test-only.
> Because the pure core forbids a clock, the timestamp is read at the dispatcher boundary, not in the
> core.

## 5. Trigger — extend the agent dispatcher

- `on-deal-status-changed-core.ts` — `triggerForStatus`: add `recording → 'recording_prep'` (extend
  the `AgentTrigger` union with `'recording_prep'`).
- `on-deal-status-changed.ts` — for the `recording_prep` trigger, `await runRecordingPrep(dealId)`
  (inherits the best-effort swallow + `deal.agent_dispatch_failed` audit).

Spec §9.8's "attorney-approved closing package" maps to the `recording` lifecycle state for v1 (the
deal advances `closing → recording` after the attorney-approved package is ready); a finer
"approval-event" trigger is deferred.

## 6. UI legibility (in this PR — minor)

Add labels for the four new audit actions (`recording.evaluated`, `recording.submitted`,
`recording.completed`, `recording.rejected`) to `describeAuditEvent` (the deal Agent-Activity
timeline + the org dashboard feed both consume it). The map already PII-safe-fallbacks unmapped
actions to a humanized label, so this is polish — explicit labels read cleaner. Detail builders stay
within the whitelisted-field discipline (venue/count tokens only — never field-map values).

## 7. Compliance (hard rule #2) + PII (hard rule #3) + recording (hard rule #6)

- **#2 (attorney gate):** `county_cover_sheet` is gate-required → `attorneyReviewRequired = true` +
  enqueued to `document_review_queue` + backstopped by the `documents_attorney_gate_required` DB
  CHECK. The non-gated cover sheets (`acris_cover_pages` / `nyc_rpt` / `tp_584`) are administrative
  and are correctly **not** gated. The per-kind `GATE_SET.has(kind)` derivation (IDP pattern) + the
  load-time consistency guard keep this honest. All cover sheets are `status: 'draft'` and never
  auto-`executed`/`recorded`.
- **#3 (PII in logs):** cover sheets legitimately carry `venue` + fee amounts in
  `documents.extractedData` (their own content — the IDP/Doc-Gen precedent); no SSN/borrower name in
  a field-map. Audits/logs/spans carry only `venue` / `count` / static tokens — never field values.
  The rejection reason is a **static enum token**, never the recording authority's free-text (which
  could echo party/address data).
- **#6 (recording):** the agent records reel/page **or** CRFN (XOR-asserted) to
  `deals.metadata.recording` on acceptance, and emits `recording.completed`. It never marks the deal
  `recorded`/`completed` itself — that stays a processor/`transitionDealStatus` action, so the
  "reel/page-or-CRFN required" guarantee is preserved (coordinates captured before any human advances
  the deal).
- **Placeholders flagged:** `RECORDING_FEE_SCHEDULE` + `ESTIMATED_CEMA_PAGE_COUNT` are Connor-gated
  placeholders; fees are preliminary until the real county fee schedules + rendered page counts land.

## 8. Testing

- **Package** (`@cema/agents-recording-prep`):
  - `venue.test.ts` — `resolveVenue`: each borough via `acrisBbl` (1-5); each NYC county/alias via
    fallback; an upstate county → `county`; `acrisBbl` takes precedence over a conflicting county
    name; case/whitespace tolerance.
  - `plan.test.ts` — composition: Refi NYC → `[acris_cover_pages]`; Refi upstate →
    `[county_cover_sheet]`; Purchase NYC → `[acris_cover_pages, nyc_rpt, tp_584]`; Purchase upstate →
    `[county_cover_sheet, tp_584]`; gate flags (`county_cover_sheet` gated, others not) match
    `GATE_SET`; fee math (base + per-page × pageCount + flat county fee; placeholder default page
    count); titles/fields are PII-free (no borrower name/SSN).
  - `adapter.test.ts` — `FixtureRecordingAdapter.submit` → `{ submitted: false }`, `poll` →
    `{ status: 'not_submitted' }`.
- **App** (`apps/web`):
  - `run-recording-prep.test.ts` — happy path (NYC refi): persists 1 cover sheet + `recording.evaluated`
    → `recording.submitted`; upstate refi enqueues the `county_cover_sheet`; idempotent: skips when a
    cover sheet exists; missing data: no-op; **accepted** branch (mock poll → accepted): writes
    `deals.metadata.recording` + `recording.completed`; **rejected** branch (mock poll → rejected):
    `recording.rejected` + no coordinates. Mock `loadRecordingInput` + the persist/adapter seams.
  - `on-deal-status-changed` test extended: `recording` runs `runRecordingPrep`; a non-trigger status
    does not.
  - `describeAuditEvent` test extended: the four `recording.*` actions render their labels +
    PII-safe details.
  - **Neon-gated integration** (`recording-prep-persist.test.ts`, skip-green): real insert of an
    upstate `county_cover_sheet` → gate flag + enqueue + `document.submitted_for_review`;
    `persistRecordingCoordinates` writes `deals.metadata.recording`; cross-org RLS. Distinct UUID
    block (see the shared-Neon-branch hazard memo).

Target: ~28 tests. **0 migrations.** Package count 28 → **29**.

## 9. File structure

```text
packages/agents/recording-prep/
  package.json            # @cema/agents-recording-prep (+ @cema/collateral dep)
  tsconfig.json
  src/
    types.ts
    venue.ts
    plan.ts
    adapter.ts
    index.ts
    venue.test.ts
    plan.test.ts
    adapter.test.ts
apps/web/lib/agents/recording-prep/
  deal-data.ts            # loadRecordingInput RLS loader (mockable seam)
  persist.ts              # hasExistingRecordingPackage + persistCoverSheet + persistRecordingCoordinates
  adapter.ts              # FixtureRecordingAdapter instance (Simplifile/ACRIS swap point)
  run-recording-prep.ts   # runRecordingPrep dispatcher (plan -> persist -> submit -> poll, split audit, span)
  run-recording-prep.test.ts
apps/web/lib/agents/on-deal-status-changed-core.ts  # + recording -> 'recording_prep'
apps/web/lib/agents/on-deal-status-changed.ts       # + runRecordingPrep for 'recording_prep'
apps/web/lib/agents/on-deal-status-changed.test.ts  # + recording trigger case
apps/web/lib/agent-activity/describe-audit-event.ts # + 4 recording.* labels + detail builders
apps/web/tests/integration/recording-prep-persist.test.ts  # Neon-gated, skip-green
apps/web/package.json     # + @cema/agents-recording-prep dep
```
