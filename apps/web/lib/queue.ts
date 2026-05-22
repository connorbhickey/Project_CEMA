import type { TopicName, TopicPayload } from '@cema/queues';

// Vercel Queues sender — wired to the real SDK in Task 21.
// The webhook routes import this so tests can vi.mock it.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function vercelQueueSend<T extends TopicName>(
  _topic: T,
  _payload: TopicPayload<T>,
): Promise<void> {
  // TODO(Task 21): replace with real @vercel/queue SDK call
}
