import { NOTIFY_STATUSES } from '@cema/agents-internal-comms';
import { dealStatusEnum } from '@cema/db';
import { describe, expect, it } from 'vitest';

// The @cema/agents-internal-comms core is decoupled from @cema/db (it keys on a
// plain status string), so this guard ties its NOTIFY_STATUSES literals back to
// the real deal_status enum. It passes today; its value is failing loudly if a
// future enum rename silently orphans a notify status.
describe('NOTIFY_STATUSES drift guard', () => {
  it('is a subset of the deal_status enum', () => {
    const valid = new Set<string>(dealStatusEnum.enumValues);
    for (const status of NOTIFY_STATUSES) {
      expect(valid.has(status)).toBe(true);
    }
  });
});
