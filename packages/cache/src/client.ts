import { Redis } from '@upstash/redis';

let _redis: Redis | null = null;

export function isUpstashConfigured(): boolean {
  return !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

export function getRedis(): Redis {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  if (!url) throw new Error('UPSTASH_REDIS_REST_URL is not set');
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!token) throw new Error('UPSTASH_REDIS_REST_TOKEN is not set');

  if (!_redis) {
    _redis = new Redis({ url, token });
  }
  return _redis;
}
