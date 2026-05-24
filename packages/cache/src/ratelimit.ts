import { Ratelimit } from '@upstash/ratelimit';

import { getRedis } from './client.ts';

// 30 requests per 10-second sliding window per IP — aggressive enough to block
// replay attacks and credential-stuffing without affecting legitimate Twilio
// callbacks (which fire at most once per call event).
export function makeWebhookLimiter(): Ratelimit {
  return new Ratelimit({
    redis: getRedis(),
    limiter: Ratelimit.slidingWindow(30, '10 s'),
    prefix: 'cema:rl:webhook',
  });
}

export async function checkRateLimit(
  identifier: string,
): Promise<{ success: boolean; remaining: number }> {
  const limiter = makeWebhookLimiter();
  const result = await limiter.limit(identifier);
  return { success: result.success, remaining: result.remaining };
}
