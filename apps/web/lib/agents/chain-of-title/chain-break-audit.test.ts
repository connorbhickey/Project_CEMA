import { describe, expect, it } from 'vitest';

import { chainBreakAuditMetadata } from './chain-break-audit';

describe('chainBreakAuditMetadata', () => {
  const row = { breakHash: 'abcd1234', breakKind: 'lost_note' };

  it('includes PII-safe fields only', () => {
    expect(chainBreakAuditMetadata(row, 'pending', 'claimed')).toEqual({
      source: 'chain-of-title',
      breakHash: 'abcd1234',
      breakKind: 'lost_note',
      fromState: 'pending',
      toState: 'claimed',
    });
  });

  it('never includes a resolution note even when one is present on the input row', () => {
    // The attorney's free-text note MAY carry party names (hard rule #3). Even
    // if a caller passes a row object that carries it, the helper must drop it.
    const withNote = {
      ...row,
      resolutionNote: 'Smith v. Jones — original note located in the vault',
    };
    const meta = chainBreakAuditMetadata(withNote, 'claimed', 'resolved');
    expect(meta).not.toHaveProperty('resolutionNote');
    expect(Object.values(meta).join(' ')).not.toContain('Smith');
  });
});
