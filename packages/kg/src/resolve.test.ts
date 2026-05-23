import { describe, expect, it, vi } from 'vitest';

vi.mock('@cema/contacts', () => ({
  normalizeEmail: vi.fn((e: string) => e.toLowerCase()),
  normalizePhone: vi.fn(() => null),
}));

vi.mock('@cema/db', () => ({
  contactIdentities: {
    contactId: 'ci_contact_id',
    organizationId: 'ci_org_id',
    normalizedValue: 'ci_norm',
  },
  contacts: { id: 'c_id' },
  kgEdges: {},
}));

vi.mock('./edges', () => ({
  findNeighbors: vi.fn(),
  addEdge: vi.fn(),
  removeEdge: vi.fn(),
}));

import { findNeighbors } from './edges';
import { resolvePartyFromContact } from './resolve';
import type { DbOrTx } from './types';

function makeTx(identityRows: unknown[] = []): DbOrTx {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(identityRows),
        }),
      }),
    }),
  } as unknown as DbOrTx;
}

describe('resolvePartyFromContact', () => {
  it('returns null when no email or phone provided', async () => {
    const tx = makeTx();
    const result = await resolvePartyFromContact(tx, { organizationId: 'org-1' });
    expect(result).toBeNull();
  });

  it('returns null when no contact_identity matches', async () => {
    const tx = makeTx([]);
    const result = await resolvePartyFromContact(tx, {
      organizationId: 'org-1',
      email: 'nobody@example.com',
    });
    expect(result).toBeNull();
  });

  it('returns { contactId, partyId: null, dealId: null } when contact exists but no KG edge', async () => {
    vi.mocked(findNeighbors).mockResolvedValueOnce([]);
    const tx = makeTx([{ contactId: 'contact-1' }]);
    const result = await resolvePartyFromContact(tx, {
      organizationId: 'org-1',
      email: 'alice@example.com',
    });
    expect(result).toEqual({ contactId: 'contact-1', partyId: null, dealId: null });
  });

  it('returns full chain when contact → party → deal edges exist', async () => {
    vi.mocked(findNeighbors)
      .mockResolvedValueOnce([
        { nodeId: 'party-1', nodeType: 'party', predicate: 'contact_is_party' },
      ])
      .mockResolvedValueOnce([
        { nodeId: 'deal-1', nodeType: 'deal', predicate: 'party_is_on_deal' },
      ]);
    const tx = makeTx([{ contactId: 'contact-1' }]);
    const result = await resolvePartyFromContact(tx, {
      organizationId: 'org-1',
      email: 'alice@example.com',
    });
    expect(result).toEqual({ contactId: 'contact-1', partyId: 'party-1', dealId: 'deal-1' });
  });
});
