/**
 * RLS multi-tenant isolation — org_nylas_connections, email_threads,
 * calendar_events (M3 Task 14).
 *
 * Proves migration 0016_rls_email_calendar.sql isolates rows across
 * organizations. Two policy shapes are exercised:
 *   - org_nylas_connections: direct organization_id equality
 *   - email_threads / calendar_events: EXISTS via communications
 *     (same pattern as the recordings policy from 0011)
 */

import {
  calendarEvents,
  communications,
  emailThreads,
  getDb,
  orgNylasConnections,
  organizations,
  users,
} from '@cema/db';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withRls } from '../../lib/with-rls';

const ORG_A_ID = '00000000-0000-0000-0000-0000000000a3';
const ORG_B_ID = '00000000-0000-0000-0000-0000000000b3';
const USER_ID = '00000000-0000-0000-0000-000000000093';
const GRANT_ID_A = 'nylas-grant-test-org-a';

const skip = !process.env.DATABASE_URL;

let connAId: string;
let commEmailId: string;
let commMeetingId: string;
let threadAId: string;
let eventAId: string;

describe.skipIf(skip)('RLS — org_nylas_connections + email_threads + calendar_events', () => {
  beforeAll(async () => {
    const db = getDb();

    await db
      .insert(organizations)
      .values([
        {
          id: ORG_A_ID,
          clerkOrgId: 'org_email_rls_test_a',
          name: 'Org A (Email RLS)',
          slug: 'email-rls-org-a',
        },
        {
          id: ORG_B_ID,
          clerkOrgId: 'org_email_rls_test_b',
          name: 'Org B (Email RLS)',
          slug: 'email-rls-org-b',
        },
      ])
      .onConflictDoNothing();

    await db
      .insert(users)
      .values({
        id: USER_ID,
        clerkUserId: 'user_email_rls_test',
        email: 'email-rls@example.invalid',
      })
      .onConflictDoNothing();

    const [connA] = await db
      .insert(orgNylasConnections)
      .values({
        organizationId: ORG_A_ID,
        providerType: 'gmail',
        nylasGrantId: GRANT_ID_A,
        emailAddress: 'test@org-a.example.invalid',
        connectionStatus: 'active',
        createdById: USER_ID,
      })
      .returning();
    connAId = connA!.id;

    const [commEmail] = await db
      .insert(communications)
      .values({
        organizationId: ORG_A_ID,
        kind: 'email',
        direction: 'inbound',
        medium: 'gmail',
        status: 'ready',
      })
      .returning();
    commEmailId = commEmail!.id;

    const [thread] = await db
      .insert(emailThreads)
      .values({
        communicationId: commEmailId,
        nylasThreadId: 'thread-rls-test-001',
        nylasGrantId: GRANT_ID_A,
        subject: 'RLS test email',
        toParticipants: [],
        ccParticipants: [],
        nylasAttachmentIds: [],
        messageCount: 1,
        hasAttachments: false,
      })
      .returning();
    threadAId = thread!.id;

    const [commMeeting] = await db
      .insert(communications)
      .values({
        organizationId: ORG_A_ID,
        kind: 'meeting',
        direction: 'inbound',
        medium: 'gmail',
        status: 'ready',
      })
      .returning();
    commMeetingId = commMeeting!.id;

    const [evt] = await db
      .insert(calendarEvents)
      .values({
        communicationId: commMeetingId,
        nylasEventId: 'event-rls-test-001',
        nylasCalendarId: 'cal-test-001',
        nylasGrantId: GRANT_ID_A,
        eventStatus: 'confirmed',
        isAllDay: false,
        attendees: [],
      })
      .returning();
    eventAId = evt!.id;
  });

  afterAll(async () => {
    const db = getDb();
    await db.delete(calendarEvents).where(eq(calendarEvents.id, eventAId));
    await db.delete(emailThreads).where(eq(emailThreads.id, threadAId));
    await db
      .delete(communications)
      .where(inArray(communications.organizationId, [ORG_A_ID, ORG_B_ID]));
    await db.delete(orgNylasConnections).where(eq(orgNylasConnections.id, connAId));
    await db.delete(organizations).where(inArray(organizations.id, [ORG_A_ID, ORG_B_ID]));
    await db.delete(users).where(eq(users.id, USER_ID));
  });

  it('Org B cannot SELECT Org A nylas connections via withRls', async () => {
    const visible = await withRls(ORG_B_ID, (tx) =>
      tx
        .select({ id: orgNylasConnections.id })
        .from(orgNylasConnections)
        .where(eq(orgNylasConnections.id, connAId)),
    );
    expect(visible).toHaveLength(0);
  });

  it('Org A sees its own nylas connections via withRls', async () => {
    const visible = await withRls(ORG_A_ID, (tx) =>
      tx
        .select({ id: orgNylasConnections.id })
        .from(orgNylasConnections)
        .where(eq(orgNylasConnections.id, connAId)),
    );
    expect(visible).toHaveLength(1);
  });

  it('Org B cannot SELECT Org A email_threads via withRls (EXISTS-join policy)', async () => {
    const visible = await withRls(ORG_B_ID, (tx) =>
      tx.select({ id: emailThreads.id }).from(emailThreads).where(eq(emailThreads.id, threadAId)),
    );
    expect(visible).toHaveLength(0);
  });

  it('Org A sees its own email_threads via withRls', async () => {
    const visible = await withRls(ORG_A_ID, (tx) =>
      tx.select({ id: emailThreads.id }).from(emailThreads).where(eq(emailThreads.id, threadAId)),
    );
    expect(visible).toHaveLength(1);
  });

  it('Org B cannot SELECT Org A calendar_events via withRls (EXISTS-join policy)', async () => {
    const visible = await withRls(ORG_B_ID, (tx) =>
      tx
        .select({ id: calendarEvents.id })
        .from(calendarEvents)
        .where(eq(calendarEvents.id, eventAId)),
    );
    expect(visible).toHaveLength(0);
  });

  it('Org A sees its own calendar_events via withRls', async () => {
    const visible = await withRls(ORG_A_ID, (tx) =>
      tx
        .select({ id: calendarEvents.id })
        .from(calendarEvents)
        .where(eq(calendarEvents.id, eventAId)),
    );
    expect(visible).toHaveLength(1);
  });
});
