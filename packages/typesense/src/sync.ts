import { getTypesenseClient, isTypesenseConfigured } from './client';
import { COMMUNICATIONS_COLLECTION, DOCUMENTS_COLLECTION } from './collections';

export interface CommunicationDocument {
  id: string;
  organization_id: string;
  subject?: string;
  body_preview?: string;
  direction?: string;
  kind: string;
  vendor?: string;
  occurred_at: number;
}

export interface DocumentDocument {
  id: string;
  organization_id: string;
  kind: string;
  status: string;
  filename?: string;
  created_at: number;
}

export async function indexCommunication(doc: CommunicationDocument): Promise<void> {
  if (!isTypesenseConfigured()) return;
  const client = getTypesenseClient();
  await client.collections(COMMUNICATIONS_COLLECTION).documents().upsert(doc);
}

export async function indexDocument(doc: DocumentDocument): Promise<void> {
  if (!isTypesenseConfigured()) return;
  const client = getTypesenseClient();
  await client.collections(DOCUMENTS_COLLECTION).documents().upsert(doc);
}

export async function deleteFromIndex(
  collection: 'communication' | 'document',
  id: string,
): Promise<void> {
  if (!isTypesenseConfigured()) return;
  const client = getTypesenseClient();
  const collectionName =
    collection === 'communication' ? COMMUNICATIONS_COLLECTION : DOCUMENTS_COLLECTION;
  await client.collections(collectionName).documents(id).delete();
}
