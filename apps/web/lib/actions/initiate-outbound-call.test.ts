import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// All vi.mock() calls are hoisted by Vitest before imports
vi.mock('@cema/auth', () => ({
  getCurrentOrganizationId: vi.fn().mockResolvedValue('clerk-org-123'),
  getCurrentUser: vi.fn().mockResolvedValue({ id: 'clerk-user-123' }),
}));

vi.mock('@cema/db', () => ({
  getDb: vi.fn(),
  organizations: {},
  users: {},
  parties: {},
  communications: {},
}));

vi.mock('@cema/compliance', () => ({
  emitAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@cema/integrations-twilio', () => ({
  initiateOutboundCall: vi.fn().mockResolvedValue({ callSid: 'CA123', status: 'queued' }),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue({}),
}));

vi.mock('../with-rls', () => ({
  withRls: vi.fn(),
}));

import { getDb } from '@cema/db';
import { initiateOutboundCall as twilioInitiate } from '@cema/integrations-twilio';

import { TcpaConsentMissingError } from '../compliance/tcpa-guard';
import { withRls } from '../with-rls';

import { initiateOutboundCall } from './initiate-outbound-call';

const VALID_INPUT = { dealId: 'deal-uuid-1', partyId: 'party-uuid-1' };
const ORG = { id: 'org-uuid-1', clerkOrgId: 'clerk-org-123' };
const USER = { id: 'user-uuid-1', clerkUserId: 'clerk-user-123' };

function makeParty(overrides: Record<string, unknown> = {}) {
  return {
    id: 'party-uuid-1',
    role: 'doc_custodian',
    phone: '+12125551234',
    tcpaOptIn: false,
    tcpaOptInAt: null,
    ...overrides,
  };
}

function makeMockTx(party: ReturnType<typeof makeParty>) {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([party]),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'comm-uuid-1' }]),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
  };
}

describe('initiateOutboundCall (server action)', () => {
  beforeEach(() => {
    process.env.TWILIO_PHONE_NUMBER = '+12125559999';
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com';

    const mockDb = {
      query: {
        organizations: {
          findFirst: vi.fn().mockResolvedValue(ORG),
        },
        users: {
          findFirst: vi.fn().mockResolvedValue(USER),
        },
      },
    };
    vi.mocked(getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.TWILIO_PHONE_NUMBER;
  });

  it('throws TcpaConsentMissingError for a borrower without opt-in', async () => {
    const party = makeParty({ role: 'borrower', tcpaOptIn: false, tcpaOptInAt: null });
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(makeMockTx(party) as never));

    await expect(initiateOutboundCall(VALID_INPUT)).rejects.toThrow(TcpaConsentMissingError);
    expect(twilioInitiate).not.toHaveBeenCalled();
  });

  it('throws TcpaConsentMissingError for a co_borrower without opt-in', async () => {
    const party = makeParty({ role: 'co_borrower', tcpaOptIn: false, tcpaOptInAt: null });
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(makeMockTx(party) as never));

    await expect(initiateOutboundCall(VALID_INPUT)).rejects.toThrow(TcpaConsentMissingError);
  });

  it('succeeds and calls Twilio for a non-borrower party without TCPA opt-in', async () => {
    const party = makeParty({ role: 'doc_custodian' });
    const mockTx = makeMockTx(party);
    vi.mocked(withRls)
      .mockImplementationOnce((_orgId, fn) => fn(mockTx as never))
      .mockImplementationOnce((_orgId, fn) => fn(mockTx as never));

    const result = await initiateOutboundCall(VALID_INPUT);

    expect(twilioInitiate).toHaveBeenCalledOnce();
    expect(result).toEqual({ communicationId: 'comm-uuid-1' });
  });

  it('passes twimlUrl containing the communicationId to Twilio', async () => {
    const party = makeParty({ role: 'doc_custodian' });
    const mockTx = makeMockTx(party);
    vi.mocked(withRls)
      .mockImplementationOnce((_orgId, fn) => fn(mockTx as never))
      .mockImplementationOnce((_orgId, fn) => fn(mockTx as never));

    await initiateOutboundCall(VALID_INPUT);

    const [callArgs] = vi.mocked(twilioInitiate).mock.calls;
    expect((callArgs as unknown[])[0]).toMatchObject({
      twimlUrl: expect.stringContaining('comm-uuid-1') as string,
      toE164: '+12125551234',
    });
  });

  it('throws if party has no phone number', async () => {
    const party = makeParty({ phone: null });
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(makeMockTx(party) as never));

    await expect(initiateOutboundCall(VALID_INPUT)).rejects.toThrow('no phone number');
  });
});
