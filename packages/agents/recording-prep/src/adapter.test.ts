import { describe, expect, it } from 'vitest';

import { FixtureRecordingAdapter } from './adapter';

describe('FixtureRecordingAdapter', () => {
  it('submit is dormant — transmits nothing', async () => {
    const result = await new FixtureRecordingAdapter().submit({
      venue: 'county',
      borough: null,
      coverSheets: [],
      fees: { baseFee: 40, perPageFee: 5, pageCount: 40, flatCountyFee: 0, total: 240 },
    });
    expect(result.submitted).toBe(false);
    expect(result.submissionId).toBeNull();
  });

  it('poll reports not_submitted', async () => {
    const result = await new FixtureRecordingAdapter().poll('sub-1');
    expect(result.status).toBe('not_submitted');
  });
});
