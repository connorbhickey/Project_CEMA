import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@cema/auth', () => ({
  getCurrentOrganizationId: vi.fn().mockResolvedValue('clerk-org-1'),
}));

vi.mock('@cema/db', () => ({
  getDb: vi.fn(),
  organizations: {},
  communications: { id: 'id_col', dealId: 'deal_id_col' },
  slackMessages: { communicationId: 'communication_id_col' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue({}),
  and: vi.fn().mockReturnValue({}),
}));

vi.mock('../with-rls', () => ({ withRls: vi.fn() }));
vi.mock('../audit/with-read-audit', () => ({
  withReadAudit: vi.fn().mockImplementation((_input: unknown, fn: () => unknown) => fn()),
}));

import { getDb } from '@cema/db';

import { withRls } from '../with-rls';

import { getSlackMessage } from './get-slack-message';

const ORG = { id: 'org-uuid-1', clerkOrgId: 'clerk-org-1' };
const DEAL_ID = 'deal-uuid-1';
const COMM_ID = 'comm-uuid-1';

function makeMockTx(rows: unknown[]) {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(rows) }),
        }),
      }),
    }),
  };
}

describe('getSlackMessage', () => {
  beforeEach(() => {
    vi.mocked(getDb).mockReturnValue({
      query: { organizations: { findFirst: vi.fn().mockResolvedValue(ORG) } },
    } as unknown as ReturnType<typeof getDb>);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when organization is not found', async () => {
    vi.mocked(getDb).mockReturnValue({
      query: { organizations: { findFirst: vi.fn().mockResolvedValue(null) } },
    } as unknown as ReturnType<typeof getDb>);

    expect(await getSlackMessage(DEAL_ID, COMM_ID)).toBeNull();
  });

  it('returns null when no row is found', async () => {
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(makeMockTx([]) as never));
    expect(await getSlackMessage(DEAL_ID, COMM_ID)).toBeNull();
  });

  it('returns communication + slackMessage on happy path', async () => {
    const rows = [
      {
        communications: { id: COMM_ID, kind: 'slack', dealId: DEAL_ID },
        slack_messages: { id: 'msg-1', slackMessageTs: 'SXXX', communicationId: COMM_ID },
      },
    ];
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(makeMockTx(rows) as never));

    const result = await getSlackMessage(DEAL_ID, COMM_ID);
    expect(result?.communication.id).toBe(COMM_ID);
    expect(result?.slackMessage?.slackMessageTs).toBe('SXXX');
  });

  it('returns null slackMessage when left-join finds none', async () => {
    const rows = [
      {
        communications: { id: COMM_ID, kind: 'slack', dealId: DEAL_ID },
        slack_messages: null,
      },
    ];
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(makeMockTx(rows) as never));

    const result = await getSlackMessage(DEAL_ID, COMM_ID);
    expect(result?.slackMessage).toBeNull();
  });
});
