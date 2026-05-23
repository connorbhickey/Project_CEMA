import { describe, expect, it, vi } from 'vitest';

vi.mock('nylas', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      threads: {
        find: vi.fn().mockResolvedValue({
          requestId: 'req-1',
          data: {
            id: 'thread-xyz',
            grantId: 'grant-abc',
            subject: 'RE: CEMA request',
            snippet: 'Please see the attached payoff',
            from: [{ email: 'servicer@example.com', name: 'Servicer CEMA' }],
            to: [{ email: 'processor@firm.com', name: 'Processor' }],
            cc: [],
            latestDraftOrMessage: {
              body: '<p>Please see the attached payoff</p>',
              attachments: [{ id: 'att-001' }],
            },
            messageIds: ['msg-001'],
            earliestMessageDate: 1716000000,
            latestMessageReceivedDate: 1716000000,
          },
        }),
      },
      events: {
        find: vi.fn().mockResolvedValue({
          requestId: 'req-2',
          data: {
            id: 'evt-001',
            calendarId: 'cal-001',
            grantId: 'grant-abc',
            title: 'CEMA Closing — Deal 123',
            description: 'Final closing meeting',
            location: '123 Main St',
            status: 'confirmed',
            when: { startTime: 1716003600, endTime: 1716007200, object: 'timespan' },
            organizer: { email: 'attorney@firm.com', name: 'Attorney' },
            participants: [{ email: 'processor@firm.com', name: 'Processor', status: 'accepted' }],
          },
        }),
      },
    })),
  };
});

import { fetchCalendarEvent, fetchEmailThread, getNylasClient } from './client';

describe('fetchEmailThread', () => {
  it('returns a NormalizedEmailThread', async () => {
    const client = getNylasClient('fake-api-key');
    const thread = await fetchEmailThread(client, 'grant-abc', 'thread-xyz');
    expect(thread.nylasThreadId).toBe('thread-xyz');
    expect(thread.subject).toBe('RE: CEMA request');
    expect(thread.fromEmail).toBe('servicer@example.com');
    expect(thread.hasAttachments).toBe(true);
    expect(thread.nylasAttachmentIds).toEqual(['att-001']);
  });
});

describe('fetchCalendarEvent', () => {
  it('returns a NormalizedCalendarEvent', async () => {
    const client = getNylasClient('fake-api-key');
    const event = await fetchCalendarEvent(client, 'grant-abc', 'cal-001', 'evt-001');
    expect(event.nylasEventId).toBe('evt-001');
    expect(event.title).toBe('CEMA Closing — Deal 123');
    expect(event.eventStatus).toBe('confirmed');
    expect(event.attendees).toHaveLength(1);
    expect(event.attendees[0]!.email).toBe('processor@firm.com');
  });
});
