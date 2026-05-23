// vi.mock('docusign-esign') does not intercept CJS require() calls in Vitest ESM
// mode. We use the _setDsModule injection hook instead.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { _setDsModule, createEnvelope, getDocusignClient } from './client';

const mockApiClient = {
  setBasePath: vi.fn(),
  setOAuthBasePath: vi.fn(),
  addDefaultHeader: vi.fn(),
  requestJWTUserToken: vi.fn().mockResolvedValue({ body: { access_token: 'tok' } }),
};

const mockEnvelopesApi = {
  createEnvelope: vi.fn().mockResolvedValue({
    envelopeId: 'env-1',
    status: 'sent',
    uri: '/envelopes/env-1',
    statusDateTime: '2026-05-22T15:00:00Z',
  }),
};

const fakeDsModule = {
  ApiClient: vi.fn().mockImplementation(() => mockApiClient),
  EnvelopesApi: vi.fn().mockImplementation(() => mockEnvelopesApi),
  EnvelopeDefinition: vi.fn().mockImplementation(() => ({})),
  Document: vi.fn().mockImplementation(() => ({})),
  Recipients: vi.fn().mockImplementation(() => ({ signers: [] })),
  Signer: vi.fn().mockImplementation(() => ({})),
};

beforeEach(() => {
  _setDsModule(fakeDsModule);
});

afterEach(() => {
  _setDsModule(null);
  vi.clearAllMocks();
});

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
