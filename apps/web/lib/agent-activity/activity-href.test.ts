import { describe, expect, it } from 'vitest';

import { activityHref, activityParams } from './activity-href';

describe('activity-href', () => {
  it('activityParams keeps only the active params', () => {
    expect(activityParams({ agent: 'idp', since: '7d' })).toEqual({ agent: 'idp', since: '7d' });
    expect(activityParams({ agent: 'idp', since: null })).toEqual({ agent: 'idp' });
    expect(activityParams({ agent: null, since: '7d' })).toEqual({ since: '7d' });
    expect(activityParams({})).toEqual({});
  });

  it('builds a composed href, agent before since, stable order', () => {
    expect(activityHref('/dashboard', { agent: 'idp', since: '7d' })).toBe(
      '/dashboard?agent=idp&since=7d',
    );
  });

  it('preserves one param when the other is cleared', () => {
    expect(activityHref('/dashboard', { agent: 'idp' })).toBe('/dashboard?agent=idp');
    expect(activityHref('/dashboard', { since: '24h' })).toBe('/dashboard?since=24h');
  });

  it('returns the bare base path when nothing is active', () => {
    expect(activityHref('/dashboard', {})).toBe('/dashboard');
    expect(activityHref('/deals/abc/agent-activity', { agent: null, since: null })).toBe(
      '/deals/abc/agent-activity',
    );
  });
});
