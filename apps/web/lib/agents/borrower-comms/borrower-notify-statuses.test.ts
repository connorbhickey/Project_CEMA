import { BORROWER_NOTIFY_STATUSES } from '@cema/agents-borrower-comms';
import { dealStatusEnum } from '@cema/db';
import { describe, expect, it } from 'vitest';

// The @cema/agents-borrower-comms core is decoupled from @cema/db (it keys on a
// plain status string), so this guard ties its BORROWER_NOTIFY_STATUSES literals
// back to the real deal_status enum. It passes today; its value is failing loudly
// if a future enum rename silently orphans a borrower touchpoint.
describe('BORROWER_NOTIFY_STATUSES drift guard', () => {
  it('is a subset of the deal_status enum', () => {
    const valid = new Set<string>(dealStatusEnum.enumValues);
    for (const status of BORROWER_NOTIFY_STATUSES) {
      expect(valid.has(status)).toBe(true);
    }
  });
});
