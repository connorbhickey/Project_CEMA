import { getRedis, isUpstashConfigured } from './client';

/** Default idempotency-key TTL: 24h — long enough to outlast any vendor's webhook
 *  retry window, short enough that keys don't accumulate indefinitely. */
export const DEFAULT_IDEMPOTENCY_TTL_SECONDS = 86_400;

/**
 * Best-effort webhook idempotency via Redis SETNX (`SET key '1' NX EX ttl`).
 *
 * Returns `true` when this is the FIRST time `key` has been seen (the caller
 * should PROCEED) and `false` when it already exists (a duplicate or replayed
 * delivery — the caller should SKIP and return its normal success response
 * WITHOUT re-running side effects).
 *
 * Fail-OPEN: when Upstash is unconfigured or errors, returns `true` so processing
 * continues. DB-level constraints (`onConflictDoUpdate`, unique indexes) are the
 * fallback dedup, and dropping an event is worse than processing it twice.
 *
 * Pair with {@link releaseIdempotencyKey} on any NON-terminal failure path so the
 * vendor's retry can re-acquire the key instead of waiting out the full TTL —
 * otherwise a crash after acquiring would silently drop the retried delivery.
 */
export async function acquireIdempotencyKey(
  key: string,
  ttlSeconds: number = DEFAULT_IDEMPOTENCY_TTL_SECONDS,
): Promise<boolean> {
  if (!isUpstashConfigured()) return true;
  try {
    const redis = getRedis();
    // SET NX returns 'OK' on a fresh set and null when the key already exists.
    const acquired = await redis.set(key, '1', { nx: true, ex: ttlSeconds });
    return acquired !== null;
  } catch {
    return true; // fail-open — DB constraints are the fallback dedup
  }
}

/**
 * Release a previously-acquired idempotency key (best-effort, fail-quiet) so a
 * vendor retry can re-acquire it. No-op when Upstash is unconfigured. Call this
 * on a non-terminal failure after a successful {@link acquireIdempotencyKey}.
 */
export async function releaseIdempotencyKey(key: string): Promise<void> {
  if (!isUpstashConfigured()) return;
  try {
    await getRedis().del(key);
  } catch {
    // Upstash unavailable — the TTL expires the key naturally.
  }
}
