import { getCurrentOrganizationId } from '@cema/auth';
import { signedDownloadUrl } from '@cema/blob';
import { communications, getDb, organizations, recordings } from '@cema/db';
import type { NormalizedTranscript } from '@cema/integrations-deepgram';
import { and, eq } from 'drizzle-orm';

import { withReadAudit } from '../audit/with-read-audit';
import { withRls } from '../with-rls';

type Communication = typeof communications.$inferSelect;
type Recording = typeof recordings.$inferSelect;

export type CommunicationDetail = {
  communication: Communication;
  recording: Recording | null;
  signedAudioUrl: string | null;
  transcript: NormalizedTranscript | null;
};

export async function getCommunication(
  dealId: string,
  communicationId: string,
): Promise<CommunicationDetail | null> {
  return withReadAudit(
    { entityType: 'communication', entityId: communicationId, purpose: 'view_detail' },
    async () => {
      const clerkOrgId = await getCurrentOrganizationId();
      const db = getDb();

      const org = await db.query.organizations.findFirst({
        where: eq(organizations.clerkOrgId, clerkOrgId),
      });
      if (!org) return null;

      return withRls(org.id, async (tx) => {
        const [comm] = await tx
          .select()
          .from(communications)
          .where(
            and(
              eq(communications.id, communicationId),
              eq(communications.dealId, dealId),
              eq(communications.organizationId, org.id),
            ),
          )
          .limit(1);

        if (!comm) return null;

        const [recording] = await tx
          .select()
          .from(recordings)
          .where(eq(recordings.communicationId, communicationId))
          .limit(1);

        const rec = recording ?? null;

        const audioUrl = rec?.recordingBlobUrl
          ? await signedDownloadUrl(rec.recordingBlobUrl, 3600)
          : null;

        let transcript: NormalizedTranscript | null = null;
        if (rec?.transcriptBlobUrl) {
          try {
            const res = await fetch(rec.transcriptBlobUrl);
            if (res.ok) {
              transcript = (await res.json()) as NormalizedTranscript;
            }
          } catch {
            // transcript fetch failure is non-fatal — render without it
          }
        }

        return {
          communication: comm,
          recording: rec,
          signedAudioUrl: audioUrl,
          transcript,
        };
      });
    },
  );
}
