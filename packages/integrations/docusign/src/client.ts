// docusign-esign ships as CommonJS with an AMD define() fallback that Turbopack
// cannot statically parse. We use a lazy require() inside the functions that
// need it so the module is only resolved at runtime by Node.js, never traced by
// the bundler. The @ts-expect-error below suppresses the missing-declarations
// error; our local DocusignModule interface provides the type contract.

import type { CreateEnvelopeInput, CreateEnvelopeResult } from './types';

function getDsModule(): DocusignModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('docusign-esign') as DocusignModule;
}

interface DocusignApiClientInstance {
  setBasePath(path: string): void;
  setOAuthBasePath(host: string): void;
  addDefaultHeader(name: string, value: string): void;
  requestJWTUserToken(
    integrationKey: string,
    userId: string,
    scopes: string[],
    privateKey: Buffer,
    expiresIn: number,
  ): Promise<{ body: { access_token: string } }>;
}

interface DocusignEnvelopesApiInstance {
  createEnvelope(
    accountId: string,
    options: { envelopeDefinition: DocusignEnvelopeDefinitionInstance },
  ): Promise<{
    envelopeId?: string;
    status?: string;
    uri?: string;
    statusDateTime?: string;
  }>;
}

interface DocusignEnvelopeDefinitionInstance {
  emailSubject?: string;
  emailBlurb?: string;
  documents?: DocusignDocumentInstance[];
  recipients?: DocusignRecipientsInstance;
  status?: string;
}

interface DocusignDocumentInstance {
  documentBase64?: string;
  name?: string;
  fileExtension?: string;
  documentId?: string;
}

interface DocusignRecipientsInstance {
  signers?: DocusignSignerInstance[];
}

interface DocusignSignerInstance {
  email?: string;
  name?: string;
  recipientId?: string;
  routingOrder?: string;
  roleName?: string;
}

interface DocusignModule {
  ApiClient: new () => DocusignApiClientInstance;
  EnvelopesApi: new (client: DocusignApiClientInstance) => DocusignEnvelopesApiInstance;
  EnvelopeDefinition: new () => DocusignEnvelopeDefinitionInstance;
  Document: new () => DocusignDocumentInstance;
  Recipients: new () => DocusignRecipientsInstance;
  Signer: new () => DocusignSignerInstance;
}

export interface GetDocusignClientInput {
  baseUrl: string;
  integrationKey: string;
  userId: string;
  rsaPrivateKey: string;
}

export async function getDocusignClient(
  input: GetDocusignClientInput,
): Promise<DocusignApiClientInstance> {
  const ds = getDsModule();
  const apiClient = new ds.ApiClient();
  apiClient.setBasePath(input.baseUrl);

  const oauthHost = input.baseUrl.includes('demo')
    ? 'account-d.docusign.com'
    : 'account.docusign.com';
  apiClient.setOAuthBasePath(oauthHost);

  const result = await apiClient.requestJWTUserToken(
    input.integrationKey,
    input.userId,
    ['signature', 'impersonation'],
    Buffer.from(input.rsaPrivateKey),
    3600,
  );

  apiClient.addDefaultHeader('Authorization', `Bearer ${result.body.access_token}`);
  return apiClient;
}

export async function createEnvelope(
  apiClient: DocusignApiClientInstance,
  accountId: string,
  input: CreateEnvelopeInput,
): Promise<CreateEnvelopeResult> {
  const ds = getDsModule();
  const envelopesApi = new ds.EnvelopesApi(apiClient);

  const envDef = new ds.EnvelopeDefinition();
  envDef.emailSubject = input.subject;
  if (input.emailBlurb) envDef.emailBlurb = input.emailBlurb;

  const doc = new ds.Document();
  doc.documentBase64 = input.documentBytes.toString('base64');
  doc.name = input.documentName;
  doc.fileExtension = input.documentFileExtension;
  doc.documentId = '1';
  envDef.documents = [doc];

  envDef.recipients = new ds.Recipients();
  envDef.recipients.signers = input.recipients.map((r, idx) => {
    const s = new ds.Signer();
    s.email = r.email;
    s.name = r.name;
    s.recipientId = String(idx + 1);
    s.routingOrder = String(r.routingOrder ?? idx + 1);
    s.roleName = r.role;
    return s;
  });

  envDef.status = input.status ?? 'sent';

  const res = await envelopesApi.createEnvelope(accountId, {
    envelopeDefinition: envDef,
  });

  return {
    envelopeId: res.envelopeId ?? '',
    status: res.status ?? '',
    uri: res.uri ?? '',
    statusDateTime: res.statusDateTime ?? '',
  };
}
