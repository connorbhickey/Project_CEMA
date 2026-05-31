import { describe, expect, it } from 'vitest';

import { extract } from './extract';
import type { RawExtraction } from './types';

const classification = { kind: 'aom' as const, attorneyReviewRequired: true, confidence: 0.9 };

describe('extract', () => {
  it('maps fields into an InstrumentRecord and stamps the documentId + kind', () => {
    const raw: RawExtraction = {
      text: null,
      fields: {
        assignor: 'Old Servicer LLC',
        assignee: 'New Bank NA',
        executedAt: '2025-03-04',
        recordedAt: '2025-03-10',
        amount: '$420,000.00',
        crfn: '2025000123456',
        county: 'Kings',
        references: 'CRFN 2019000987654',
      },
      confidence: 0.9,
    };

    const rec = extract('doc-1', raw, classification);

    expect(rec.documentId).toBe('doc-1');
    expect(rec.instrumentKind).toBe('aom');
    expect(rec.assignor).toBe('Old Servicer LLC');
    expect(rec.assignee).toBe('New Bank NA');
    expect(rec.executedAt).toBe('2025-03-04');
    expect(rec.recordedAt).toBe('2025-03-10');
    expect(rec.amount).toBe(420000);
    expect(rec.recordingRef).toEqual({ reelPage: null, crfn: '2025000123456' });
    expect(rec.county).toBe('Kings');
    expect(rec.references).toBe('CRFN 2019000987654');
  });

  it('nulls every field absent from the extraction', () => {
    const rec = extract('doc-2', { text: null, fields: {}, confidence: 0.6 }, classification);
    expect(rec).toEqual({
      documentId: 'doc-2',
      instrumentKind: 'aom',
      assignor: null,
      assignee: null,
      executedAt: null,
      recordedAt: null,
      amount: null,
      recordingRef: { reelPage: null, crfn: null },
      county: null,
      references: null,
    });
  });

  it('prefers crfn over reelPage (recording XOR)', () => {
    const rec = extract(
      'doc-3',
      { text: null, fields: { crfn: 'C1', reelPage: 'R1' }, confidence: 0.9 },
      classification,
    );
    expect(rec.recordingRef).toEqual({ reelPage: null, crfn: 'C1' });
  });

  it('keeps reelPage when no crfn is present', () => {
    const rec = extract(
      'doc-4',
      { text: null, fields: { reelPage: 'R1' }, confidence: 0.9 },
      classification,
    );
    expect(rec.recordingRef).toEqual({ reelPage: 'R1', crfn: null });
  });

  it('nulls an unparseable date and an unparseable amount', () => {
    const rec = extract(
      'doc-5',
      { text: null, fields: { executedAt: 'not-a-date', amount: 'N/A' }, confidence: 0.9 },
      classification,
    );
    expect(rec.executedAt).toBeNull();
    expect(rec.amount).toBeNull();
  });
});
