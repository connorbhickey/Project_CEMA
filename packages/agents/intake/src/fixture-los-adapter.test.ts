import { describe, expect, it } from 'vitest';

import { checkEligibility } from './eligibility';
import { FixtureLosAdapter } from './fixture-los-adapter';
import {
  DEFAULT_FIXTURES,
  FIXTURE_ELIGIBLE_SINGLE_FAMILY,
  FIXTURE_INELIGIBLE_COOP,
} from './fixtures';
import type { NormalizedApplication } from './types';

describe('FixtureLosAdapter', () => {
  it('returns the seeded application by externalId', async () => {
    const adapter = new FixtureLosAdapter();
    const app = await adapter.getApplication('FIX-ELIG-SF');
    expect(app).toEqual(FIXTURE_ELIGIBLE_SINGLE_FAMILY);
  });

  it('throws for an unknown externalId', async () => {
    const adapter = new FixtureLosAdapter();
    await expect(adapter.getApplication('does-not-exist')).rejects.toThrow(/does-not-exist/);
  });

  it('accepts a custom fixture set', async () => {
    const custom: NormalizedApplication = { ...FIXTURE_INELIGIBLE_COOP, externalId: 'CUSTOM-1' };
    const adapter = new FixtureLosAdapter([custom]);
    expect(await adapter.getApplication('CUSTOM-1')).toEqual(custom);
    await expect(adapter.getApplication('FIX-ELIG-SF')).rejects.toThrow();
  });
});

describe('DEFAULT_FIXTURES', () => {
  it('has unique externalIds', () => {
    const ids = DEFAULT_FIXTURES.map((f) => f.externalId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('includes both eligible and ineligible applications', () => {
    const verdicts = DEFAULT_FIXTURES.map((f) => checkEligibility(f).eligible);
    expect(verdicts).toContain(true);
    expect(verdicts).toContain(false);
  });

  it('categorizes every fixture consistently with its externalId prefix', () => {
    for (const fixture of DEFAULT_FIXTURES) {
      const { eligible } = checkEligibility(fixture);
      if (fixture.externalId.startsWith('FIX-ELIG-')) {
        expect(eligible, `${fixture.externalId} should be eligible`).toBe(true);
      } else {
        // FIX-INELIG-* and FIX-EDGE-* all fail closed in v1.
        expect(eligible, `${fixture.externalId} should be ineligible`).toBe(false);
      }
    }
  });
});
