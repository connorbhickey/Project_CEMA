import { describe, expect, it } from 'vitest';

import { route } from './route';
import { BREAK_KINDS } from './types';
import type { ChainBreak } from './types';

describe('route', () => {
  it('returns a single advisory_pass for a clean chain', () => {
    const decisions = route('deal-1', []);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.kind).toBe('advisory_pass');
    expect(decisions[0]?.documentId).toBeNull();
  });

  it('routes missing_assignment to re_chase', () => {
    const decisions = route('deal-1', [
      { kind: 'missing_assignment', documentId: 'a2', detail: 'gap' },
    ]);
    expect(decisions[0]?.kind).toBe('re_chase');
    expect(decisions[0]?.documentId).toBe('a2');
  });

  it('routes lost_note, ambiguous_assignment, and unrecorded_instrument to attorney_review', () => {
    const breaks: ChainBreak[] = [
      { kind: 'lost_note', documentId: 'n1', detail: 'x' },
      { kind: 'ambiguous_assignment', documentId: 'a1', detail: 'x' },
      { kind: 'unrecorded_instrument', documentId: 'm1', detail: 'x' },
    ];
    for (const decision of route('deal-1', breaks)) {
      expect(decision.kind).toBe('attorney_review');
    }
  });

  it('emits exactly one decision per break', () => {
    const breaks: ChainBreak[] = [
      { kind: 'missing_assignment', documentId: 'a1', detail: 'x' },
      { kind: 'lost_note', documentId: 'n1', detail: 'x' },
    ];
    expect(route('deal-1', breaks)).toHaveLength(2);
  });

  it('never propagates break.detail (PII) into the reason', () => {
    const pii = 'Old Servicer LLC -> New Bank NA';
    const decisions = route('deal-1', [
      { kind: 'ambiguous_assignment', documentId: 'a1', detail: pii },
    ]);
    expect(decisions[0]?.reason).not.toContain('Old Servicer LLC');
    expect(decisions[0]?.reason).not.toContain('New Bank NA');
  });

  it('produces a defined route + reason for every break kind', () => {
    for (const kind of BREAK_KINDS) {
      const [decision] = route('deal-1', [{ kind, documentId: 'd1', detail: 'x' }]);
      expect(decision?.kind).toBeTruthy();
      expect(decision?.reason.length).toBeGreaterThan(0);
    }
  });
});
