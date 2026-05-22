import { type TopicName, type TopicPayload, TopicSchema } from './topics';

type Sender<T extends TopicName> = (topic: T, payload: TopicPayload<T>) => Promise<void>;

export async function publish<T extends TopicName>(
  topic: T,
  rawPayload: unknown,
  sender: Sender<T>,
): Promise<void> {
  const validated = TopicSchema[topic].parse(rawPayload) as TopicPayload<T>;
  await sender(topic, validated);
}
