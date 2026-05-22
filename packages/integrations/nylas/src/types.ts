export interface NormalizedEmailParticipant {
  email: string;
  name: string | null;
}

export interface NormalizedEmailThread {
  nylasThreadId: string;
  nylasGrantId: string;
  subject: string | null;
  snippet: string | null;
  fromEmail: string | null;
  fromName: string | null;
  toParticipants: NormalizedEmailParticipant[];
  ccParticipants: NormalizedEmailParticipant[];
  bodyHtml: string | null;
  bodyPlain: string | null;
  messageCount: number;
  hasAttachments: boolean;
  nylasAttachmentIds: string[];
  firstMessageAt: Date | null;
  lastMessageAt: Date | null;
}

export interface NormalizedCalendarAttendee {
  email: string;
  name: string | null;
  status: 'accepted' | 'declined' | 'tentative' | 'noreply';
}

export interface NormalizedCalendarEvent {
  nylasEventId: string;
  nylasCalendarId: string;
  nylasGrantId: string;
  title: string | null;
  description: string | null;
  location: string | null;
  eventStatus: 'confirmed' | 'tentative' | 'cancelled';
  startsAt: Date | null;
  endsAt: Date | null;
  isAllDay: boolean;
  organizerEmail: string | null;
  organizerName: string | null;
  attendees: NormalizedCalendarAttendee[];
}

export type NylasWebhookEvent =
  | { trigger: 'message.created'; grantId: string; objectData: { threadId: string; id: string } }
  | { trigger: 'event.created'; grantId: string; objectData: { calendarId: string; id: string } }
  | { trigger: 'event.updated'; grantId: string; objectData: { calendarId: string; id: string } }
  | { trigger: string; grantId: string; objectData: Record<string, unknown> };
