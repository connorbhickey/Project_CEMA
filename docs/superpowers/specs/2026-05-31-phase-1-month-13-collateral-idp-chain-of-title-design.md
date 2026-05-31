# Phase 1 Month 13 — Collateral IDP Agent + Chain-of-Title Agent (Design)

**Status:** Proposed (design approved 2026-05-31; pending spec review → implementation plan)
**Author:** M13 (Claude Opus 4.8 + Connor Hickey)
**Relates to:** spec §9.5 (Collateral IDP Agent), §9.6 (Chain-of-Title Agent); ADR 0010 (Intake Agent blueprint); ADR 0011 (OTel); ADR 0012 (AI Gateway); ADR 0013 (WDK durable wrap); ADR 0014 (Servicer Outreach Agent)

---

## 1. Context

M10 shipped the Intake Agent (first Layer 3 agent) and M12 the Servicer Outreach Agent
(second) on a proven, orchestration-agnostic **pure-core blueprint**: a legally
load-bearing pure decision core, every effect injected via a `*Deps` object, an
adapter seam with a `Fixture*` default, additive env-gated LLM polish (never
legally load-bearing), split audit, an OTel parent + PII-safe child spans, a
dormant WDK durable wrap, and a Braintrust eval whose **offline scorers are the
real gate**.

M13 builds the **next two agents in the CEMA deal flow**, which form a pipeline:

```
intake (M10) → outreach (M12) → IDP → Chain-of-Title (M13) → doc-gen → recording
```

- **Collateral IDP Agent (§9.5):** classifies and extracts the prior-servicer
  collateral file (Note, Mortgage, intervening Assignments of Mortgage, Allonges,
  prior CEMAs) into structured per-document data.
- **Chain-of-Title Agent (§9.6):** consumes IDP's structured output, builds the
  directed instrument graph, detects breaks (missing assignment, lost note,
  ambiguity), and escalates.

The output contract of the first **is** the input contract of the second, so they
are designed together (this doc) but **built in phases** (IDP first — it is the
dependency).

## 2. Scope & decomposition

**Both agents are in scope for M13**, structured as: one design doc (this file)
covering both cores plus the contract between them; the implementation plan phases
the build so **IDP lands first** as a small-PR series, then **Chain-of-Title**,
each as its own workspace package.

- `@cema/agents-collateral-idp` — the 22nd workspace package
- `@cema/agents-chain-of-title` — the 23rd workspace package

This keeps each agent on the one-core-per-agent blueprint (cores testable in
isolation) and each PR reviewable, while guaranteeing the seam between them is
designed once and cannot drift.

## 3. Architecture (chosen: pure cores, chain recomputed)

**Decision:** two pure cores; IDP writes typed instrument records into the existing
`documents.extractedData` jsonb column; Chain-of-Title is a **pure function** over
those records, producing a `ChainAnalysis` that is **recomputed per run, not
persisted**. **0 new migrations, 0 `@cema/kg` coupling.**

Rejected alternatives:

- **Persist the chain to `kg_edges`** (new `assigns_to`/`consolidates` predicates):
  makes the chain a first-class, traversable graph, but adds surface (predicate-union
  extension, edge-write idempotency) for a consumer that does not exist yet. Becomes
  a carry-over the moment a workspace feature needs to query the chain.
- **Shared `@cema/collateral` domain package:** centralizes the contract, but is
  premature abstraction for two tightly-paired consumers. Becomes a carry-over if a
  third consumer of `InstrumentRecord` appears.

**Rationale.** A chain-of-title analysis is a pure function of the extracted
instrument set, exactly like M12's `planOutreachCadence` recomputes from its
earliest-touch anchor. Storing it risks staleness (re-extract a document and the
stored graph lies) for a queryability benefit nothing currently consumes. Recompute
now; persist only when a second reader justifies it.

> **Spec divergence flagged (hard rule #11 — not "fixed" here):** spec §9.6 says
> Chain-of-Title "uses existing `@cema/kg` (Apache AGE)". In reality `@cema/kg` is a
> relational adjacency store over a `kg_edges` table (recursive-CTE `traverse`), not
> Apache AGE, and its `Predicate` union is entity-resolution-only. M13 does not
> depend on `@cema/kg` at all (Approach A). A spec correction (AGE → relational; the
> chain is recomputed, not stored in the KG) should be raised as a separate
> Connor-approved spec PR.

## 4. Agent 1 — Collateral IDP

Core entrypoint: `runCollateralIdp(dealId, deps: IdpDeps): Promise<IdpResult>`.

### 4.1 `adapter.ts` — the dormant vendor seam

```ts
interface IdpAdapter {
  // Segments a multi-page collateral PDF into per-instrument raw extractions.
  extractDocuments(blobUrl: string): Promise<RawExtraction[]>;
}
```

PDF **splitting is a vendor concern** (Reducto / AWS Textract Lending / Vaultedge),
so it lives behind the seam. `FixtureIdpAdapter` returns deterministic canned
segments keyed off a fixture id. The real vendor adapter is a **carry-over**
(provisioning-gated, exactly like M12's Resend channel). A segment the adapter
cannot read (no / low-confidence extraction) yields an `unreadable` outcome — the
core **never fabricates** extraction, mirroring M12's `unsupported_channel`
"never silently no-op" rule.

### 4.2 `classify.ts` — pure, load-bearing

`RawExtraction → { kind: DocumentKind; attorneyReviewRequired: boolean; confidence: number }`

Maps extraction signals onto the existing 25-value `document_kind` enum (no new enum
values). **Attorney-gate derivation is deterministic:** if `kind` is one of the 14
gate-required kinds (`cema_3172`, `exhibit_a..d`, `gap_note`, `gap_mortgage`,
`consolidated_note`, `aom`, `allonge`, `aff_255`, `aff_275`, `mt_15`,
`county_cover_sheet`), then `attorneyReviewRequired = true` — which is exactly what
the DB check constraint `documents_attorney_gate_required` demands on insert.

Incoming collateral documents are **historical** — we never mark them `executed`
or `recorded` — so the boolean is a harmless-but-required truth that satisfies the
constraint and keeps hard rule #2 honest at the schema layer.

### 4.3 `extract.ts` — pure

Classified `RawExtraction → InstrumentRecord` (see §6). Normalizes dates, amounts,
party names, recording reference (reel/page **or** CRFN — mutually exclusive per the
`documents_recording_xor` constraint), county, and the `references` pointer to the
instrument this one assigns or consolidates. Recorded-instrument fields are
county-clerk **public record** (not SSN-class PII), but spans still never carry
party names, amounts, or document text.

### 4.4 `orchestrator.ts` — `runCollateralIdp`

Flat await chain (maps 1:1 onto one WDK step):

1. `idp.run` parent span opens.
2. `deps.loadContext(dealId)` → collateral-file blob ref(s) (child `idp.load_context`).
3. `deps.idp.extractDocuments(blobUrl)` → `RawExtraction[]` (child `idp.extract_documents`).
4. pure `classify` + `extract` per segment → `ClassifiedDoc[]` + `unreadable[]`.
5. `deps.emitAudit({ action: 'idp.evaluated', ... })` **before any write** (child `idp.emit_evaluated`) — split-audit first half.
6. `deps.persistDocuments(classified)` → upserts `documents.kind` + `extractedData`, co-transactional with `idp.documents_classified` audit (child `idp.persist_documents`) — split-audit second half.
7. return `IdpResult { dealId, documents: ClassifiedDoc[], unreadable: UnreadableSegment[] }`.

## 5. Agent 2 — Chain-of-Title

Core entrypoint: `runChainOfTitle(dealId, deps: ChainDeps): Promise<ChainResult>`.

### 5.1 `chain.ts` — pure, THE legally load-bearing analysis

`InstrumentRecord[] → ChainAnalysis { edges: ChainEdge[]; breaks: ChainBreak[]; status: ChainStatus }`

Builds the directed instrument graph (each AOM → an `assigns_to` edge; each CEMA →
a `consolidates` edge) and walks from the originating recorded mortgage(s) to the
current holder.

**Dangerous-failure guard:** `status = 'clean'` **only** on a provably unbroken path
from origin to current holder. Default to `'broken'` / `'ambiguous'` under **any**
uncertainty — never default to clean. A false "clean" (silently blessing a chain
with a real gap) is the worst failure: a wrongly-blessed chain flows downstream into
doc-gen and recording.

### 5.2 Break taxonomy + hybrid routing

| `BreakKind`             | Meaning                                                           | Routes to                                          |
| ----------------------- | ----------------------------------------------------------------- | -------------------------------------------------- |
| `missing_assignment`    | gap — an assignment from a party that never received the mortgage | **re-chase** (M12 outreach entrypoint)             |
| `lost_note`             | a Note with no recorded mortgage / no chain                       | **attorney_review** (escalation seam)              |
| `ambiguous_assignment`  | conflicting or securitization-era ambiguity                       | **attorney_review**                                |
| `unrecorded_instrument` | instrument present but no recording reference                     | **attorney_review**                                |
| _(none — clean)_        | provably unbroken path                                            | **advisory_pass** — flag only, **no auto-advance** |

### 5.3 `route.ts` — pure (hybrid output authority)

`ChainBreak[] → RouteDecision[]`. **Auto-escalate, never auto-bless:**

- `missing_assignment` → `{ kind: 're_chase' }` — a chaseable gap routes back into
  M12's outreach. The routing **decision** is pure and real; the re-chase **effect**
  rides M12's **dormant** entrypoint (M12 carry-over #2 — nothing triggers outreach
  live yet).
- `lost_note` / `ambiguous_assignment` / `unrecorded_instrument` →
  `{ kind: 'attorney_review' }` — escalates to a human. The routing **decision** is
  pure and real and recorded in the `chain.routed` audit event; the **effect** rides a
  **dormant `openAttorneyReview` seam**. (The existing `document_review_queue` is
  document-version-scoped — the M5 DocuSign-send gate, `document_id` NOT NULL — so it
  cannot hold a `missing_assignment`-style break, which has _no_ document; a real
  deal-scoped review surface is carry-over #4.)
- `clean` → `{ kind: 'advisory_pass' }` — flag only; **never** auto-advances
  `deal_status`. A clean verdict is a recommendation a processor/attorney confirms.

### 5.4 `orchestrator.ts` — `runChainOfTitle`

1. `chain.run` parent span opens.
2. `deps.loadInstruments(dealId)` → `InstrumentRecord[]` from IDP-written `extractedData` (child `chain.load_instruments`).
3. pure `chain` analysis → `ChainAnalysis`.
4. `deps.emitAudit({ action: 'chain.analyzed', status, ... })` **before routing** (child `chain.emit_analyzed`) — split-audit first half.
5. pure `route` → `RouteDecision[]`.
6. per route: dormant injected seams — `deps.routeReChase(...)` / `deps.openAttorneyReview(...)` (fixtures record the call, keyed for idempotency); the `chain.routed` audit event is the real, durable record of the decision (child `chain.route`) — split-audit second half. At actuator activation `chain.routed` becomes co-transactional with the real effect, mirroring M12's `outreach.touch_sent` + `communications` insert.
7. return `ChainResult { dealId, status, breaks, routes }`.

## 6. The contract — `InstrumentRecord`

IDP **owns** this type (it produces it); Chain-of-Title **type-imports** it from
`@cema/agents-collateral-idp` (type-only, one-directional, matching build order — no
runtime coupling, no shared package). The type-checker enforces the seam at
`pnpm typecheck` and fails loudly if either side drifts.

```ts
interface RecordingRef {
  readonly reelPage: string | null; // upstate
  readonly crfn: string | null; // NYC — mutually exclusive with reelPage
}

interface InstrumentRecord {
  readonly documentId: string; // the documents.id this was extracted from
  readonly instrumentKind: DocumentKind; // note | mortgage | aom | allonge | consolidated_note | cema_3172 | ...
  readonly assignor: string | null; // party transferring (AOM)
  readonly assignee: string | null; // party receiving (AOM)
  readonly executedAt: string | null; // ISO date
  readonly recordedAt: string | null; // ISO date
  readonly amount: number | null; // recorded instrument amount (public record)
  readonly recordingRef: RecordingRef;
  readonly county: string | null;
  readonly references: string | null; // documentId this instrument assigns/consolidates
}
```

Promoting `InstrumentRecord` to a shared `@cema/collateral` package is a carry-over
(rejected Approach C), deferred until a third consumer justifies it.

## 7. Output authority (settled)

**Hybrid — auto-escalate, never auto-bless** (§5.2–§5.3). This is spec §9.6's
eventual intent: automate the _safe_ direction (escalating breaks into chase /
attorney review) while requiring human sign-off on the _risky_ direction (declaring
a chain clean and proceeding). Neither M10 nor M12 auto-advances a deal; M13 holds
that line.

## 8. Cross-cutting

### 8.1 Split audit (`audit_events`, reused — PII-safe)

| Agent | Before any write (every run)        | Co-transactional with the write                                         |
| ----- | ----------------------------------- | ----------------------------------------------------------------------- |
| IDP   | `idp.evaluated`                     | `idp.documents_classified` (with the real `extractedData` upsert)       |
| Chain | `chain.analyzed` (carries `status`) | `chain.routed` (real audit now; with the effect at actuator activation) |

Attributes: action + `dealId` + counts / status enum only — never party names,
amounts, or text.

### 8.2 OTel (ADR 0011 pattern)

Parent span + one child span per awaited boundary, allowlist-enforced by each
package's `orchestrator.trace.test.ts`:

- `idp.run` → `idp.load_context`, `idp.extract_documents`, `idp.emit_evaluated`, `idp.persist_documents`
- `chain.run` → `chain.load_instruments`, `chain.emit_analyzed`, `chain.route`

Allowlisted attributes: `deal_id`, `document_count`, `unreadable_count`,
`gate_required_count`, `edge_count`, `break_count`, `status`.

### 8.3 Durable wrap (dormant; ADR 0013 pattern)

Both cores are **single-pass** (not a cadence), so each is **one `'use step'` with no
sleep loop** — simpler than M12 (no `MAX_ITERATIONS`). Durability here protects
against **failure, not time**: a flaky / slow vendor extraction call, or a crash
between "extracted" and "persisted." Two independent dormant workflows
(`idpWorkflow` → `runCollateralIdpStep`; `chainWorkflow` → `runChainOfTitleStep`); a
durable IDP→Chain hand-off (`collateralPipelineWorkflow`) is a carry-over. The
mocked-step orchestration test is the behavioral guard; the `@workflow/vitest` proof
is deferred (ADR 0013 carry-over #5, same `@cema/*`-externalization cause). Dormant
`run<Agent>FromDealDurable` actions inherit M12's fire-and-forget activation
carry-over (the `Promise<Result>` contract becomes return-`runId` at activation).

### 8.4 Error handling / dangerous-failure edges

- **IDP:** unreadable segment → `unreadable` outcome (not a throw); vendor adapter
  throws → record exception + span error + rethrow (let the durable step retry); a
  test asserts every classified gate-kind satisfies `documents_attorney_gate_required`.
- **Chain:** **zero instruments → `ambiguous`** (cannot _prove_ clean →
  attorney_review, never a silent pass); lone mortgage + no assignments (common
  refi-CEMA) → `clean` only if it _is_ the current holder; cyclic / duplicate edges →
  `ambiguous`.

### 8.5 Idempotency

- IDP `persistDocuments` upserts by `(dealId, document identity)` — a re-run
  re-classifies without duplicating rows.
- Chain is pure — identical output on replay.
- Route-effect seams are keyed `chain:<dealId>:break:<hash>` so a re-run does not
  duplicate a chase / review item (mirrors M12's `outreach:<dealId>:touch:<n>`); the
  `chain.routed` audit row carries the same key.

## 9. Testing & evals (success criteria)

Offline scorers are the **real gate** (required `Unit tests` job); the live
`Eval()` run is skip-green unless keys are set — exactly like M12.

- **Unit:** exhaustive over `classify` / `extract` / `chain` / `route` (every break
  kind, every gate kind); mocked-deps orchestration (`orchestrator.test.ts`); PII-safe
  trace guard (`orchestrator.trace.test.ts`); mocked-step durable guard
  (`<agent>.workflow.test.ts`).
- **IDP eval** (≥ 20 collateral-file fixtures): classification correctness ·
  extraction completeness · no-PII-leak · attorney-gate-boolean correctness.
- **Chain eval** (≥ 20 fixtures, clean + every break kind):
  **no-false-clean (the critical scorer — a fixture with a real break must NEVER
  score clean)** · break-taxonomy correctness · routing correctness.

## 10. What ships real vs. dormant

**Real & testable now:** both pure cores (classify / extract / chain / route), the
orchestrators, split audit (incl. the `chain.routed` record of every routing
decision), OTel spans, `FixtureIdpAdapter`, all unit tests + offline eval scorers, the
dormant durable wrap's mocked-step guard.

**Dormant (carry-over):** the real vendor `IdpAdapter` (Reducto/Textract/Vaultedge);
the live trigger that invokes either agent; **both route-effect actuators** — the
`re_chase` arm (rides M12's dormant outreach trigger) and the `attorney_review` arm
(awaits a deal-scoped review surface, carry-over #4); the WDK backend + durable proof;
the live Braintrust run (keys).

## 11. Package layout & file inventory

Each package mirrors `packages/agents/servicer-outreach/`:

```
packages/agents/collateral-idp/
  src/{types,classify,classify.test,extract,extract.test,adapter,adapter.test,
       orchestrator,orchestrator.test,orchestrator.trace.test,index}.ts
  evals/{fixtures,scorers,scorers.test,collateral-idp.eval}.ts + run.mjs
  package.json tsconfig.json

packages/agents/chain-of-title/
  src/{types,chain,chain.test,route,route.test,
       orchestrator,orchestrator.test,orchestrator.trace.test,index}.ts
  evals/{fixtures,scorers,scorers.test,chain-of-title.eval}.ts + run.mjs
  package.json tsconfig.json
```

App wiring per agent mirrors M12:

```
apps/web/lib/agents/collateral-idp/{deps,run-collateral-idp-action,idp.steps,
  idp.workflow,idp.workflow.test,run-collateral-idp-durable-action}.ts
apps/web/lib/agents/chain-of-title/{deps,run-chain-of-title-action,chain.steps,
  chain.workflow,chain.workflow.test,run-chain-of-title-durable-action}.ts
```

**Migrations: 0.** Reuses `documents` (kind + `extractedData`) and `audit_events`.

## 12. Build phasing

1. **Phase 1 — Collateral IDP** (the dependency): package scaffold + types +
   `classify` + `extract` + `FixtureIdpAdapter` + orchestrator + trace test → app
   wiring → dormant durable wrap → Braintrust eval. Small-PR series like M12 (#81–#86).
2. **Phase 2 — Chain-of-Title:** package scaffold + types (type-import
   `InstrumentRecord`) + `chain` + `route` + orchestrator + trace test → app wiring →
   dormant durable wrap → Braintrust eval.

The break-classification predicate in `chain.ts` (which `BreakKind` a given graph
defect is) is the highest-judgment piece — it encodes CEMA title knowledge that
decides chase-vs-escalate. It will be authored as a focused, well-scaffolded
contribution with the tradeoffs spelled out.

## 13. Carry-overs (anticipated)

1. **Real vendor `IdpAdapter`** (Reducto / Textract Lending / Vaultedge) +
   `packages/integrations/<vendor>/` (hard rule #12) + spec §16 row; one-line swap.
2. **Wire live triggers** for both agents (on collateral-file arrival → IDP; on IDP
   completion → Chain).
3. **`missing_assignment → re_chase` activation** depends on M12 carry-over #2 (a live
   outreach trigger).
4. **Deal-scoped attorney-review surface.** The existing `document_review_queue` is
   document-version-scoped (the M5 DocuSign-send gate; `document_id` NOT NULL), so it
   cannot hold a `missing_assignment` break (a _missing_ document) or a deal-level
   chain exception. Activating the `attorney_review` arm's **effect** needs a real
   deal-scoped review/exception surface (or a deliberate adaptation of the queue);
   until then the routing decision is real + audited and the effect rides the dormant
   `openAttorneyReview` seam.
5. **Persist the chain to `kg_edges`** (Approach B) if/when a workspace feature needs
   to traverse the legal chain.
6. **Promote `InstrumentRecord` to `@cema/collateral`** (Approach C) if a third
   consumer appears.
7. **Durable IDP→Chain pipeline hand-off** (`collateralPipelineWorkflow`) + the
   `@workflow/vitest` proof + WDK backend.
8. **Provision `BRAINTRUST_API_KEY` / `AI_GATEWAY_API_KEY`** for the live evals (the
   offline scorers are the gate meanwhile).

## 14. Compliance notes (hard rules touched)

- **Hard rule #2 (attorney gate):** §4.2 — IDP sets `attorneyReviewRequired = true`
  for the 14 gate kinds, satisfying the DB constraint; incoming collateral docs never
  transition to `executed`/`recorded`.
- **Hard rule #3 (no PII in logs):** §4.3, §8.1, §8.2 — spans/audit carry ids +
  counts + status only; recorded-instrument fields (public record) live in
  `extractedData`, never in traces.
- **Hard rule #11 (spec is source of truth):** §3 — the `@cema/kg`/AGE divergence is
  _flagged_, not silently corrected.
- **Hard rule #12 (integration catalog):** §13 carry-over #1 — a real IDP vendor
  requires a `packages/integrations/<vendor>/` entry + spec §16 row.
