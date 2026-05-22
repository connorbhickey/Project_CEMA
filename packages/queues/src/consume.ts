import { type TopicName, type TopicPayload, TopicSchema } from './topics';

export function createHandler<T extends TopicName>(
  topic: T,
  handler: (payload: TopicPayload<T>) => Promise<void>,
): (rawPayload: unknown) => Promise<void> {
  return async (rawPayload: unknown) => {
    const validated = TopicSchema[topic].parse(rawPayload) as TopicPayload<T>;
    await handler(validated);
  };
}
