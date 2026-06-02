import { describe, expect, it } from 'vitest';

import { FixtureDocGenAdapter } from './adapter';

describe('FixtureDocGenAdapter', () => {
  it('is dormant — reports not rendered, no blob', async () => {
    const adapter = new FixtureDocGenAdapter();
    const result = await adapter.render({
      kind: 'cema_3172',
      attorneyReviewRequired: true,
      title: 'CEMA (NY Form 3172)',
      fields: { dealId: 'deal-1' },
    });
    expect(result.rendered).toBe(false);
    expect(result.blobUrl).toBeUndefined();
  });
});
