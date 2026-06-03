// Chain-of-Title types. This package type-imports the shared collateral
// vocabulary (the InstrumentRecord shape the Collateral IDP persists) from
// @cema/collateral -- it never imports @cema/db (the drift guard lives in
// @cema/collateral, kept in lockstep with the DB enum there). No runtime
// coupling to the IDP agent: these are type-only imports from the vocabulary
// package.
export type { DocumentKind, InstrumentRecord, RecordingRef } from '@cema/collateral';

// Local bindings (the re-export above does not create them) for use in the
// `satisfies readonly DocumentKind[]` guards and the interfaces below. Kept at
// the top so the ESLint `import/first` rule stays satisfied.
import type { DocumentKind, InstrumentRecord } from '@cema/collateral';

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

// A PII-free doc->doc structural edge: the assignment instrument `fromDocumentId`
// is recorded immediately before `toDocumentId` in the recorded assignment
// sequence (recordedAt order). Document ids ONLY -- never party names. The app
// persists these to the KG as `document -[chain_precedes]-> document`. Descriptive
// (recording-order), like ChainEdge -- it does not assert a verified succession.
export interface ChainSequenceEdge {
  readonly fromDocumentId: string;
  readonly toDocumentId: string;
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
// `breakKind` is the underlying break this decision routes (null for an
// advisory_pass) -- carried so a downstream actuator can persist the specific
// kind (e.g. the chain_break_review_queue.break_kind column) without re-deriving
// it. It is deliberately NOT part of the breakHash material (reason already
// encodes the kind, so the hash stays stable -- see break-hash.ts).
export interface RouteDecision {
  readonly dealId: string;
  readonly kind: RouteKind;
  readonly breakKind: BreakKind | null;
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
