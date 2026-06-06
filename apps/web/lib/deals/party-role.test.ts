import { partyRoleEnum } from '@cema/db';
import { describe, expect, it } from 'vitest';

import { PARTY_ROLE_LABELS, PARTY_ROLES, parsePartyRole, partyRoleLabel } from './party-role';

describe('party-role', () => {
  it('labels every role and humanizes snake_case', () => {
    expect(partyRoleLabel('seller')).toBe('Seller');
    expect(partyRoleLabel('co_borrower')).toBe('Co-Borrower');
    expect(partyRoleLabel('seller_attorney')).toBe('Seller Attorney');
  });

  it('returns the raw value for an unknown role', () => {
    expect(partyRoleLabel('mystery')).toBe('mystery');
  });

  it('parsePartyRole accepts a known role and rejects anything else (boundary guard)', () => {
    expect(parsePartyRole('seller')).toBe('seller');
    expect(parsePartyRole('borrower')).toBe('borrower');
    expect(parsePartyRole('not_a_role')).toBeNull();
    expect(parsePartyRole('')).toBeNull();
    expect(parsePartyRole(undefined)).toBeNull();
    expect(parsePartyRole(null)).toBeNull();
  });

  it('PARTY_ROLES stays in lockstep with the party_role pg enum (drift guard)', () => {
    expect([...PARTY_ROLES].sort()).toEqual([...partyRoleEnum.enumValues].sort());
    // every enum value has a label
    for (const role of partyRoleEnum.enumValues) {
      expect(role in PARTY_ROLE_LABELS).toBe(true);
    }
  });
});
