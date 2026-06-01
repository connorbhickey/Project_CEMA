import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// All vi.mock() calls are hoisted by Vitest before imports.
// ---------------------------------------------------------------------------

vi.mock('@cema/auth', () => ({
  getCurrentOrganizationId: vi.fn().mockResolvedValue('clerk-org-1'),
  getCurrentUser: vi.fn().mockResolvedValue({ id: 'clerk-user-1' }),
}));

vi.mock('@cema/db', () => ({
  getDb: vi.fn(),
  organizations: {},
  users: {},
  deals: { id: 'deal_id_col', status: 'deal_status_col' },
  dealStatusEnum: {
    enumValues: [
      'intake',
      'eligibility',
      'authorization',
      'collateral_chase',
      'title_work',
      'doc_prep',
      'attorney_review',
      'closing',
      'recording',
      'completed',
      'exception',
      'cancelled',
    ],
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue({}),
}));

vi.mock('@cema/compliance', () => ({
  emitAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('../with-rls', () => ({ withRls: vi.fn() }));

// The post-commit agent dispatch is exercised by its own suite
// (on-deal-status-changed.test.ts). Here we mock it to keep this unit focused
// on the write+audit path and to sever the heavy agent import graph.
vi.mock('../agents/on-deal-status-changed', () => ({
  onDealStatusChanged: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { emitAuditEvent } from '@cema/compliance';
import { getDb } from '@cema/db';
import { revalidatePath } from 'next/cache';

import { onDealStatusChanged } from '../agents/on-deal-status-changed';
import { withRls } from '../with-rls';

import { transitionDealStatus } from './transition-deal-status';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const ORG = { id: 'org-1', clerkOrgId: 'clerk-org-1' };
const USER = { id: 'user-1', clerkUserId: 'clerk-user-1' };

const DEAL_INTAKE = { id: 'deal-1', status: 'intake' };
const DEAL_RECORDING = { id: 'deal-1', status: 'recording' };

// ---------------------------------------------------------------------------
// Shared mock-db factory
// ---------------------------------------------------------------------------

function makeDb() {
  return {
    query: {
      organizations: { findFirst: vi.fn().mockResolvedValue(ORG) },
      users: { findFirst: vi.fn().mockResolvedValue(USER) },
    },
  } as unknown as ReturnType<typeof getDb>;
}

// ---------------------------------------------------------------------------
// withRls tx factory — select returns dealRows; update captured via spy.
// ---------------------------------------------------------------------------

function makeTx(dealRows: unknown[]) {
  const setSpy = vi.fn().mockReturnValue({
    where: vi.fn().mockResolvedValue(undefined),
  });
  const updateSpy = vi.fn().mockReturnValue({ set: setSpy });
  const tx = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(dealRows),
        }),
      }),
    }),
    update: updateSpy,
  };
  return { tx: tx as never, setSpy, updateSpy };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.mocked(getDb).mockReturnValue(makeDb());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('transitionDealStatus', () => {
  it('throws on an invalid target status (system-boundary guard)', async () => {
    await expect(transitionDealStatus('deal-1', 'not_a_status' as never)).rejects.toThrow(
      /Invalid deal status/,
    );
  });

  it('throws when org is not found', async () => {
    vi.mocked(getDb).mockReturnValue({
      query: {
        organizations: { findFirst: vi.fn().mockResolvedValue(null) },
        users: { findFirst: vi.fn().mockResolvedValue(USER) },
      },
    } as unknown as ReturnType<typeof getDb>);

    await expect(transitionDealStatus('deal-1', 'eligibility')).rejects.toThrow(
      'Organization not found',
    );
  });

  it('throws when the deal is not found under RLS', async () => {
    const { tx } = makeTx([]);
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(tx));

    await expect(transitionDealStatus('deal-1', 'eligibility')).rejects.toThrow('Deal not found');
  });

  it('is a no-op when the status is unchanged (no write, no audit, no revalidate)', async () => {
    const { tx, updateSpy } = makeTx([DEAL_INTAKE]);
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(tx));

    const result = await transitionDealStatus('deal-1', 'intake');

    expect(result).toEqual({ dealId: 'deal-1', from: 'intake', to: 'intake', changed: false });
    expect(updateSpy).not.toHaveBeenCalled();
    expect(emitAuditEvent).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(onDealStatusChanged).not.toHaveBeenCalled();
  });

  it('writes the new status, emits a PII-safe audit event, and revalidates on a real change', async () => {
    const { tx, updateSpy } = makeTx([DEAL_INTAKE]);
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(tx));

    const result = await transitionDealStatus('deal-1', 'eligibility');

    expect(result).toEqual({ dealId: 'deal-1', from: 'intake', to: 'eligibility', changed: true });
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(emitAuditEvent).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        organizationId: 'org-1',
        actorUserId: 'user-1',
        action: 'deal.status_changed',
        entityType: 'deal',
        entityId: 'deal-1',
        metadata: { from: 'intake', to: 'eligibility' },
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith('/deals');
    // Post-commit dispatch fires with the new status only on a real change.
    expect(onDealStatusChanged).toHaveBeenCalledWith('deal-1', 'eligibility');
  });

  it('sets completedAt when transitioning to completed (deals_completed_at_required CHECK)', async () => {
    const { tx, setSpy } = makeTx([DEAL_RECORDING]);
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(tx));

    const result = await transitionDealStatus('deal-1', 'completed');

    expect(result.changed).toBe(true);
    expect(setSpy).toHaveBeenCalledTimes(1);
    const patch = setSpy.mock.calls[0]?.[0] as { status: string; completedAt?: unknown };
    expect(patch.status).toBe('completed');
    expect(patch.completedAt).toBeInstanceOf(Date);
  });
});
