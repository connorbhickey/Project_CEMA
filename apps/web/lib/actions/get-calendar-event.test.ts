import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@cema/auth', () => ({
  getCurrentOrganizationId: vi.fn().mockResolvedValue('clerk-org-1'),
}));

vi.mock('@cema/db', () => ({
  getDb: vi.fn(),
  organizations: {},
  communications: { id: 'id_col', dealId: 'deal_id_col' },
  calendarEvents: { communicationId: 'communication_id_col' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue({}),
  and: vi.fn().mockReturnValue({}),
}));

vi.mock('../with-rls', () => ({ withRls: vi.fn() }));

import { getDb } from '@cema/db';

import { withRls } from '../with-rls';

import { getCalendarEvent } from './get-calendar-event';

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

describe('getCalendarEvent', () => {
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

    expect(await getCalendarEvent(DEAL_ID, COMM_ID)).toBeNull();
  });

  it('returns null when no row is found', async () => {
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(makeMockTx([]) as never));
    expect(await getCalendarEvent(DEAL_ID, COMM_ID)).toBeNull();
  });

  it('returns communication + calendarEvent on happy path', async () => {
    const rows = [
      {
        communications: { id: COMM_ID, kind: 'meeting', dealId: DEAL_ID },
        calendar_events: { id: 'evt-1', title: 'CEMA Closing', communicationId: COMM_ID },
      },
    ];
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(makeMockTx(rows) as never));

    const result = await getCalendarEvent(DEAL_ID, COMM_ID);
    expect(result?.communication.id).toBe(COMM_ID);
    expect(result?.calendarEvent?.title).toBe('CEMA Closing');
  });

  it('returns null calendarEvent when left-join finds none', async () => {
    const rows = [
      {
        communications: { id: COMM_ID, kind: 'meeting', dealId: DEAL_ID },
        calendar_events: null,
      },
    ];
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(makeMockTx(rows) as never));

    const result = await getCalendarEvent(DEAL_ID, COMM_ID);
    expect(result?.calendarEvent).toBeNull();
  });
});
