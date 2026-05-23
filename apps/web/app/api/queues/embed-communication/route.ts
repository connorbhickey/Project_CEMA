import {
  communications,
  contactIdentities,
  emailThreads,
  getDb,
  kgEdges,
  slackMessages,
} from '@cema/db';
import { embedText } from '@cema/embeddings';
import { TopicSchema } from '@cema/queues';
import { indexCommunication } from '@cema/typesense';
import { and, eq, inArray } from 'drizzle-orm';

export async function POST(req: Request): Promise<Response> {
  const body = (await req.json()) as unknown;
  const { orgId, communicationId } = TopicSchema['comms.embed'].parse(body);

  const db = getDb();
  const [comm] = await db
    .select()
    .from(communications)
    .where(eq(communications.id, communicationId))
    .limit(1);

  if (!comm || comm.organizationId !== orgId) {
    return new Response('Not found', { status: 404 });
  }

  const textParts = [comm.aiSummary, comm.sourceThreadId, comm.kind].filter(Boolean);
  if (textParts.length === 0) {
    return new Response('No text to embed', { status: 200 });
  }

  const { embedding } = await embedText({ text: textParts.join(' ') });

  await db
    .update(communications)
    .set({ embedding, embeddingGeneratedAt: new Date() })
    .where(eq(communications.id, communicationId));

  const [[emailThread], [slackMsg]] = await Promise.all([
    db
      .select({
        subject: emailThreads.subject,
        snippet: emailThreads.snippet,
        fromEmail: emailThreads.fromEmail,
        toParticipants: emailThreads.toParticipants,
      })
      .from(emailThreads)
      .where(eq(emailThreads.communicationId, communicationId))
      .limit(1),
    db
      .select({
        text: slackMessages.text,
        authorSlackUserId: slackMessages.authorSlackUserId,
      })
      .from(slackMessages)
      .where(eq(slackMessages.communicationId, communicationId))
      .limit(1),
  ]);

  void indexCommunication({
    id: comm.id,
    organization_id: comm.organizationId,
    subject: emailThread?.subject ?? undefined,
    body_preview: emailThread?.snippet ?? slackMsg?.text?.slice(0, 200) ?? undefined,
    direction: comm.direction ?? undefined,
    kind: comm.kind,
    vendor: comm.medium ?? undefined,
    occurred_at: Math.floor((comm.startedAt ?? new Date()).getTime() / 1000),
  });

  void resolveCommParties(db, comm, emailThread ?? null, slackMsg ?? null);

  return new Response('OK', { status: 200 });
}

async function resolveCommParties(
  db: ReturnType<typeof getDb>,
  comm: { id: string; organizationId: string },
  emailThread: {
    fromEmail: string | null;
    toParticipants: { email: string; name: string | null }[];
  } | null,
  slackMsg: { authorSlackUserId: string | null } | null,
): Promise<void> {
  const emailFrom = emailThread?.fromEmail?.toLowerCase() ?? null;
  const emailsTo = (emailThread?.toParticipants ?? []).map((p) => p.email.toLowerCase());
  const slackUser = slackMsg?.authorSlackUserId ?? null;

  const lookupEmails = [
    ...new Set([emailFrom, ...emailsTo].filter((e): e is string => e !== null)),
  ];
  const lookupSlack = slackUser ? [slackUser] : [];

  if (lookupEmails.length === 0 && lookupSlack.length === 0) return;

  // Look up contact identities
  const identityRows = await (async () => {
    const results: { contactId: string; normalizedValue: string; kind: string }[] = [];
    if (lookupEmails.length > 0) {
      const rows = await db
        .select({
          contactId: contactIdentities.contactId,
          normalizedValue: contactIdentities.normalizedValue,
          kind: contactIdentities.kind,
        })
        .from(contactIdentities)
        .where(
          and(
            eq(contactIdentities.organizationId, comm.organizationId),
            eq(contactIdentities.kind, 'email'),
            inArray(contactIdentities.normalizedValue, lookupEmails),
          ),
        );
      results.push(...rows);
    }
    if (lookupSlack.length > 0) {
      const rows = await db
        .select({
          contactId: contactIdentities.contactId,
          normalizedValue: contactIdentities.normalizedValue,
          kind: contactIdentities.kind,
        })
        .from(contactIdentities)
        .where(
          and(
            eq(contactIdentities.organizationId, comm.organizationId),
            eq(contactIdentities.kind, 'slack_user'),
            inArray(contactIdentities.normalizedValue, lookupSlack),
          ),
        );
      results.push(...rows);
    }
    return results;
  })();

  if (identityRows.length === 0) return;

  const contactIds = [...new Set(identityRows.map((r) => r.contactId))];

  const edges = await db
    .select({ subjectId: kgEdges.subjectId, objectId: kgEdges.objectId })
    .from(kgEdges)
    .where(
      and(
        eq(kgEdges.organizationId, comm.organizationId),
        eq(kgEdges.predicate, 'contact_is_party'),
        eq(kgEdges.subjectType, 'contact'),
        inArray(kgEdges.subjectId, contactIds),
      ),
    );

  if (edges.length === 0) return;

  const emailToContact = new Map(identityRows.map((r) => [r.normalizedValue, r.contactId]));
  const contactToParty = new Map(edges.map((e) => [e.subjectId, e.objectId]));

  const fromContactId = emailFrom ? (emailToContact.get(emailFrom) ?? null) : null;
  const fromPartyId = fromContactId ? (contactToParty.get(fromContactId) ?? null) : null;

  const toPartyIds = emailsTo
    .map((e) => {
      const cId = emailToContact.get(e);
      return cId ? (contactToParty.get(cId) ?? null) : null;
    })
    .filter((p): p is string => p !== null);

  if (!fromPartyId && toPartyIds.length === 0) return;

  await db
    .update(communications)
    .set({
      ...(fromPartyId ? { fromPartyId } : {}),
      ...(toPartyIds.length > 0 ? { toPartyIds } : {}),
    })
    .where(eq(communications.id, comm.id));
}
