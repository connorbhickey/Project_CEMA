'use server';

import { getCurrentOrganizationId, getCurrentUser } from '@cema/auth';
import { signedDownloadUrl } from '@cema/blob';
import { emitAuditEvent } from '@cema/compliance';
import {
  attorneyApprovals,
  documents,
  docusignEnvelopes,
  getDb,
  orgDocusignConnections,
  organizations,
  users,
} from '@cema/db';
import { createEnvelope, getDocusignClient } from '@cema/integrations-docusign';
import { and, desc, eq } from 'drizzle-orm';

import { withRls } from '../with-rls';

// ---------------------------------------------------------------------------
// Hard rule #2 enforcement — server-side gate.
// Any document with attorneyReviewRequired = true MUST have a corresponding
// AttorneyApproval row before an envelope can be sent. Client-side UI gates
// are advisory only; this is the authoritative enforcement point.
// ---------------------------------------------------------------------------

export class AttorneyReviewMissingError extends Error {
  constructor(documentId: string) {
    super(`Document ${documentId} requires attorney review but has no AttorneyApproval event`);
    this.name = 'AttorneyReviewMissingError';
  }
}

export class DocusignConnectionMissingError extends Error {
  constructor(orgId: string) {
    super(`Organization ${orgId} has no active DocuSign connection`);
    this.name = 'DocusignConnectionMissingError';
  }
}

export interface SendEnvelopeInput {
  documentId: string;
  subject: string;
  recipients: Array<{ email: string; name: string; role: string }>;
}

export interface SendEnvelopeResult {
  envelopeRowId: string;
  docusignEnvelopeId: string;
  status: string;
}

export async function sendEnvelope(input: SendEnvelopeInput): Promise<SendEnvelopeResult> {
  const clerkOrgId = await getCurrentOrganizationId();
  const clerkUser = await getCurrentUser();
  if (!clerkUser) throw new Error('Not authenticated');

  const db = getDb();

  // Resolve internal org + user ids from Clerk IDs
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) throw new Error('Organization not found');

  const user = await db.query.users.findFirst({
    where: eq(users.clerkUserId, clerkUser.id),
  });
  if (!user) throw new Error('User not synced yet');

  // Fetch the document under RLS
  const docRows = await withRls(org.id, async (tx) =>
    tx.select().from(documents).where(eq(documents.id, input.documentId)).limit(1),
  );
  const doc = docRows[0];
  if (!doc) throw new Error(`Document ${input.documentId} not found`);

  // Hard rule #2: enforce attorney-review gate server-side
  if (doc.attorneyReviewRequired) {
    const approvals = await withRls(org.id, async (tx) =>
      tx
        .select({ id: attorneyApprovals.id })
        .from(attorneyApprovals)
        .where(
          and(
            eq(attorneyApprovals.documentId, doc.id),
            eq(attorneyApprovals.documentVersion, doc.version),
          ),
        )
        .limit(1),
    );
    if (approvals.length === 0) {
      throw new AttorneyReviewMissingError(doc.id);
    }
  }

  // Resolve the active DocuSign connection for this org
  const [conn] = await db
    .select()
    .from(orgDocusignConnections)
    .where(
      and(
        eq(orgDocusignConnections.organizationId, org.id),
        eq(orgDocusignConnections.connectionStatus, 'active'),
      ),
    )
    .orderBy(desc(orgDocusignConnections.createdAt))
    .limit(1);

  if (!conn) throw new DocusignConnectionMissingError(org.id);

  // Download the document bytes from Vercel Blob.
  // blobGet is not exported from @cema/blob — only signedDownloadUrl is available.
  // We obtain a server-signed download URL and fetch the bytes over HTTPS.
  if (!doc.blobUrl) throw new Error(`Document ${doc.id} has no blob_url`);
  const downloadUrl = await signedDownloadUrl(doc.blobUrl);
  const res = await fetch(downloadUrl);
  if (!res.ok) {
    throw new Error(`Failed to download document blob: ${res.status} ${res.statusText}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  const bytes = Buffer.from(arrayBuffer);

  const fileName = `document-${doc.id}.pdf`;

  // Authenticate with DocuSign via JWT grant and create the envelope
  const apiClient = await getDocusignClient({
    baseUrl: conn.docusignBaseUrl,
    integrationKey: conn.integrationKey,
    userId: conn.docusignUserId ?? '',
    rsaPrivateKey: conn.rsaPrivateKey,
  });
  const created = await createEnvelope(apiClient, conn.docusignAccountId, {
    subject: input.subject,
    documentName: fileName,
    documentBytes: bytes,
    documentFileExtension: 'pdf',
    recipients: input.recipients,
    status: 'sent',
  });

  // Persist the envelope row to the local DB
  const [row] = await db
    .insert(docusignEnvelopes)
    .values({
      organizationId: org.id,
      docusignConnectionId: conn.id,
      documentId: doc.id,
      docusignEnvelopeId: created.envelopeId,
      status: 'sent',
      subject: input.subject,
      recipients: input.recipients.map((r, idx) => ({
        email: r.email,
        name: r.name,
        role: r.role,
        routingOrder: idx + 1,
        status: 'sent',
        signedAt: null,
      })),
      sentAt: new Date(),
      createdById: user.id,
    })
    .returning();

  if (!row) throw new Error('Failed to insert docusign_envelopes row');

  await emitAuditEvent(db, {
    organizationId: org.id,
    actorUserId: user.id,
    action: 'envelope.created',
    entityType: 'docusign_envelope',
    entityId: row.id,
    metadata: {
      envelopeId: created.envelopeId,
      documentId: doc.id,
      recipientCount: input.recipients.length,
    },
  });

  return {
    envelopeRowId: row.id,
    docusignEnvelopeId: created.envelopeId,
    status: created.status,
  };
}
