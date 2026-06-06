import type { DealSignals, ExceptionKind } from '../src/types';

export interface TriageFixture {
  readonly name: string;
  readonly input: DealSignals;
  readonly expected: { readonly kinds: readonly ExceptionKind[] };
}

function sig(
  dealStatus: string,
  chainBreakCount: number,
  dispatchFailed: boolean,
  recordingRejected: boolean,
  purchaseMissingSeller = false,
): DealSignals {
  return { dealStatus, chainBreakCount, dispatchFailed, recordingRejected, purchaseMissingSeller };
}

export const TRIAGE_FIXTURES: readonly TriageFixture[] = [
  // --- Single signal ---
  {
    name: 'chain break only',
    input: sig('title_work', 1, false, false),
    expected: { kinds: ['chain_break'] },
  },
  {
    name: 'dispatch failure only',
    input: sig('doc_prep', 0, true, false),
    expected: { kinds: ['agent_dispatch_failed'] },
  },
  {
    name: 'flagged exception only',
    input: sig('exception', 0, false, false),
    expected: { kinds: ['deal_flagged_exception'] },
  },
  {
    name: 'rejected recording only',
    input: sig('recording', 0, false, true),
    expected: { kinds: ['rejected_recording'] },
  },
  {
    name: 'purchase missing seller only',
    input: sig('doc_prep', 0, false, false, true),
    expected: { kinds: ['purchase_missing_seller'] },
  },
  // --- Combinations ---
  {
    name: 'chain + dispatch',
    input: sig('title_work', 2, true, false),
    expected: { kinds: ['chain_break', 'agent_dispatch_failed'] },
  },
  {
    name: 'flagged + rejected',
    input: sig('exception', 0, false, true),
    expected: { kinds: ['deal_flagged_exception', 'rejected_recording'] },
  },
  {
    name: 'chain + flagged',
    input: sig('exception', 3, false, false),
    expected: { kinds: ['chain_break', 'deal_flagged_exception'] },
  },
  {
    name: 'dispatch + flagged',
    input: sig('exception', 0, true, false),
    expected: { kinds: ['agent_dispatch_failed', 'deal_flagged_exception'] },
  },
  {
    name: 'all five signals',
    input: sig('exception', 1, true, true, true),
    expected: {
      kinds: [
        'chain_break',
        'agent_dispatch_failed',
        'deal_flagged_exception',
        'rejected_recording',
        'purchase_missing_seller',
      ],
    },
  },
  // --- Signal independence from status ---
  {
    name: 'rejected on a non-recording status',
    input: sig('doc_prep', 0, false, true),
    expected: { kinds: ['rejected_recording'] },
  },
  {
    name: 'high chain count still yields one kind (not count-scaled)',
    input: sig('title_work', 99, false, false),
    expected: { kinds: ['chain_break'] },
  },
  // --- Clean deals (never invent an exception) ---
  { name: 'clean intake', input: sig('intake', 0, false, false), expected: { kinds: [] } },
  { name: 'clean closing', input: sig('closing', 0, false, false), expected: { kinds: [] } },
  { name: 'clean completed', input: sig('completed', 0, false, false), expected: { kinds: [] } },
];
