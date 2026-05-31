import type { InstrumentRecord } from '@cema/agents-collateral-idp';
import { describe, expect, it } from 'vitest';

import {
  ANCHOR_KINDS,
  ASSIGNMENT_KINDS,
  BREAK_KINDS,
  CHAIN_STATUSES,
  NOTE_KINDS,
  RECORDED_KINDS,
  ROUTE_KINDS,
} from './types';

describe('chain-of-title type tuples', () => {
  it('declares exactly the three chain statuses', () => {
    expect([...CHAIN_STATUSES]).toEqual(['clean', 'broken', 'ambiguous']);
  });

  it('declares exactly the four break kinds', () => {
    expect([...BREAK_KINDS]).toEqual([
      'missing_assignment',
      'lost_note',
      'ambiguous_assignment',
      'unrecorded_instrument',
    ]);
  });

  it('declares exactly the three route kinds', () => {
    expect([...ROUTE_KINDS]).toEqual(['advisory_pass', 're_chase', 'attorney_review']);
  });

  it('keeps anchor and note kinds disjoint', () => {
    for (const anchor of ANCHOR_KINDS) {
      expect(NOTE_KINDS).not.toContain(anchor);
    }
  });

  it('treats aom as both an assignment and a recorded instrument', () => {
    expect(ASSIGNMENT_KINDS).toContain('aom');
    expect(RECORDED_KINDS).toContain('aom');
  });

  // Compile-time field-drift guard: this literal must satisfy the InstrumentRecord
  // shape re-exported from @cema/agents-collateral-idp. If IDP renames/adds a
  // required field, this file stops compiling -- forcing a conscious update here.
  it('matches the collateral-idp InstrumentRecord shape', () => {
    const sample: InstrumentRecord = {
      documentId: 'doc-1',
      instrumentKind: 'aom',
      assignor: 'A',
      assignee: 'B',
      executedAt: null,
      recordedAt: '2026-01-01',
      amount: null,
      recordingRef: { reelPage: null, crfn: 'crfn-1' },
      county: null,
      references: null,
    };
    expect(sample.instrumentKind).toBe('aom');
  });
});
