import type {
  ChainStatus,
  BreakKind,
  RouteKind,
  DocumentKind,
  InstrumentRecord,
  RecordingRef,
} from '../src/types';

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

const mortgage = (id: string, recorded = true): InstrumentRecord =>
  inst({
    documentId: id,
    instrumentKind: 'mortgage',
    recordingRef: recorded ? REC(`c-${id}`) : UNREC,
  });
const gapMortgage = (id: string): InstrumentRecord =>
  inst({ documentId: id, instrumentKind: 'gap_mortgage' });
const noteDoc = (
  id: string,
  kind: DocumentKind = 'note',
  references: string | null = null,
): InstrumentRecord => inst({ documentId: id, instrumentKind: kind, references });
const consolidation = (
  id: string,
  kind: DocumentKind,
  references: string | null = null,
): InstrumentRecord => inst({ documentId: id, instrumentKind: kind, references });
const aom = (
  id: string,
  assignor: string | null,
  assignee: string | null,
  opts: { ref?: string | null; recordedAt?: string | null; isRec?: boolean } = {},
): InstrumentRecord =>
  inst({
    documentId: id,
    instrumentKind: 'aom',
    assignor,
    assignee,
    recordedAt: opts.recordedAt ?? null,
    references: opts.ref ?? null,
    recordingRef: opts.isRec === false ? UNREC : REC(`c-${id}`),
  });

export interface ChainFixture {
  readonly name: string;
  readonly instruments: readonly InstrumentRecord[];
  readonly expected: {
    readonly status: ChainStatus;
    readonly breakKinds: readonly BreakKind[];
    readonly routeKinds: readonly RouteKind[];
  };
}

// 26 fixtures spanning every status, break kind, and route kind. F25-F26
// exercise reference-target validation (pass F): analyzeChain now reads
// `references`, confirming each cited recording reference resolves to a recorded
// instrument in the deal (a miss is an ambiguous_assignment -> attorney_review).
export const CHAIN_FIXTURES: readonly ChainFixture[] = [
  {
    name: 'F1 single recorded assignment is clean',
    instruments: [mortgage('m1'), aom('a1', 'A', 'B', { recordedAt: '2026-01-01' })],
    expected: { status: 'clean', breakKinds: [], routeKinds: ['advisory_pass'] },
  },
  {
    name: 'F2 contiguous three-hop chain is clean',
    instruments: [
      mortgage('m1'),
      aom('a1', 'A', 'B', { recordedAt: '2026-01-01' }),
      aom('a2', 'B', 'C', { recordedAt: '2026-02-01' }),
      aom('a3', 'C', 'D', { recordedAt: '2026-03-01' }),
    ],
    expected: { status: 'clean', breakKinds: [], routeKinds: ['advisory_pass'] },
  },
  {
    name: 'F3 mortgage with no assignments is clean',
    instruments: [mortgage('m1')],
    expected: { status: 'clean', breakKinds: [], routeKinds: ['advisory_pass'] },
  },
  {
    name: 'F4 single sequential gap is broken',
    instruments: [
      mortgage('m1'),
      aom('a1', 'A', 'B', { recordedAt: '2026-01-01' }),
      aom('a2', 'C', 'D', { recordedAt: '2026-02-01' }),
    ],
    expected: { status: 'broken', breakKinds: ['missing_assignment'], routeKinds: ['re_chase'] },
  },
  {
    name: 'F5 two sequential gaps are broken',
    instruments: [
      mortgage('m1'),
      aom('a1', 'A', 'B', { recordedAt: '2026-01-01' }),
      aom('a2', 'C', 'D', { recordedAt: '2026-02-01' }),
      aom('a3', 'E', 'F', { recordedAt: '2026-03-01' }),
    ],
    expected: {
      status: 'broken',
      breakKinds: ['missing_assignment', 'missing_assignment'],
      routeKinds: ['re_chase', 're_chase'],
    },
  },
  {
    name: 'F6 fork is ambiguous',
    instruments: [
      mortgage('m1'),
      aom('a1', 'A', 'B', { recordedAt: '2026-01-01' }),
      aom('a2', 'A', 'C', { recordedAt: '2026-02-01' }),
    ],
    expected: {
      status: 'ambiguous',
      breakKinds: ['ambiguous_assignment', 'ambiguous_assignment'],
      routeKinds: ['attorney_review', 'attorney_review'],
    },
  },
  {
    name: 'F7 merge is ambiguous',
    instruments: [
      mortgage('m1'),
      aom('a1', 'A', 'C', { recordedAt: '2026-01-01' }),
      aom('a2', 'B', 'C', { recordedAt: '2026-02-01' }),
    ],
    expected: {
      status: 'ambiguous',
      breakKinds: ['ambiguous_assignment', 'ambiguous_assignment'],
      routeKinds: ['attorney_review', 'attorney_review'],
    },
  },
  {
    name: 'F8 two-node cycle is ambiguous',
    instruments: [
      mortgage('m1'),
      aom('a1', 'A', 'B', { recordedAt: '2026-01-01' }),
      aom('a2', 'B', 'A', { recordedAt: '2026-02-01' }),
    ],
    expected: {
      status: 'ambiguous',
      breakKinds: ['ambiguous_assignment'],
      routeKinds: ['attorney_review'],
    },
  },
  {
    name: 'F9 missing assignee is ambiguous',
    instruments: [mortgage('m1'), aom('a1', 'A', null, { recordedAt: '2026-01-01' })],
    expected: {
      status: 'ambiguous',
      breakKinds: ['ambiguous_assignment'],
      routeKinds: ['attorney_review'],
    },
  },
  {
    name: 'F10 missing assignor is ambiguous',
    instruments: [mortgage('m1'), aom('a1', null, 'B', { recordedAt: '2026-01-01' })],
    expected: {
      status: 'ambiguous',
      breakKinds: ['ambiguous_assignment'],
      routeKinds: ['attorney_review'],
    },
  },
  {
    name: 'F11 orphaned note is ambiguous (lost_note)',
    instruments: [noteDoc('n1')],
    expected: { status: 'ambiguous', breakKinds: ['lost_note'], routeKinds: ['attorney_review'] },
  },
  {
    name: 'F12 unrecorded mortgage',
    instruments: [mortgage('m1', false)],
    expected: {
      status: 'ambiguous',
      breakKinds: ['unrecorded_instrument'],
      routeKinds: ['attorney_review'],
    },
  },
  {
    name: 'F13 unrecorded assignment',
    instruments: [mortgage('m1'), aom('a1', 'A', 'B', { recordedAt: '2026-01-01', isRec: false })],
    expected: {
      status: 'ambiguous',
      breakKinds: ['unrecorded_instrument'],
      routeKinds: ['attorney_review'],
    },
  },
  {
    name: 'F14 empty set is ambiguous (never clean)',
    instruments: [],
    expected: {
      status: 'ambiguous',
      breakKinds: ['ambiguous_assignment'],
      routeKinds: ['attorney_review'],
    },
  },
  {
    name: 'F15 gap_mortgage anchor with clean assignment',
    instruments: [gapMortgage('m1'), aom('a1', 'A', 'B', { recordedAt: '2026-01-01' })],
    expected: { status: 'clean', breakKinds: [], routeKinds: ['advisory_pass'] },
  },
  {
    name: 'F16 consolidated_note anchor is clean with no assignments',
    instruments: [consolidation('c1', 'consolidated_note')],
    expected: { status: 'clean', breakKinds: [], routeKinds: ['advisory_pass'] },
  },
  {
    name: 'F17 cema_3172 anchor is clean',
    instruments: [
      consolidation('c1', 'cema_3172'),
      aom('a1', 'A', 'B', { recordedAt: '2026-01-01' }),
    ],
    expected: { status: 'clean', breakKinds: [], routeKinds: ['advisory_pass'] },
  },
  {
    name: 'F18 note plus anchor is clean (note is anchored)',
    instruments: [mortgage('m1'), noteDoc('n1')],
    expected: { status: 'clean', breakKinds: [], routeKinds: ['advisory_pass'] },
  },
  {
    name: 'F19 gap_note orphan is lost_note',
    instruments: [noteDoc('n1', 'gap_note')],
    expected: { status: 'ambiguous', breakKinds: ['lost_note'], routeKinds: ['attorney_review'] },
  },
  {
    name: 'F20 three-node cycle is ambiguous',
    instruments: [
      mortgage('m1'),
      aom('a1', 'A', 'B', { recordedAt: '2026-01-01' }),
      aom('a2', 'B', 'C', { recordedAt: '2026-02-01' }),
      aom('a3', 'C', 'A', { recordedAt: '2026-03-01' }),
    ],
    expected: {
      status: 'ambiguous',
      breakKinds: ['ambiguous_assignment'],
      routeKinds: ['attorney_review'],
    },
  },
  {
    name: 'F21 unrecorded mortgage AND a clean assignment',
    instruments: [mortgage('m1', false), aom('a1', 'A', 'B', { recordedAt: '2026-01-01' })],
    expected: {
      status: 'ambiguous',
      breakKinds: ['unrecorded_instrument'],
      routeKinds: ['attorney_review'],
    },
  },
  {
    name: 'F22 fork plus a third clean-looking hop stays ambiguous',
    instruments: [
      mortgage('m1'),
      aom('a1', 'A', 'B', { recordedAt: '2026-01-01' }),
      aom('a2', 'A', 'C', { recordedAt: '2026-02-01' }),
      aom('a3', 'B', 'D', { recordedAt: '2026-03-01' }),
    ],
    expected: {
      status: 'ambiguous',
      breakKinds: ['ambiguous_assignment', 'ambiguous_assignment'],
      routeKinds: ['attorney_review', 'attorney_review'],
    },
  },
  {
    name: 'F23 two orphaned notes are two lost_notes',
    instruments: [noteDoc('n1'), noteDoc('n2', 'gap_note')],
    expected: {
      status: 'ambiguous',
      breakKinds: ['lost_note', 'lost_note'],
      routeKinds: ['attorney_review', 'attorney_review'],
    },
  },
  {
    name: 'F24 single allonge with parties under an anchor is clean',
    instruments: [
      mortgage('m1'),
      inst({
        documentId: 'al1',
        instrumentKind: 'allonge',
        assignor: 'A',
        assignee: 'B',
        recordedAt: '2026-01-01',
      }),
    ],
    expected: { status: 'clean', breakKinds: [], routeKinds: ['advisory_pass'] },
  },
  {
    name: 'F25 CEMA referencing a present recorded mortgage is clean',
    instruments: [mortgage('m1'), consolidation('c1', 'cema_3172', 'c-m1')],
    expected: { status: 'clean', breakKinds: [], routeKinds: ['advisory_pass'] },
  },
  {
    name: 'F26 CEMA referencing an absent recording ref is ambiguous',
    instruments: [consolidation('c1', 'cema_3172', 'c-absent9')],
    expected: {
      status: 'ambiguous',
      breakKinds: ['ambiguous_assignment'],
      routeKinds: ['attorney_review'],
    },
  },
] as const;
