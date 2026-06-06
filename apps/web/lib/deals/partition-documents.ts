import type { DealDocumentReviewItem } from '@/lib/queries/deal-documents-review';

/**
 * Document kinds the agent layer PRODUCES — the Doc-Gen package (spec §9.7) and
 * the Recording-Prep cover sheets (spec §9.8) — as opposed to instruments
 * classified FROM the prior servicer's collateral file (which the IDP populates
 * with an InstrumentRecord). Used to label a deal's documents as the generated
 * CEMA package vs. the received collateral file.
 *
 * Note `aom` appears here: a Doc-Gen-generated Assignment of Mortgage has no
 * InstrumentRecord, while an IDP-classified one does — the instrument-first rule
 * in partitionDealDocuments keeps the two apart regardless of this set.
 */
export const GENERATED_DOCUMENT_KINDS: ReadonlySet<string> = new Set([
  // Doc-Gen (spec §9.7)
  'cema_3172',
  'consolidated_note',
  'gap_note',
  'gap_mortgage',
  'aff_255',
  'aff_275',
  'mt_15',
  'aom',
  // Recording Prep (spec §9.8)
  'acris_cover_pages',
  'county_cover_sheet',
  'nyc_rpt',
  'tp_584',
]);

export interface PartitionedDealDocuments {
  /** Instruments classified from the prior servicer's collateral file (the IDP). */
  readonly collateral: DealDocumentReviewItem[];
  /** CEMA documents generated for this deal (Doc-Gen + Recording Prep). */
  readonly generated: DealDocumentReviewItem[];
  /** Everything else (e.g. manually uploaded or not-yet-classified documents). */
  readonly other: DealDocumentReviewItem[];
}

/**
 * Split a deal's documents into three groups so the workspace can show the
 * RECEIVED collateral file separately from the GENERATED CEMA package.
 *
 * A document is `collateral` IFF the IDP classified it into an InstrumentRecord
 * (`instrument !== null`). That check takes precedence over kind, so a Doc-Gen
 * `aom` (instrument null) lands in `generated` while an IDP-classified `aom`
 * (instrument set) lands in `collateral`. Remaining documents are `generated`
 * when their kind is an agent-produced kind, else `other`. Pure + order-preserving.
 */
export function partitionDealDocuments(
  items: readonly DealDocumentReviewItem[],
): PartitionedDealDocuments {
  const collateral: DealDocumentReviewItem[] = [];
  const generated: DealDocumentReviewItem[] = [];
  const other: DealDocumentReviewItem[] = [];

  for (const item of items) {
    if (item.instrument !== null) {
      collateral.push(item);
    } else if (GENERATED_DOCUMENT_KINDS.has(item.kind)) {
      generated.push(item);
    } else {
      other.push(item);
    }
  }

  return { collateral, generated, other };
}
