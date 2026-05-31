import type { DocumentKind, RawExtraction } from './types';
import { GATE_REQUIRED_KINDS } from './types';

const GATE_SET: ReadonlySet<DocumentKind> = new Set(GATE_REQUIRED_KINDS);

export function requiresAttorneyReview(kind: DocumentKind): boolean {
  return GATE_SET.has(kind);
}

// Ordered most-specific -> most-general. The FIRST signal whose lowercased
// text is a substring of the document's type/text wins, so multi-word
// instrument names (e.g. "allonge to note", "consolidation ... agreement")
// resolve before the bare nouns they contain ("note", "agreement").
//
// LEARNING-MODE CONTRIBUTION POINT: this synonym table is the highest-judgment
// piece of IDP -- it encodes how real collateral-file cover sheets name each
// instrument. Connor may extend/reorder it; ordering is load-bearing.
const KIND_BY_SIGNAL: ReadonlyArray<readonly [string, DocumentKind]> = [
  ['consolidation, extension', 'cema_3172'],
  ['consolidation and extension', 'cema_3172'],
  ['cema', 'cema_3172'],
  ['consolidated note', 'consolidated_note'],
  ['gap note', 'gap_note'],
  ['gap mortgage', 'gap_mortgage'],
  ['assignment of mortgage', 'aom'],
  ['assignment', 'aom'],
  ['allonge', 'allonge'],
  ['section 255', 'aff_255'],
  ['255 affidavit', 'aff_255'],
  ['section 275', 'aff_275'],
  ['275 affidavit', 'aff_275'],
  ['mt-15', 'mt_15'],
  ['mortgage recording tax return', 'mt_15'],
  ['county cover sheet', 'county_cover_sheet'],
  ['acris cover', 'acris_cover_pages'],
  ['tp-584', 'tp_584'],
  ['rpt', 'nyc_rpt'],
  ['payoff', 'payoff_letter'],
  ['authorization', 'authorization'],
  ['title commitment', 'title_commitment'],
  ['title policy', 'title_policy'],
  ['endorsement', 'endorsement_111'],
  ['exhibit a', 'exhibit_a'],
  ['exhibit b', 'exhibit_b'],
  ['exhibit c', 'exhibit_c'],
  ['exhibit d', 'exhibit_d'],
  ['mortgage', 'mortgage'],
  ['promissory note', 'note'],
  ['note', 'note'],
];

export function classify(raw: RawExtraction): {
  kind: DocumentKind;
  attorneyReviewRequired: boolean;
  confidence: number;
} {
  const haystack = (raw.fields.documentType ?? raw.text ?? '').toLowerCase();

  let kind: DocumentKind = 'other';
  for (const [signal, candidate] of KIND_BY_SIGNAL) {
    if (haystack.includes(signal)) {
      kind = candidate;
      break;
    }
  }

  return {
    kind,
    attorneyReviewRequired: requiresAttorneyReview(kind),
    confidence: raw.confidence,
  };
}
