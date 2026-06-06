import { describe, expect, it } from 'vitest';

import { parseDealRecording } from './deal-recording';

describe('parseDealRecording', () => {
  it('parses an upstate reel/page recording', () => {
    expect(
      parseDealRecording({
        recording: { venue: 'Albany County Clerk', reelPage: 'R12/P34', recordedAt: '2026-06-06' },
      }),
    ).toEqual({
      venue: 'Albany County Clerk',
      reelPage: 'R12/P34',
      crfn: null,
      recordedAt: '2026-06-06',
    });
  });

  it('parses an NYC CRFN recording', () => {
    expect(parseDealRecording({ recording: { venue: 'ACRIS', crfn: '2026000123456' } })).toEqual({
      venue: 'ACRIS',
      reelPage: null,
      crfn: '2026000123456',
      recordedAt: null,
    });
  });

  it('returns null when there are no recording coordinates yet', () => {
    expect(parseDealRecording({})).toBeNull();
    expect(parseDealRecording({ recording: {} })).toBeNull();
    expect(parseDealRecording({ recording: { venue: 'ACRIS' } })).toBeNull(); // no reel/page or crfn
    expect(parseDealRecording({ cemaType: 'refi_cema' })).toBeNull();
  });

  it('is defensive against non-object / null metadata', () => {
    expect(parseDealRecording(null)).toBeNull();
    expect(parseDealRecording(undefined)).toBeNull();
    expect(parseDealRecording('recorded')).toBeNull();
    expect(parseDealRecording({ recording: 'oops' })).toBeNull();
  });
});
