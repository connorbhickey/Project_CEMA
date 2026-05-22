import { emitAuditEvent } from '@cema/compliance';
import { docusignEnvelopes, getDb, orgDocusignConnections } from '@cema/db';
import { parseDocusignConnectPayload, verifyDocusignSignature } from '@cema/integrations-docusign';
import { publish } from '@cema/queues';
import { eq } from 'drizzle-orm';

import { vercelQueueSend } from '@/lib/queue';

const STATUS_MAP: Record<string, string> = {
  created: 'created',
  sent: 'sent',
  delivered: 'delivered',
  signed: 'signed',
  completed: 'completed',
  declined: 'declined',
  voided: 'voided',
};

export async function POST(req: Request): Promise<Response> {
  const sig = req.headers.get('x-docusign-signature-1') ?? '';
  const rawBody = await req.text();

  let envelopeIdHint: string | null = null;
  try {
    const peek = JSON.parse(rawBody) as { data?: { envelopeId?: string } };
    envelopeIdHint = peek.data?.envelopeId ?? null;
  } catch {
    return new Response('Bad Request — invalid JSON', { status: 400 });
  }

  if (!envelopeIdHint) {
    return new Response('Bad Request — missing envelopeId', { status: 400 });
  }

  const db = getDb();
  const [envRow] = await db
    .select({
      envelopeRowId: docusignEnvelopes.id,
      organizationId: docusignEnvelopes.organizationId,
      documentId: docusignEnvelopes.documentId,
      docusignConnectionId: docusignEnvelopes.docusignConnectionId,
    })
    .from(docusignEnvelopes)
    .where(eq(docusignEnvelopes.docusignEnvelopeId, envelopeIdHint))
    .limit(1);

  if (!envRow) {
    return new Response('OK', { status: 200 });
  }

  const [conn] = await db
    .select({ connectSecret: orgDocusignConnections.connectSecret })
    .from(orgDocusignConnections)
    .where(eq(orgDocusignConnections.id, envRow.docusignConnectionId))
    .limit(1);

  if (!conn || !verifyDocusignSignature(conn.connectSecret, sig, rawBody)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const parsed = parseDocusignConnectPayload(rawBody);
  const newStatus = (STATUS_MAP[parsed.status] ?? parsed.status) as
    | 'created'
    | 'sent'
    | 'delivered'
    | 'signed'
    | 'completed'
    | 'declined'
    | 'voided';

  const isTerminal = ['completed', 'declined', 'voided', 'signed'].includes(newStatus);

  await db
    .update(docusignEnvelopes)
    .set({
      status: newStatus,
      recipients: parsed.recipients.map((r) => ({
        email: r.email,
        name: r.name,
        role: 'signer',
        routingOrder: r.routingOrder,
        status: r.status as 'created' | 'sent' | 'delivered' | 'signed' | 'declined' | 'completed',
        signedAt: r.signedDateTime,
      })),
      completedAt: isTerminal ? new Date() : null,
      voidedReason: newStatus === 'voided' ? parsed.voidedReason : null,
      updatedAt: new Date(),
    })
    .where(eq(docusignEnvelopes.id, envRow.envelopeRowId));

  await emitAuditEvent(db, {
    organizationId: envRow.organizationId,
    action: `envelope.${parsed.event}`,
    entityType: 'docusign_envelope',
    entityId: envRow.envelopeRowId,
    metadata: {
      envelopeId: envelopeIdHint,
      status: parsed.status,
      statusChangedDateTime: parsed.statusChangedDateTime,
    },
  });

  await publish(
    'esign.docusign.events',
    {
      orgId: envRow.organizationId,
      envelopeId: envelopeIdHint,
      event: parsed.event,
      receivedAt: new Date().toISOString(),
    },
    vercelQueueSend,
  );

  return new Response('OK', { status: 200 });
}
