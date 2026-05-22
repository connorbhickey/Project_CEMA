import { getCurrentOrganizationId } from '@cema/auth';
import { calendarEvents, communications, getDb, organizations } from '@cema/db';
import { and, desc, eq } from 'drizzle-orm';

import { withRls } from '../with-rls';

type Communication = typeof communications.$inferSelect;
type CalendarEvent = typeof calendarEvents.$inferSelect;

export interface CalendarEventRow {
  communication: Communication;
  calendarEvent: CalendarEvent | null;
}

export async function listCalendarEvents(dealId: string): Promise<CalendarEventRow[]> {
  const clerkOrgId = await getCurrentOrganizationId();
  const db = getDb();

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) return [];

  const rows = await withRls(org.id, async (tx) =>
    tx
      .select()
      .from(communications)
      .leftJoin(calendarEvents, eq(calendarEvents.communicationId, communications.id))
      .where(and(eq(communications.dealId, dealId), eq(communications.kind, 'meeting')))
      .orderBy(desc(communications.startedAt)),
  );

  return rows.map((row) => ({
    communication: row.communications,
    calendarEvent: row.calendar_events,
  }));
}
