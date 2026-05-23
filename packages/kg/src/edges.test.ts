import { describe, expect, it, vi } from 'vitest';

import { addEdge, findNeighbors, removeEdge } from './edges';
import type { DbOrTx } from './types';

function makeTx() {
  const insertSpy = vi.fn().mockReturnValue({
    values: vi.fn().mockReturnValue({ onConflictDoNothing: vi.fn().mockResolvedValue(undefined) }),
  });
  const deleteSpy = vi.fn().mockReturnValue({
    where: vi.fn().mockResolvedValue(undefined),
  });
  const tx = {
    insert: insertSpy,
    delete: deleteSpy,
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi
          .fn()
          .mockResolvedValue([
            { objectId: 'party-1', objectType: 'party', predicate: 'contact_is_party' },
          ]),
      }),
    }),
  } as unknown as DbOrTx;
  return { tx, insertSpy, deleteSpy };
}

describe('addEdge', () => {
  it('calls insert with correct values', async () => {
    const { tx, insertSpy } = makeTx();
    await addEdge(tx, {
      organizationId: 'org-1',
      subjectId: 'contact-1',
      subjectType: 'contact',
      predicate: 'contact_is_party',
      objectId: 'party-1',
      objectType: 'party',
    });
    expect(insertSpy).toHaveBeenCalled();
  });
});

describe('removeEdge', () => {
  it('calls delete with correct where clause', async () => {
    const { tx, deleteSpy } = makeTx();
    await removeEdge(tx, {
      organizationId: 'org-1',
      subjectId: 'contact-1',
      subjectType: 'contact',
      predicate: 'contact_is_party',
      objectId: 'party-1',
      objectType: 'party',
    });
    expect(deleteSpy).toHaveBeenCalled();
  });
});

describe('findNeighbors', () => {
  it('returns adjacent nodes from SELECT result', async () => {
    const { tx } = makeTx();
    const results = await findNeighbors(tx, {
      organizationId: 'org-1',
      nodeId: 'contact-1',
      nodeType: 'contact',
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.nodeId).toBe('party-1');
    expect(results[0]!.nodeType).toBe('party');
  });
});
