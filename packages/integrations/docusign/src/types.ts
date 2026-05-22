export interface DocusignRecipientInput {
  email: string;
  name: string;
  role: string;
  routingOrder?: number;
}

export interface CreateEnvelopeInput {
  subject: string;
  emailBlurb?: string;
  documentName: string;
  documentBytes: Buffer;
  documentFileExtension: string;
  recipients: DocusignRecipientInput[];
  status?: 'created' | 'sent';
}

export interface CreateEnvelopeResult {
  envelopeId: string;
  status: string;
  uri: string;
  statusDateTime: string;
}

/* eslint-disable @typescript-eslint/no-redundant-type-constituents */
export type DocusignEnvelopeEvent =
  | 'envelope-sent'
  | 'envelope-delivered'
  | 'recipient-completed'
  | 'envelope-completed'
  | 'envelope-declined'
  | 'envelope-voided'
  | string;
/* eslint-enable @typescript-eslint/no-redundant-type-constituents */

export interface NormalizedConnectPayload {
  event: DocusignEnvelopeEvent;
  envelopeId: string;
  status: string;
  statusChangedDateTime: string;
  subject: string;
  recipients: Array<{
    email: string;
    name: string;
    routingOrder: number;
    status: string;
    signedDateTime: string | null;
  }>;
  voidedReason: string | null;
  raw: Record<string, unknown>;
}
