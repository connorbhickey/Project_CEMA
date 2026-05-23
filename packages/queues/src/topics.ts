import { z } from 'zod';

export const TopicSchema = {
  'telephony.call.ingest': z.object({
    orgId: z.string(),
    provider: z.enum(['ringcentral', 'dialpad', 'zoom_phone', 'twilio']),
    vendorCallId: z.string(),
    vendorEventId: z.string(),
    vendorPayload: z.record(z.unknown()),
    receivedAt: z.string().datetime(),
  }),
  'comms.email.ingest': z.object({
    orgId: z.string(),
    communicationId: z.string(),
    nylasGrantId: z.string(),
    nylasThreadId: z.string(),
    receivedAt: z.string().datetime(),
  }),
  'comms.slack.ingest': z.object({
    orgId: z.string(),
    communicationId: z.string(),
    slackTeamId: z.string(),
    slackChannelId: z.string(),
    slackMessageTs: z.string(),
    receivedAt: z.string().datetime(),
  }),
  'files.drive.ingest': z.object({
    orgId: z.string(),
    driveFileId: z.string(),
    driveConnectionId: z.string(),
    receivedAt: z.string().datetime(),
  }),
  'esign.docusign.events': z.object({
    orgId: z.string(),
    envelopeId: z.string(),
    event: z.string(),
    receivedAt: z.string().datetime(),
  }),
  'comms.embed': z.object({
    orgId: z.string(),
    communicationId: z.string(),
  }),
  'docs.embed': z.object({
    orgId: z.string(),
    documentId: z.string(),
  }),
} as const;

export type TopicName = keyof typeof TopicSchema;
export type TopicPayload<T extends TopicName> = z.infer<(typeof TopicSchema)[T]>;
