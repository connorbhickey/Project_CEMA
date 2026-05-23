import { Client } from 'typesense';

let _client: Client | null = null;

export function isTypesenseConfigured(): boolean {
  return !!process.env.TYPESENSE_API_KEY;
}

export function getTypesenseClient(): Client {
  const apiKey = process.env.TYPESENSE_API_KEY;
  if (!apiKey) throw new Error('TYPESENSE_API_KEY is not set');

  if (!_client) {
    _client = new Client({
      nodes: [
        {
          host: process.env.TYPESENSE_HOST ?? 'localhost',
          port: parseInt(process.env.TYPESENSE_PORT ?? '8108', 10),
          protocol: process.env.TYPESENSE_PROTOCOL ?? 'https',
        },
      ],
      apiKey,
      connectionTimeoutSeconds: 5,
    });
  }

  return _client;
}
