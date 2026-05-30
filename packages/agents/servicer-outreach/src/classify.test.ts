import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { classifyServicerResponse, isClassifierConfigured } from './classify';

describe('classifyServicerResponse (unconfigured)', () => {
  const original = process.env.AI_GATEWAY_API_KEY;
  beforeEach(() => delete process.env.AI_GATEWAY_API_KEY);
  afterEach(() => {
    if (original === undefined) delete process.env.AI_GATEWAY_API_KEY;
    else process.env.AI_GATEWAY_API_KEY = original;
  });

  it('is not configured without a key', () => {
    expect(isClassifierConfigured()).toBe(false);
  });

  it("returns {kind:'other'} (no-op) when unconfigured so the cadence continues", async () => {
    const out = await classifyServicerResponse({ responseText: 'We received your request.' });
    expect(out).toEqual({ kind: 'other' });
  });
});
