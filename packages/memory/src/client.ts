import { MemoryClient } from 'mem0ai';

let _client: MemoryClient | null = null;

export function isMemoryConfigured(): boolean {
  return !!process.env.MEM0_API_KEY;
}

export function getMemoryClient(): MemoryClient {
  const apiKey = process.env.MEM0_API_KEY;
  if (!apiKey) throw new Error('MEM0_API_KEY is not set');

  if (!_client) {
    _client = new MemoryClient({ apiKey });
  }

  return _client;
}
