import { ensureContact } from '@cema/contacts';
import { communications, emailThreads, getDb, parties } from '@cema/db';
import { isNotNull } from 'drizzle-orm';

import { withRls } from '../with-rls';

export interface BackfillResult {
  partiesProcessed: number;
  commsProcessed: number;
  emailThreadsProcessed: number;
  contactsCreated: number;
  identitiesLinked: number;
}

export async function backfillContacts(orgId: string): Promise<BackfillResult> {
  const db = getDb();
  const stats: BackfillResult = {
    partiesProcessed: 0,
    commsProcessed: 0,
    emailThreadsProcessed: 0,
    contactsCreated: 0,
    identitiesLinked: 0,
  };

  // Suppress unused variable warning for db — getDb() call is required to
  // initialise the module-level pool before withRls opens a transaction.
  void db;

  await withRls(orgId, async (tx) => {
    const partyRows = await tx
      .select({
        id: parties.id,
        email: parties.email,
        phone: parties.phone,
        fullName: parties.fullName,
      })
      .from(parties);

    for (const p of partyRows) {
      stats.partiesProcessed += 1;
      if (p.email) {
        const res = await ensureContact(tx, {
          orgId,
          kind: 'email',
          value: p.email,
          source: 'party',
          sourceId: p.id,
          name: p.fullName,
        });
        if (res) {
          stats.identitiesLinked += 1;
          if (res.created) stats.contactsCreated += 1;
        }
      }
      if (p.phone) {
        const res = await ensureContact(tx, {
          orgId,
          kind: 'phone',
          value: p.phone,
          source: 'party',
          sourceId: p.id,
          name: p.fullName,
        });
        if (res) {
          stats.identitiesLinked += 1;
          if (res.created) stats.contactsCreated += 1;
        }
      }
    }

    const commRows = await tx
      .select({
        id: communications.id,
        fromE164: communications.fromE164,
        toE164: communications.toE164,
      })
      .from(communications)
      .where(isNotNull(communications.fromE164));

    for (const c of commRows) {
      stats.commsProcessed += 1;
      if (c.fromE164) {
        const res = await ensureContact(tx, {
          orgId,
          kind: 'phone',
          value: c.fromE164,
          source: 'comm_from',
          sourceId: c.id,
        });
        if (res) {
          stats.identitiesLinked += 1;
          if (res.created) stats.contactsCreated += 1;
        }
      }
      if (c.toE164) {
        const res = await ensureContact(tx, {
          orgId,
          kind: 'phone',
          value: c.toE164,
          source: 'comm_to',
          sourceId: c.id,
        });
        if (res) {
          stats.identitiesLinked += 1;
          if (res.created) stats.contactsCreated += 1;
        }
      }
    }

    const threadRows = await tx
      .select({
        id: emailThreads.id,
        communicationId: emailThreads.communicationId,
        fromEmail: emailThreads.fromEmail,
        toParticipants: emailThreads.toParticipants,
      })
      .from(emailThreads);

    for (const t of threadRows) {
      stats.emailThreadsProcessed += 1;
      if (t.fromEmail) {
        const res = await ensureContact(tx, {
          orgId,
          kind: 'email',
          value: t.fromEmail,
          source: 'comm_from',
          sourceId: t.communicationId,
        });
        if (res) {
          stats.identitiesLinked += 1;
          if (res.created) stats.contactsCreated += 1;
        }
      }
      for (const recipient of t.toParticipants ?? []) {
        const res = await ensureContact(tx, {
          orgId,
          kind: 'email',
          value: recipient.email,
          source: 'comm_to',
          sourceId: t.communicationId,
          name: recipient.name,
        });
        if (res) {
          stats.identitiesLinked += 1;
          if (res.created) stats.contactsCreated += 1;
        }
      }
    }
  });

  return stats;
}
