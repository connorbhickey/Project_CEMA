import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the auth + DB + RLS boundary. Leave the chain-of-title pure core and
// @cema/collateral REAL — we are exercising the real recompute.
const findFirstOrg = vi.fn();

vi.mock('@cema/auth', () => ({
  getCurrentOrganizationId: () => Promise.resolve('clerk-org'),
  getCurrentUser: () => Promise.resolve({ id: 'clerk-user' }),
}));

vi.mock('@cema/db', () => ({
  getDb: () => ({ query: { organizations: { findFirst: findFirstOrg } } }),
  documents: {
    id: 'documents.id',
    dealId: 'documents.dealId',
    extractedData: 'documents.extractedData',
  },
  organizations: { clerkOrgId: 'organizations.clerkOrgId' },
}));

vi.mock('drizzle-orm', () => ({
  eq: (...a: unknown[]) => ({ eq: a }),
  and: (...a: unknown[]) => ({ and: a }),
}));

let txRows: Array<{ extractedData: unknown }> = [];
vi.mock('@/lib/with-rls', () => ({
  withRls: (_orgId: string, fn: (tx: unknown) => unknown) => {
    const chain = {
      select: () => chain,
      from: () => chain,
      where: () => Promise.resolve(txRows),
    };
    return fn(chain);
  },
}));

import type { DocumentKind, InstrumentRecord } from '@cema/collateral';

import { getDealChainFindings, isInstrumentRecord } from './deal-chain-findings';

function inst(
  p: Partial<InstrumentRecord> & { documentId: string; instrumentKind: DocumentKind },
): InstrumentRecord {
  return {
    assignor: null,
    assignee: null,
    executedAt: null,
    recordedAt: null,
    amount: null,
    recordingRef: { reelPage: null, crfn: `crfn-${p.documentId}` },
    county: null,
    references: null,
    ...p,
  };
}

beforeEach(() => {
  findFirstOrg.mockResolvedValue({ id: '00000000-0000-0000-0000-0000000000a7' });
  txRows = [];
});

describe('isInstrumentRecord', () => {
  it('accepts a real InstrumentRecord and rejects the empty jsonb default', () => {
    expect(isInstrumentRecord(inst({ documentId: 'm1', instrumentKind: 'mortgage' }))).toBe(true);
    expect(isInstrumentRecord({})).toBe(false);
    expect(isInstrumentRecord(null)).toBe(false);
    expect(isInstrumentRecord({ instrumentKind: 123 })).toBe(false);
  });
});

describe('getDealChainFindings', () => {
  it('returns { analyzed: false } when no instruments are persisted', async () => {
    txRows = [{ extractedData: {} }, { extractedData: {} }];
    const r = await getDealChainFindings('deal-1');
    expect(r).toEqual({ analyzed: false, status: null, routes: [] });
  });

  it('clean chain → advisory_pass', async () => {
    txRows = [
      { extractedData: inst({ documentId: 'm1', instrumentKind: 'mortgage' }) },
      {
        extractedData: inst({
          documentId: 'a1',
          instrumentKind: 'aom',
          assignor: 'Lender A',
          assignee: 'Lender B',
          recordedAt: '2026-01-01',
        }),
      },
    ];
    const r = await getDealChainFindings('deal-1');
    expect(r.analyzed).toBe(true);
    expect(r.status).toBe('clean');
    expect(r.routes).toHaveLength(1);
    expect(r.routes[0]!.kind).toBe('advisory_pass');
  });

  it('missing assignment → broken + re_chase', async () => {
    txRows = [
      { extractedData: inst({ documentId: 'm1', instrumentKind: 'mortgage' }) },
      {
        extractedData: inst({
          documentId: 'a1',
          instrumentKind: 'aom',
          assignor: 'A',
          assignee: 'B',
          recordedAt: '2026-01-01',
        }),
      },
      {
        extractedData: inst({
          documentId: 'a2',
          instrumentKind: 'aom',
          assignor: 'C',
          assignee: 'D',
          recordedAt: '2026-02-01',
        }),
      },
    ];
    const r = await getDealChainFindings('deal-1');
    expect(r.status).toBe('broken');
    expect(r.routes.some((x) => x.kind === 're_chase')).toBe(true);
  });

  it('lost note → ambiguous + attorney_review', async () => {
    txRows = [{ extractedData: inst({ documentId: 'n1', instrumentKind: 'note' }) }];
    const r = await getDealChainFindings('deal-1');
    expect(r.status).toBe('ambiguous');
    expect(r.routes.some((x) => x.kind === 'attorney_review')).toBe(true);
  });

  it('returns empty findings when the org cannot be resolved', async () => {
    findFirstOrg.mockResolvedValue(undefined);
    const r = await getDealChainFindings('deal-1');
    expect(r).toEqual({ analyzed: false, status: null, routes: [] });
  });
});
