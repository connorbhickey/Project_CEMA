import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@cema/auth', () => ({
  getCurrentOrganizationId: vi.fn().mockResolvedValue('clerk-org-1'),
}));

vi.mock('@cema/db', () => ({
  getDb: vi.fn(),
  organizations: {},
  communications: { id: 'id_col', dealId: 'deal_id_col', kind: 'kind_col' },
  calendarEvents: { communicationId: 'communication_id_col' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue({}),
  and: vi.fn().mockReturnValue({}),
  desc: vi.fn().mockReturnValue({}),
}));

vi.mock('../with-rls', () => ({ withRls: vi.fn() }));

import { getDb } from '@cema/db';

import { withRls } from '../with-rls';

import { listCalendarEvents } from './list-calendar-events';

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

describe('listCalendarEvents', () => {
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

    expect(await listCalendarEvents(DEAL_ID)).toEqual([]);
  });

  it('flattens join rows to communication + calendarEvent pairs', async () => {
    const rows = [
      {
        communications: { id: 'comm-1', kind: 'meeting', dealId: DEAL_ID },
        calendar_events: {
          id: 'evt-1',
          title: 'CEMA Closing',
          communicationId: 'comm-1',
        },
      },
    ];
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(makeMockTx(rows) as never));

    const result = await listCalendarEvents(DEAL_ID);
    expect(result).toHaveLength(1);
    expect(result[0]?.communication.kind).toBe('meeting');
    expect(result[0]?.calendarEvent?.title).toBe('CEMA Closing');
  });

  it('returns null calendarEvent when left-join finds nothing', async () => {
    const rows = [
      {
        communications: { id: 'comm-2', kind: 'meeting', dealId: DEAL_ID },
        calendar_events: null,
      },
    ];
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(makeMockTx(rows) as never));

    const result = await listCalendarEvents(DEAL_ID);
    expect(result[0]?.calendarEvent).toBeNull();
  });

  it('calls withRls with the resolved org id', async () => {
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(makeMockTx([]) as never));
    await listCalendarEvents(DEAL_ID);
    expect(withRls).toHaveBeenCalledWith(ORG.id, expect.any(Function));
  });
});
