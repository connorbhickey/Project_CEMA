import type { RouteDecision } from '@cema/agents-chain-of-title';
import { describe, expect, it } from 'vitest';

import { breakHash } from './break-hash';

const base: RouteDecision = {
  dealId: '00000000-0000-0000-0000-0000000000ac',
  kind: 're_chase',
  documentId: '00000000-0000-0000-0000-0000000000dc',
  reason:
    'A gap in the recorded assignment sequence was detected; re-chase the servicer for the missing assignment.',
};

describe('breakHash', () => {
  it('is an 8-char lowercase hex string', () => {
    expect(breakHash(base)).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is deterministic for the same decision (durable-replay safe)', () => {
    expect(breakHash(base)).toBe(breakHash({ ...base }));
  });

  it('changes when any identity field changes', () => {
    const h = breakHash(base);
    expect(breakHash({ ...base, dealId: '00000000-0000-0000-0000-0000000000ad' })).not.toBe(h);
    expect(breakHash({ ...base, kind: 'attorney_review' })).not.toBe(h);
    expect(breakHash({ ...base, documentId: '00000000-0000-0000-0000-0000000000de' })).not.toBe(h);
    expect(breakHash({ ...base, reason: 'attorney review required.' })).not.toBe(h);
  });

  it('handles a null documentId (a gap break has no document) deterministically', () => {
    const nullDoc = { ...base, documentId: null };
    expect(breakHash(nullDoc)).toMatch(/^[0-9a-f]{8}$/);
    expect(breakHash(nullDoc)).toBe(breakHash({ ...nullDoc }));
    // A real document id and a null id are distinct routing identities.
    expect(breakHash(nullDoc)).not.toBe(breakHash(base));
  });
});
