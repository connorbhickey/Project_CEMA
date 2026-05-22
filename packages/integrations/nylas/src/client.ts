import Nylas from 'nylas';

import type { NormalizedCalendarEvent, NormalizedEmailThread } from './types';

export function getNylasClient(apiKey: string): Nylas {
  return new Nylas({ apiKey });
}

export async function fetchEmailThread(
  client: Nylas,
  grantId: string,
  threadId: string,
): Promise<NormalizedEmailThread> {
  const response = await client.threads.find({ identifier: grantId, threadId });
  const thread = response.data as {
    id?: string;
    subject?: string;
    snippet?: string;
    from?: { email?: string; name?: string }[];
    to?: { email?: string; name?: string }[];
    cc?: { email?: string; name?: string }[];
    latestDraftOrMessage?: { body?: string; attachments?: { id: string }[] };
    messageIds?: string[];
    earliestMessageDate?: number;
    latestMessageReceivedDate?: number;
  };

  const lastMsg = thread.latestDraftOrMessage;
  const attachmentIds = (lastMsg?.attachments ?? []).map((a) => a.id);

  const fromArr = thread.from ?? [];
  const toArr = thread.to ?? [];
  const ccArr = thread.cc ?? [];

  return {
    nylasThreadId: thread.id ?? threadId,
    nylasGrantId: grantId,
    subject: thread.subject ?? null,
    snippet: thread.snippet ?? null,
    fromEmail: fromArr[0]?.email ?? null,
    fromName: fromArr[0]?.name ?? null,
    toParticipants: toArr.map((p) => ({ email: p.email ?? '', name: p.name ?? null })),
    ccParticipants: ccArr.map((p) => ({ email: p.email ?? '', name: p.name ?? null })),
    bodyHtml: lastMsg?.body ?? null,
    bodyPlain: null,
    messageCount: (thread.messageIds ?? []).length || 1,
    hasAttachments: attachmentIds.length > 0,
    nylasAttachmentIds: attachmentIds,
    firstMessageAt: toUnixDate(thread.earliestMessageDate),
    lastMessageAt: toUnixDate(thread.latestMessageReceivedDate),
  };
}

export async function fetchCalendarEvent(
  client: Nylas,
  grantId: string,
  calendarId: string,
  eventId: string,
): Promise<NormalizedCalendarEvent> {
  const response = await client.events.find({
    identifier: grantId,
    eventId,
    queryParams: { calendarId },
  });

  const e = response.data as {
    id?: string;
    calendarId?: string;
    title?: string;
    description?: string;
    location?: string;
    status?: string;
    when?: { startTime?: number; endTime?: number; object?: string };
    organizer?: { email?: string; name?: string };
    participants?: { email?: string; name?: string; status?: string }[];
  };

  const when = e.when ?? {};
  const isAllDay = when.object === 'date' || when.object === 'datespan';

  return {
    nylasEventId: e.id ?? eventId,
    nylasCalendarId: e.calendarId ?? calendarId,
    nylasGrantId: grantId,
    title: e.title ?? null,
    description: e.description ?? null,
    location: e.location ?? null,
    eventStatus: normalizeStatus(e.status),
    startsAt: toUnixDate(when.startTime),
    endsAt: toUnixDate(when.endTime),
    isAllDay,
    organizerEmail: e.organizer?.email ?? null,
    organizerName: e.organizer?.name ?? null,
    attendees: (e.participants ?? []).map((p) => ({
      email: p.email ?? '',
      name: p.name ?? null,
      status: normalizeAttendeeStatus(p.status),
    })),
  };
}

function toUnixDate(unix: number | undefined): Date | null {
  if (!unix) return null;
  return new Date(unix * 1000);
}

function normalizeStatus(s: string | undefined): 'confirmed' | 'tentative' | 'cancelled' {
  if (s === 'tentative') return 'tentative';
  if (s === 'cancelled') return 'cancelled';
  return 'confirmed';
}

function normalizeAttendeeStatus(
  s: string | undefined,
): 'accepted' | 'declined' | 'tentative' | 'noreply' {
  if (s === 'accepted' || s === 'yes') return 'accepted';
  if (s === 'declined' || s === 'no') return 'declined';
  if (s === 'tentative' || s === 'maybe') return 'tentative';
  return 'noreply';
}
