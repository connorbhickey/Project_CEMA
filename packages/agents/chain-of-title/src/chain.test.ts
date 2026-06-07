import { describe, expect, it } from 'vitest';

import { analyzeChain } from './chain';
import type { DocumentKind, InstrumentRecord, RecordingRef } from './types';

const REC = (crfn: string): RecordingRef => ({ reelPage: null, crfn });
const UNREC: RecordingRef = { reelPage: null, crfn: null };

function inst(
  partial: Partial<InstrumentRecord> & { documentId: string; instrumentKind: DocumentKind },
): InstrumentRecord {
  return {
    assignor: null,
    assignee: null,
    executedAt: null,
    recordedAt: null,
    amount: null,
    recordingRef: REC(`crfn-${partial.documentId}`),
    county: null,
    references: null,
    ...partial,
  };
}

const mortgage = (id: string): InstrumentRecord =>
  inst({ documentId: id, instrumentKind: 'mortgage' });
const aom = (
  id: string,
  assignor: string,
  assignee: string,
  recordedAt: string,
): InstrumentRecord =>
  inst({ documentId: id, instrumentKind: 'aom', assignor, assignee, recordedAt });
const note = (id: string): InstrumentRecord => inst({ documentId: id, instrumentKind: 'note' });
const allonge = (
  id: string,
  assignor: string,
  assignee: string,
  recordedAt: string,
): InstrumentRecord =>
  inst({ documentId: id, instrumentKind: 'allonge', assignor, assignee, recordedAt });

describe('analyzeChain', () => {
  it('returns clean for a mortgage with a single recorded assignment', () => {
    const a = analyzeChain([mortgage('m1'), aom('a1', 'Lender A', 'Lender B', '2026-01-01')]);
    expect(a.status).toBe('clean');
    expect(a.breaks).toHaveLength(0);
  });

  it('returns clean for a contiguous multi-hop chain', () => {
    const a = analyzeChain([
      mortgage('m1'),
      aom('a1', 'A', 'B', '2026-01-01'),
      aom('a2', 'B', 'C', '2026-02-01'),
      aom('a3', 'C', 'D', '2026-03-01'),
    ]);
    expect(a.status).toBe('clean');
    expect(a.breaks).toHaveLength(0);
  });

  it('flags a sequential gap as broken / missing_assignment', () => {
    const a = analyzeChain([
      mortgage('m1'),
      aom('a1', 'A', 'B', '2026-01-01'),
      aom('a2', 'C', 'D', '2026-02-01'),
    ]);
    expect(a.status).toBe('broken');
    expect(a.breaks).toHaveLength(1);
    expect(a.breaks[0]?.kind).toBe('missing_assignment');
    expect(a.breaks[0]?.documentId).toBe('a2');
  });

  it('flags a fork as two ambiguous_assignment breaks', () => {
    const a = analyzeChain([
      mortgage('m1'),
      aom('a1', 'A', 'B', '2026-01-01'),
      aom('a2', 'A', 'C', '2026-02-01'),
    ]);
    expect(a.status).toBe('ambiguous');
    const forks = a.breaks.filter((b) => b.kind === 'ambiguous_assignment');
    expect(forks).toHaveLength(2);
  });

  it('flags a merge as two ambiguous_assignment breaks', () => {
    const a = analyzeChain([
      mortgage('m1'),
      aom('a1', 'A', 'C', '2026-01-01'),
      aom('a2', 'B', 'C', '2026-02-01'),
    ]);
    expect(a.status).toBe('ambiguous');
    const merges = a.breaks.filter((b) => b.kind === 'ambiguous_assignment');
    expect(merges).toHaveLength(2);
  });

  it('flags a cycle as one ambiguous_assignment break', () => {
    const a = analyzeChain([
      mortgage('m1'),
      aom('a1', 'A', 'B', '2026-01-01'),
      aom('a2', 'B', 'A', '2026-02-01'),
    ]);
    expect(a.status).toBe('ambiguous');
    expect(a.breaks.some((b) => b.detail.includes('cycle'))).toBe(true);
  });

  it('flags an orphaned note as lost_note when no anchor is present', () => {
    const a = analyzeChain([inst({ documentId: 'n1', instrumentKind: 'note' })]);
    expect(a.status).toBe('ambiguous');
    expect(a.breaks.some((b) => b.kind === 'lost_note' && b.documentId === 'n1')).toBe(true);
  });

  it('flags an unrecorded mortgage as unrecorded_instrument', () => {
    const a = analyzeChain([
      inst({ documentId: 'm1', instrumentKind: 'mortgage', recordingRef: UNREC }),
    ]);
    expect(a.breaks.some((b) => b.kind === 'unrecorded_instrument' && b.documentId === 'm1')).toBe(
      true,
    );
  });

  it('flags an unrecorded assignment as unrecorded_instrument', () => {
    const a = analyzeChain([
      mortgage('m1'),
      inst({
        documentId: 'a1',
        instrumentKind: 'aom',
        assignor: 'A',
        assignee: 'B',
        recordingRef: UNREC,
      }),
    ]);
    expect(a.breaks.some((b) => b.kind === 'unrecorded_instrument' && b.documentId === 'a1')).toBe(
      true,
    );
  });

  it('flags an assignment with a missing party as ambiguous_assignment', () => {
    const a = analyzeChain([
      mortgage('m1'),
      inst({ documentId: 'a1', instrumentKind: 'aom', assignor: 'A', assignee: null }),
    ]);
    expect(a.status).toBe('ambiguous');
    expect(a.breaks.some((b) => b.kind === 'ambiguous_assignment' && b.documentId === 'a1')).toBe(
      true,
    );
  });

  it('returns ambiguous for an empty instrument set (never clean)', () => {
    const a = analyzeChain([]);
    expect(a.status).toBe('ambiguous');
    expect(a.breaks).toHaveLength(1);
    expect(a.breaks[0]?.kind).toBe('ambiguous_assignment');
  });

  it('flags two distinct sequential gaps', () => {
    const a = analyzeChain([
      mortgage('m1'),
      aom('a1', 'A', 'B', '2026-01-01'),
      aom('a2', 'C', 'D', '2026-02-01'),
      aom('a3', 'E', 'F', '2026-03-01'),
    ]);
    expect(a.status).toBe('broken');
    expect(a.breaks.filter((b) => b.kind === 'missing_assignment')).toHaveLength(2);
  });

  it('holds the safety invariant: clean IFF zero breaks', () => {
    const samples: InstrumentRecord[][] = [
      [mortgage('m1'), aom('a1', 'A', 'B', '2026-01-01')],
      [mortgage('m1'), aom('a1', 'A', 'B', '2026-01-01'), aom('a2', 'C', 'D', '2026-02-01')],
      [],
      [inst({ documentId: 'n1', instrumentKind: 'note' })],
    ];
    for (const s of samples) {
      const a = analyzeChain(s);
      expect(a.status === 'clean').toBe(a.breaks.length === 0);
    }
  });

  it('builds assigns_to edges for assignments and a consolidates edge for a CEMA', () => {
    const a = analyzeChain([
      inst({ documentId: 'cn1', instrumentKind: 'consolidated_note' }),
      aom('a1', 'A', 'B', '2026-01-01'),
      aom('a2', 'B', 'C', '2026-02-01'),
    ]);
    const assignsTo = a.edges.filter((e) => e.kind === 'assigns_to');
    const consolidates = a.edges.filter((e) => e.kind === 'consolidates');
    expect(assignsTo).toHaveLength(2);
    expect(consolidates).toHaveLength(1);
    expect(consolidates[0]?.documentId).toBe('cn1');
    expect(assignsTo.some((e) => e.assignor === 'A' && e.assignee === 'B')).toBe(true);
  });
});

// Reference-target validation (pass F): an instrument's `references` field lists
// the recording references (reel/page or CRFN) of the instruments it cites -- a
// CEMA's consolidated-mortgage list, or an AOM citing the mortgage it assigns.
// A cited reference with no matching recorded instrument in the deal is a real
// chain defect (a consolidated mortgage missing from the collateral file), so it
// surfaces as `ambiguous_assignment` -> attorney_review. Conservative: only
// digit-bearing tokens are treated as references; digit-free prose is ignored.
describe('analyzeChain reference-target validation', () => {
  it('flags a reference to a recording ref absent from the deal as ambiguous_assignment', () => {
    const a = analyzeChain([
      inst({ documentId: 'c1', instrumentKind: 'cema_3172', references: 'crfn-absent9' }),
    ]);
    expect(a.status).toBe('ambiguous');
    const refBreaks = a.breaks.filter(
      (b) => b.kind === 'ambiguous_assignment' && b.documentId === 'c1',
    );
    expect(refBreaks).toHaveLength(1);
    expect(refBreaks[0]?.detail).toContain('crfn-absent9');
  });

  it('does not flag a reference whose target recording ref is present in the deal', () => {
    const a = analyzeChain([
      mortgage('m1'),
      inst({ documentId: 'c1', instrumentKind: 'cema_3172', references: 'crfn-m1' }),
    ]);
    expect(a.status).toBe('clean');
    expect(a.breaks).toHaveLength(0);
  });

  it('flags only the absent refs in a delimited reference list', () => {
    const a = analyzeChain([
      mortgage('m1'),
      inst({
        documentId: 'c1',
        instrumentKind: 'cema_3172',
        references: 'crfn-m1; crfn-absent9, crfn-m1',
      }),
    ]);
    const refBreaks = a.breaks.filter(
      (b) => b.documentId === 'c1' && b.detail.includes('crfn-absent9'),
    );
    expect(refBreaks).toHaveLength(1);
    // the present ref (cited twice) must never produce a break
    expect(a.breaks.some((b) => b.detail.includes('crfn-m1'))).toBe(false);
  });

  it('ignores digit-free reference tokens (treats them as prose, not refs)', () => {
    const a = analyzeChain([
      inst({
        documentId: 'c1',
        instrumentKind: 'cema_3172',
        references: 'see schedule A; per title commitment',
      }),
    ]);
    expect(a.status).toBe('clean');
    expect(a.breaks).toHaveLength(0);
  });

  it('matches references case-insensitively and ignores surrounding whitespace', () => {
    const a = analyzeChain([
      mortgage('m1'),
      inst({ documentId: 'c1', instrumentKind: 'cema_3172', references: '   CRFN-M1   ' }),
    ]);
    expect(a.status).toBe('clean');
    expect(a.breaks).toHaveLength(0);
  });
});

// Head-gap verification (pass G): the original mortgagee is the anchor's
// `originator`. When it is known, the FIRST recorded assignment's assignor must
// be that lender; otherwise an assignment at the head of the chain (from the
// original lender to the first recorded assignor) is missing -> missing_assignment
// (re_chase). Skipped when no originator is known (backward-compatible).
describe('analyzeChain head-gap verification', () => {
  it('flags a head gap when the first assignment is not from the original mortgagee', () => {
    const a = analyzeChain([
      inst({ documentId: 'm1', instrumentKind: 'mortgage', originator: 'Original Lender' }),
      aom('a1', 'Wrong Bank', 'B', '2026-01-01'),
      aom('a2', 'B', 'C', '2026-02-01'),
    ]);
    expect(a.status).toBe('broken');
    const headGap = a.breaks.filter(
      (b) => b.kind === 'missing_assignment' && b.documentId === 'a1',
    );
    expect(headGap).toHaveLength(1);
    expect(headGap[0]?.detail).toContain('head gap');
  });

  it('does not flag a head gap when the chain starts from the original mortgagee', () => {
    const a = analyzeChain([
      inst({ documentId: 'm1', instrumentKind: 'mortgage', originator: 'Original Lender' }),
      aom('a1', 'Original Lender', 'B', '2026-01-01'),
      aom('a2', 'B', 'C', '2026-02-01'),
    ]);
    expect(a.status).toBe('clean');
    expect(a.breaks).toHaveLength(0);
  });

  it('skips head-gap verification when no originator is known (backward-compatible)', () => {
    const a = analyzeChain([mortgage('m1'), aom('a1', 'Some Bank', 'B', '2026-01-01')]);
    expect(a.status).toBe('clean');
    expect(a.breaks).toHaveLength(0);
  });
});

// Allonge attachment (pass H): an allonge is physically attached to a promissory
// NOTE to add endorsements when the note runs out of space. An allonge present
// with no note in the deal has nothing to attach to -- the note it endorses is
// missing from the collateral file -> lost_note (attorney review).
describe('analyzeChain allonge attachment', () => {
  it('flags an allonge with no promissory note to attach to as lost_note', () => {
    const a = analyzeChain([
      mortgage('m1'),
      inst({
        documentId: 'al1',
        instrumentKind: 'allonge',
        assignor: 'A',
        assignee: 'B',
        recordedAt: '2026-01-01',
      }),
    ]);
    expect(a.breaks.some((b) => b.kind === 'lost_note' && b.documentId === 'al1')).toBe(true);
    expect(a.status).toBe('ambiguous');
  });

  it('does not flag an allonge when a promissory note is present', () => {
    const a = analyzeChain([
      mortgage('m1'),
      inst({ documentId: 'n1', instrumentKind: 'note' }),
      inst({
        documentId: 'al1',
        instrumentKind: 'allonge',
        assignor: 'A',
        assignee: 'B',
        recordedAt: '2026-01-01',
      }),
    ]);
    expect(a.breaks.some((b) => b.kind === 'lost_note')).toBe(false);
    expect(a.status).toBe('clean');
  });
});

// Note-endorsement chain (pass I): allonges endorse the NOTE (a chain distinct
// from the mortgage's AOM chain). Their sequence is validated on its own, and an
// allonge never contaminates the mortgage assignment passes (D/E/G).
describe('analyzeChain note-endorsement chain (pass I)', () => {
  it('returns clean for a note with a contiguous allonge endorsement sequence', () => {
    const a = analyzeChain([
      mortgage('m1'),
      note('n1'),
      allonge('al1', 'Holder A', 'Holder B', '2026-01-01'),
      allonge('al2', 'Holder B', 'Holder C', '2026-02-01'),
    ]);
    expect(a.status).toBe('clean');
    expect(a.breaks).toHaveLength(0);
  });

  it('flags a gap in the note endorsement sequence as missing_assignment (re_chase)', () => {
    const a = analyzeChain([
      mortgage('m1'),
      note('n1'),
      allonge('al1', 'Holder A', 'Holder B', '2026-01-01'),
      allonge('al2', 'Holder X', 'Holder C', '2026-02-01'), // B != X -> endorsement gap
    ]);
    expect(a.breaks.some((b) => b.kind === 'missing_assignment' && b.documentId === 'al2')).toBe(
      true,
    );
    expect(a.status).toBe('broken');
  });

  it('keeps the chains distinct: an unrelated allonge never breaks the MORTGAGE chain', () => {
    // The allonge shares no parties with the single AOM. If allonges still fed the
    // assignment graph (the old behavior), recording-order sorting would put the
    // AOM then the allonge and pass E would flag a spurious gap. They no longer do.
    const a = analyzeChain([
      mortgage('m1'),
      note('n1'),
      aom('a1', 'Lender A', 'Lender B', '2026-01-01'),
      allonge('al1', 'Holder X', 'Holder Y', '2026-01-15'),
    ]);
    expect(a.status).toBe('clean');
    expect(a.breaks).toHaveLength(0);
  });

  it('a single allonge with a note asserts no endorsement gap', () => {
    const a = analyzeChain([
      mortgage('m1'),
      note('n1'),
      allonge('al1', 'Holder A', 'Holder B', '2026-01-01'),
    ]);
    expect(a.breaks.some((b) => b.kind === 'missing_assignment')).toBe(false);
    expect(a.status).toBe('clean');
  });
});
