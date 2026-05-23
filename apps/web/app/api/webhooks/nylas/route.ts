import { calendarEvents, communications, emailThreads, getDb, orgNylasConnections } from '@cema/db';
import {
  fetchCalendarEvent,
  fetchEmailThread,
  getNylasClient,
  parseNylasWebhookPayload,
  verifyNylasWebhookSignature,
} from '@cema/integrations-nylas';
import { publish } from '@cema/queues';
import { eq } from 'drizzle-orm';

import { vercelQueueSend } from '@/lib/queue';

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.NYLAS_WEBHOOK_SECRET;
  if (!secret) {
    return new Response('NYLAS_WEBHOOK_SECRET not configured', { status: 500 });
  }

  const sig = req.headers.get('x-nylas-signature') ?? '';
  const rawBody = await req.text();

  if (!verifyNylasWebhookSignature(secret, sig, rawBody)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const event = parseNylasWebhookPayload(rawBody);

  const db = getDb();

  const [conn] = await db
    .select({
      organizationId: orgNylasConnections.organizationId,
      providerType: orgNylasConnections.providerType,
    })
    .from(orgNylasConnections)
    .where(eq(orgNylasConnections.nylasGrantId, event.grantId))
    .limit(1);

  if (!conn) {
    return new Response('OK', { status: 200 });
  }

  const orgId = conn.organizationId;
  const medium = (conn.providerType as 'gmail' | 'm365') ?? 'gmail';
  const apiKey = process.env.NYLAS_API_KEY ?? '';
  const nylasClient = getNylasClient(apiKey);

  if (event.trigger === 'message.created') {
    const { threadId } = event.objectData as { threadId: string };
    if (!threadId) {
      return new Response('OK', { status: 200 });
    }

    const thread = await fetchEmailThread(nylasClient, event.grantId, threadId);

    const [comm] = await db
      .insert(communications)
      .values({
        organizationId: orgId,
        kind: 'email',
        direction: 'inbound',
        medium,
        vendorEventId: thread.nylasThreadId,
        sourceThreadId: thread.nylasThreadId,
        startedAt: thread.firstMessageAt,
        endedAt: thread.lastMessageAt,
        status: 'ready',
      })
      .onConflictDoUpdate({
        target: communications.vendorEventId,
        set: { status: 'ready', endedAt: thread.lastMessageAt, updatedAt: new Date() },
      })
      .returning();

    if (comm) {
      await db
        .insert(emailThreads)
        .values({
          communicationId: comm.id,
          nylasThreadId: thread.nylasThreadId,
          nylasGrantId: thread.nylasGrantId,
          subject: thread.subject,
          snippet: thread.snippet,
          fromEmail: thread.fromEmail,
          fromName: thread.fromName,
          toParticipants: thread.toParticipants,
          ccParticipants: thread.ccParticipants,
          bodyHtml: thread.bodyHtml,
          bodyPlain: thread.bodyPlain,
          messageCount: thread.messageCount,
          hasAttachments: thread.hasAttachments,
          nylasAttachmentIds: thread.nylasAttachmentIds,
          firstMessageAt: thread.firstMessageAt,
          lastMessageAt: thread.lastMessageAt,
        })
        .onConflictDoUpdate({
          target: emailThreads.communicationId,
          set: {
            messageCount: thread.messageCount,
            snippet: thread.snippet,
            lastMessageAt: thread.lastMessageAt,
            hasAttachments: thread.hasAttachments,
            nylasAttachmentIds: thread.nylasAttachmentIds,
            updatedAt: new Date(),
          },
        });

      await publish(
        'comms.email.ingest',
        {
          orgId,
          communicationId: comm.id,
          nylasGrantId: thread.nylasGrantId,
          nylasThreadId: thread.nylasThreadId,
          receivedAt: new Date().toISOString(),
        },
        vercelQueueSend,
      );
    }

    return new Response('OK', { status: 200 });
  }

  if (event.trigger === 'event.created' || event.trigger === 'event.updated') {
    const { calendarId, id: eventId } = event.objectData as { calendarId: string; id: string };
    if (!calendarId || !eventId) {
      return new Response('OK', { status: 200 });
    }

    const calEvent = await fetchCalendarEvent(nylasClient, event.grantId, calendarId, eventId);

    const [comm] = await db
      .insert(communications)
      .values({
        organizationId: orgId,
        kind: 'meeting',
        direction: 'inbound',
        medium,
        vendorEventId: calEvent.nylasEventId,
        sourceThreadId: calEvent.nylasEventId,
        startedAt: calEvent.startsAt,
        endedAt: calEvent.endsAt,
        status: 'ready',
      })
      .onConflictDoUpdate({
        target: communications.vendorEventId,
        set: {
          status: 'ready',
          startedAt: calEvent.startsAt,
          endedAt: calEvent.endsAt,
          updatedAt: new Date(),
        },
      })
      .returning();

    if (comm) {
      await db
        .insert(calendarEvents)
        .values({
          communicationId: comm.id,
          nylasEventId: calEvent.nylasEventId,
          nylasCalendarId: calEvent.nylasCalendarId,
          nylasGrantId: calEvent.nylasGrantId,
          title: calEvent.title,
          description: calEvent.description,
          location: calEvent.location,
          eventStatus: calEvent.eventStatus,
          startsAt: calEvent.startsAt,
          endsAt: calEvent.endsAt,
          isAllDay: calEvent.isAllDay,
          organizerEmail: calEvent.organizerEmail,
          organizerName: calEvent.organizerName,
          attendees: calEvent.attendees,
        })
        .onConflictDoUpdate({
          target: calendarEvents.communicationId,
          set: {
            eventStatus: calEvent.eventStatus,
            title: calEvent.title,
            description: calEvent.description,
            location: calEvent.location,
            startsAt: calEvent.startsAt,
            endsAt: calEvent.endsAt,
            attendees: calEvent.attendees,
            updatedAt: new Date(),
          },
        });
    }

    return new Response('OK', { status: 200 });
  }

  return new Response('OK', { status: 200 });
}
