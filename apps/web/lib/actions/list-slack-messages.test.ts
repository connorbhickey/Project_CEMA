import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@cema/auth', () => ({
  getCurrentOrganizationId: vi.fn().mockResolvedValue('clerk-org-1'),
}));

vi.mock('@cema/db', () => ({
  getDb: vi.fn(),
  organizations: {},
  communications: { id: 'id_col', dealId: 'deal_id_col', kind: 'kind_col' },
  slackMessages: { communicationId: 'communication_id_col' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue({}),
  and: vi.fn().mockReturnValue({}),
  desc: vi.fn().mockReturnValue({}),
}));

vi.mock('../with-rls', () => ({ withRls: vi.fn() }));

import { getDb } from '@cema/db';

import { withRls } from '../with-rls';

import { listSlackMessages } from './list-slack-messages';

const ORG = { id: 'org-uuid-1', clerkOrgId: 'clerk-org-1' };
const DEAL_ID = 'deal-uuid-1';

function makeMockTx(rows: unknown[]) {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ orderBy: vi.fn().mockResolvedValue(rows) }),
        }),
      }),
    }),
  };
}

describe('listSlackMessages', () => {
  beforeEach(() => {
    vi.mocked(getDb).mockReturnValue({
      query: { organizations: { findFirst: vi.fn().mockResolvedValue(ORG) } },
    } as unknown as ReturnType<typeof getDb>);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when organization is not found', async () => {
    vi.mocked(getDb).mockReturnValue({
      query: { organizations: { findFirst: vi.fn().mockResolvedValue(null) } },
    } as unknown as ReturnType<typeof getDb>);

    expect(await listSlackMessages(DEAL_ID)).toEqual([]);
  });

  it('flattens join rows to communication + slackMessage pairs', async () => {
    const rows = [
      {
        communications: { id: 'comm-1', kind: 'slack', dealId: DEAL_ID },
        slack_messages: { id: 'msg-1', slackMessageTs: 'SXXX', communicationId: 'comm-1' },
      },
    ];
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(makeMockTx(rows) as never));

    const result = await listSlackMessages(DEAL_ID);
    expect(result).toHaveLength(1);
    expect(result[0]?.communication.kind).toBe('slack');
    expect(result[0]?.slackMessage?.slackMessageTs).toBe('SXXX');
  });

  it('returns null slackMessage when left-join finds no message row', async () => {
    const rows = [
      {
        communications: { id: 'comm-2', kind: 'slack', dealId: DEAL_ID },
        slack_messages: null,
      },
    ];
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(makeMockTx(rows) as never));

    const result = await listSlackMessages(DEAL_ID);
    expect(result[0]?.slackMessage).toBeNull();
  });

  it('calls withRls with the resolved org id', async () => {
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(makeMockTx([]) as never));
    await listSlackMessages(DEAL_ID);
    expect(withRls).toHaveBeenCalledWith(ORG.id, expect.any(Function));
  });
});
