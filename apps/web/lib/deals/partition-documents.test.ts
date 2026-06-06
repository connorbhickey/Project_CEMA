import type { InstrumentRecord } from '@cema/collateral';
import { describe, expect, it } from 'vitest';

import { GENERATED_DOCUMENT_KINDS, partitionDealDocuments } from './partition-documents';

import type { DealDocumentReviewItem } from '@/lib/queries/deal-documents-review';

// Only `instrument !== null` matters to the partition, so a minimal stub suffices.
const INSTRUMENT = {} as unknown as InstrumentRecord;

function item(over: Partial<DealDocumentReviewItem>): DealDocumentReviewItem {
  return {
    documentId: 'doc',
    kind: 'other',
    status: 'draft',
    version: 1,
    attorneyReviewRequired: false,
    instrument: null,
    generatedFields: null,
    queueId: null,
    reviewState: null,
    reviewerIsCurrentUser: false,
    ...over,
  };
}

describe('partitionDealDocuments', () => {
  it('classifies an IDP-classified instrument as collateral (instrument-first, even for a shared kind like aom)', () => {
    const result = partitionDealDocuments([item({ kind: 'aom', instrument: INSTRUMENT })]);
    expect(result.collateral).toHaveLength(1);
    expect(result.generated).toHaveLength(0);
    expect(result.other).toHaveLength(0);
  });

  it('classifies Doc-Gen documents (instrument null, generated kind) as generated, order-preserving', () => {
    const result = partitionDealDocuments([item({ kind: 'cema_3172' }), item({ kind: 'aom' })]);
    expect(result.generated.map((d) => d.kind)).toEqual(['cema_3172', 'aom']);
    expect(result.collateral).toHaveLength(0);
  });

  it('classifies a Recording-Prep cover sheet as generated', () => {
    const result = partitionDealDocuments([item({ kind: 'county_cover_sheet' })]);
    expect(result.generated).toHaveLength(1);
  });

  it('puts unclassified / non-agent documents in other', () => {
    const result = partitionDealDocuments([
      item({ kind: 'payoff_letter' }),
      item({ kind: 'note' }),
    ]);
    expect(result.other.map((d) => d.kind)).toEqual(['payoff_letter', 'note']);
    expect(result.generated).toHaveLength(0);
  });

  it('separates a received (classified) note from a generated package on a mixed deal', () => {
    const result = partitionDealDocuments([
      item({ kind: 'note', instrument: INSTRUMENT }), // received collateral
      item({ kind: 'cema_3172' }), // generated
      item({ kind: 'title_commitment' }), // other
    ]);
    expect(result.collateral.map((d) => d.kind)).toEqual(['note']);
    expect(result.generated.map((d) => d.kind)).toEqual(['cema_3172']);
    expect(result.other.map((d) => d.kind)).toEqual(['title_commitment']);
  });

  it('GENERATED_DOCUMENT_KINDS covers the Doc-Gen + Recording-Prep output kinds', () => {
    for (const kind of [
      'cema_3172',
      'consolidated_note',
      'gap_note',
      'gap_mortgage',
      'aff_255',
      'aff_275',
      'mt_15',
      'aom',
      'acris_cover_pages',
      'county_cover_sheet',
      'nyc_rpt',
      'tp_584',
    ]) {
      expect(GENERATED_DOCUMENT_KINDS.has(kind)).toBe(true);
    }
  });
});
