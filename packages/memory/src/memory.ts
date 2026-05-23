import { getMemoryClient, isMemoryConfigured } from './client';

export interface MemorySearchResult {
  id: string;
  memory: string;
  score: number;
}

export async function addMemory(dealId: string, content: string, sessionId: string): Promise<void> {
  if (!isMemoryConfigured()) return;
  const client = getMemoryClient();
  await client.add([{ role: 'user', content }], { user_id: dealId, run_id: sessionId });
}

export async function searchMemory(dealId: string, query: string): Promise<MemorySearchResult[]> {
  if (!isMemoryConfigured()) return [];
  const client = getMemoryClient();
  const results = await client.search(query, { user_id: dealId });
  return (results as Array<{ id: string; memory: string; score: number }>).map((r) => ({
    id: r.id,
    memory: r.memory,
    score: r.score,
  }));
}

export async function clearSessionMemory(dealId: string, sessionId: string): Promise<void> {
  if (!isMemoryConfigured()) return;
  const client = getMemoryClient();
  await client.deleteAll({ user_id: dealId, run_id: sessionId });
}
