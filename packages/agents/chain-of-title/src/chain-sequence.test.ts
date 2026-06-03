import { describe, expect, it } from 'vitest';

import { chainSequenceEdges } from './chain';
import type { InstrumentRecord } from './types';

// Minimal InstrumentRecord builder — only the fields chainSequenceEdges reads
// (documentId, instrumentKind, recordedAt) carry meaning; the rest are inert.
function inst(
  documentId: string,
  instrumentKind: InstrumentRecord['instrumentKind'],
  recordedAt: string | null,
): InstrumentRecord {
  return {
    documentId,
    instrumentKind,
    assignor: 'PARTY-SHOULD-NOT-LEAK',
    assignee: 'PARTY-SHOULD-NOT-LEAK',
    executedAt: null,
    recordedAt,
    amount: null,
    recordingRef: { reelPage: null, crfn: null },
    county: null,
    references: null,
  };
}

describe('chainSequenceEdges', () => {
  it('returns no edges for zero or one assignment', () => {
    expect(chainSequenceEdges([])).toEqual([]);
    expect(chainSequenceEdges([inst('a1', 'aom', '2020-01-01')])).toEqual([]);
  });

  it('links consecutive assignments in recordedAt order', () => {
    // Deliberately unsorted input — the function sorts by recordedAt.
    const edges = chainSequenceEdges([
      inst('a3', 'aom', '2020-03-01'),
      inst('a1', 'aom', '2020-01-01'),
      inst('a2', 'allonge', '2020-02-01'),
    ]);
    expect(edges).toEqual([
      { fromDocumentId: 'a1', toDocumentId: 'a2' },
      { fromDocumentId: 'a2', toDocumentId: 'a3' },
    ]);
  });

  it('orders undated assignments last (nulls last)', () => {
    const edges = chainSequenceEdges([inst('aN', 'aom', null), inst('a1', 'aom', '2020-01-01')]);
    expect(edges).toEqual([{ fromDocumentId: 'a1', toDocumentId: 'aN' }]);
  });

  it('ignores non-assignment instruments (anchors, notes)', () => {
    const edges = chainSequenceEdges([
      inst('m1', 'mortgage', '2020-01-01'),
      inst('a1', 'aom', '2020-02-01'),
      inst('n1', 'note', '2020-03-01'),
      inst('a2', 'aom', '2020-04-01'),
    ]);
    expect(edges).toEqual([{ fromDocumentId: 'a1', toDocumentId: 'a2' }]);
  });

  it('emits document ids ONLY — never party names (hard rule #3)', () => {
    const edges = chainSequenceEdges([
      inst('a1', 'aom', '2020-01-01'),
      inst('a2', 'aom', '2020-02-01'),
    ]);
    for (const e of edges) {
      expect(Object.keys(e).sort()).toEqual(['fromDocumentId', 'toDocumentId']);
    }
    expect(JSON.stringify(edges)).not.toContain('PARTY');
  });
});
