// Stub — full implementation ships in Task 2.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function makeWebhookLimiter(_identifier: string): undefined {
  return undefined;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function checkRateLimit(_limiter: unknown): Promise<{ success: boolean }> {
  return Promise.resolve({ success: true });
}
