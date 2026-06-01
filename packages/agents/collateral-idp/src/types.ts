// The shared collateral-document vocabulary (DOCUMENT_KINDS/DocumentKind, the
// attorney-gate set GATE_REQUIRED_KINDS, RecordingRef, InstrumentRecord) now
// lives in @cema/collateral so it can be consumed without coupling to this
// agent package. Re-exported here so this package's public API is byte-identical
// for existing importers (adapter.ts, classify.ts, extract.ts, orchestrator.ts
// all import these from './types').
export {
  DOCUMENT_KINDS,
  GATE_REQUIRED_KINDS,
  type DocumentKind,
  type RecordingRef,
  type InstrumentRecord,
} from '@cema/collateral';

// Local bindings (the re-export above does not create them) for use in the
// interfaces below. Kept near the top so the ESLint import/first rule stays
// satisfied.
import type { DocumentKind, InstrumentRecord } from '@cema/collateral';

// A segment whose extraction confidence is below this floor is treated as
// unreadable and is NOT classified/persisted (it surfaces for human review).
// Stays in this package: it is an OCR-confidence tuning knob, not part of the
// shared instrument vocabulary.
export const UNREADABLE_CONFIDENCE_THRESHOLD = 0.5;

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
