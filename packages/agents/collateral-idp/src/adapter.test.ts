import { describe, expect, it } from 'vitest';

import { FixtureIdpAdapter } from './adapter';
import type { RawExtraction } from './types';

describe('FixtureIdpAdapter', () => {
  it('returns the canned extractions for a known blob', async () => {
    const canned: RawExtraction = {
      text: 'Assignment of Mortgage',
      fields: { documentType: 'Assignment of Mortgage' },
      confidence: 0.9,
    };
    const adapter = new FixtureIdpAdapter({ 'blob://aom': [canned] });

    const out = await adapter.extractDocuments('blob://aom');

    expect(out).toEqual([canned]);
  });

  it('returns a single zero-confidence empty extraction for an unknown blob', async () => {
    const adapter = new FixtureIdpAdapter();

    const out = await adapter.extractDocuments('blob://missing');

    expect(out).toEqual([{ text: null, fields: {}, confidence: 0 }]);
  });
});
