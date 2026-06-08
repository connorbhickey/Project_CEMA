import { BREAK_KINDS } from '@cema/agents-chain-of-title';
import { describe, expect, it } from 'vitest';

import { CHAIN_BREAK_KIND_LABELS, chainBreakKindLabel } from './chain-break-labels';

describe('chainBreakKindLabel', () => {
  it('humanizes known break kinds', () => {
    expect(chainBreakKindLabel('lost_note')).toBe('Lost Note');
    expect(chainBreakKindLabel('missing_assignment')).toBe('Missing Assignment');
  });

  it('falls back to the raw token for an unknown kind', () => {
    expect(chainBreakKindLabel('something_new')).toBe('something_new');
  });

  // Drift guard: every BREAK_KINDS value must have a label.
  it('has a label for every break kind the agent can emit', () => {
    for (const kind of BREAK_KINDS) {
      expect(kind in CHAIN_BREAK_KIND_LABELS).toBe(true);
    }
  });
});
