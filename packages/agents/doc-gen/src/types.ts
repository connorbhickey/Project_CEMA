import type { DocumentKind } from '@cema/collateral';

// Doc-Gen vocabulary (spec §9.7). Refi-CEMA v1. Pure: no @cema/db, no clock, no
// LLM -- the planner takes plain data (DealDocGenInput) so it stays node-testable.

// Plain data the planner needs (decoupled from @cema/db). Amounts are numbers
// (the loader parses the decimal columns). cemaType is the raw enum value.
export interface DealDocGenInput {
  readonly dealId: string;
  readonly cemaType: string; // 'refi_cema' | 'purchase_cema'
  readonly newPrincipal: number; // newLoans.principal
  readonly existingLoans: ReadonlyArray<{ id: string; upb: number }>;
  readonly county: string;
  readonly borrowerNames: readonly string[];
}

// A planned document: its kind, the hard-rule-#2 gate flag, a human title, and a
// thin deterministic field-map. `fields` is the document's own content (names +
// amounts) -- stored in documents.extractedData (the IDP precedent), NOT logged.
export interface PlannedDocument {
  readonly kind: DocumentKind;
  readonly attorneyReviewRequired: boolean;
  readonly title: string;
  readonly fields: Readonly<Record<string, string | number>>;
}

// Deterministic consistency result. `issues` are static PII-free tokens.
export interface ConsistencyResult {
  readonly ok: boolean;
  readonly issues: readonly string[];
}

export interface DocumentPlan {
  readonly documents: readonly PlannedDocument[];
  readonly consistency: ConsistencyResult;
  readonly gap: number;
}

// Dormant render seam (DocMagic later). Fixture returns rendered:false (no blob).
export interface RenderResult {
  readonly rendered: boolean;
  readonly blobUrl?: string;
}

export interface DocGenAdapter {
  render(doc: PlannedDocument): Promise<RenderResult>;
}
