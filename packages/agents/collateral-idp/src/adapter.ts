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
