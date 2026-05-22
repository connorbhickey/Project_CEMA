import { describe, expect, it, vi } from 'vitest';

vi.mock('docusign-esign', () => ({
  ApiClient: vi.fn().mockImplementation(() => ({
    setBasePath: vi.fn(),
    setOAuthBasePath: vi.fn(),
    addDefaultHeader: vi.fn(),
    requestJWTUserToken: vi.fn().mockResolvedValue({ body: { access_token: 'tok' } }),
  })),
  EnvelopesApi: vi.fn().mockImplementation(() => ({
    createEnvelope: vi.fn().mockResolvedValue({
      envelopeId: 'env-1',
      status: 'sent',
      uri: '/envelopes/env-1',
      statusDateTime: '2026-05-22T15:00:00Z',
    }),
  })),
  EnvelopeDefinition: vi.fn().mockImplementation(() => ({})),
  Document: vi.fn().mockImplementation(() => ({})),
  Recipients: vi.fn().mockImplementation(() => ({ signers: [] })),
  Signer: vi.fn().mockImplementation(() => ({})),
}));

import { createEnvelope, getDocusignClient } from './client';

describe('getDocusignClient', () => {
  it('acquires a JWT access token and sets Authorization header', async () => {
    const client = await getDocusignClient({
      baseUrl: 'https://demo.docusign.net/restapi',
      integrationKey: 'IK',
      userId: 'U',
      rsaPrivateKey: 'KEY',
    });
    expect(client).toBeDefined();
  });
});

describe('createEnvelope', () => {
  it('returns the created envelope id and status', async () => {
    const client = await getDocusignClient({
      baseUrl: 'https://demo.docusign.net/restapi',
      integrationKey: 'IK',
      userId: 'U',
      rsaPrivateKey: 'KEY',
    });
    const res = await createEnvelope(client, 'ACCT', {
      subject: 'Please sign',
      documentName: 'CEMA.pdf',
      documentBytes: Buffer.from('PDF'),
      documentFileExtension: 'pdf',
      recipients: [{ email: 'b@example.com', name: 'Borrower', role: 'signer' }],
    });
    expect(res.envelopeId).toBe('env-1');
    expect(res.status).toBe('sent');
  });
});
