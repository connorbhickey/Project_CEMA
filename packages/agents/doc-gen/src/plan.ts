import { GATE_REQUIRED_KINDS, type DocumentKind } from '@cema/collateral';

import type { DealDocGenInput, DocumentPlan, PlannedDocument } from './types';

const GATE_SET = new Set<DocumentKind>(GATE_REQUIRED_KINDS);

// The kinds this v1 emits (Refi-CEMA core). Titles are static + PII-free (they may
// carry public form numbers like MT-15 / Form 3172, which are not PII).
const TITLE_BY_KIND = {
  cema_3172: 'CEMA (NY Form 3172)',
  consolidated_note: 'Consolidated Note',
  gap_note: 'Gap Note',
  gap_mortgage: 'Gap Mortgage',
  aff_255: 'NY Tax Law Section 255 Affidavit',
  aff_275: 'NY Tax Law Section 275 Affidavit',
  mt_15: 'MT-15 Mortgage Recording Tax Return',
  aom: 'Assignment of Mortgage',
} satisfies Partial<Record<DocumentKind, string>>;

type EmittedKind = keyof typeof TITLE_BY_KIND;

// Load-time guard: every emitted kind must be gate-required (hard rule #2). If a
// future edit emits a non-gated kind, throw at module load rather than silently
// generate an ungated legal document.
for (const kind of Object.keys(TITLE_BY_KIND) as EmittedKind[]) {
  if (!GATE_SET.has(kind)) {
    throw new Error(`doc-gen emits a non-gate-required kind "${kind}" (hard rule #2)`);
  }
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

function make(
  kind: EmittedKind,
  input: DealDocGenInput,
  fields: Record<string, string | number>,
): PlannedDocument {
  return {
    kind,
    attorneyReviewRequired: GATE_SET.has(kind),
    title: TITLE_BY_KIND[kind],
    fields: { dealId: input.dealId, ...fields },
  };
}

/**
 * Pure, deterministic Refi-CEMA document planner (spec §9.7). Computes the gap,
 * runs the numbers-tie consistency check, and (only if consistent) returns the
 * core document set: always cema_3172/consolidated_note/aff_255/aff_275/mt_15;
 * gap_note + gap_mortgage when gap > 0; one aom per existing loan. No clock, no
 * LLM, no IO. PII-safe by construction (static titles + issue tokens).
 */
export function planDocuments(input: DealDocGenInput): DocumentPlan {
  const totalUpb = round2(input.existingLoans.reduce((sum, loan) => sum + loan.upb, 0));
  const gap = round2(input.newPrincipal - totalUpb);

  const issues: string[] = [];
  if (input.cemaType !== 'refi_cema') issues.push('not_refi_cema');
  if (input.existingLoans.length === 0) issues.push('no_existing_loans');
  if (input.newPrincipal <= 0) issues.push('new_principal_not_positive');
  if (gap < 0) issues.push('numbers_do_not_tie');

  const consistency = { ok: issues.length === 0, issues };
  if (!consistency.ok) return { documents: [], consistency, gap };

  const documents: PlannedDocument[] = [
    make('cema_3172', input, {
      county: input.county,
      newPrincipal: input.newPrincipal,
      totalUpb,
      gap,
    }),
    make('consolidated_note', input, { newPrincipal: input.newPrincipal, totalUpb }),
    make('aff_255', input, { totalUpb }),
    make('aff_275', input, { totalUpb }),
    make('mt_15', input, { gap, county: input.county }),
  ];
  if (gap > 0) {
    documents.push(make('gap_note', input, { gap }));
    documents.push(make('gap_mortgage', input, { gap, county: input.county }));
  }
  for (const loan of input.existingLoans) {
    documents.push(make('aom', input, { existingLoanId: loan.id, upb: loan.upb }));
  }
  return { documents, consistency, gap };
}
