import { createHash } from 'node:crypto';

import type { RouteDecision } from '@cema/agents-chain-of-title';

/**
 * Stable, PII-safe identifier for one routed chain break -- the `<hash>` in the
 * idempotency key `chain:<dealId>:break:<hash>` documented on ChainDeps. Derived
 * solely from RouteDecision fields (dealId, kind, documentId, and the static
 * PII-free `reason` template that route() emits), so it is deterministic across
 * durable replays and carries no party names. Two routing decisions that are
 * indistinguishable on these fields intentionally collide -- that collision IS
 * the desired idempotency (the same break re-routed is the same hand-off).
 *
 * Split out of the `'use server'` deps module so it unit-tests under the node
 * vitest env with no Server-Action / RLS mocking (mirrors `reviewActionMode`).
 * 8 hex chars (32 bits) comfortably disambiguates the handful of breaks a single
 * deal can carry while keeping the audit metadata compact.
 */
export function breakHash(decision: RouteDecision): string {
  const material = `${decision.dealId}|${decision.kind}|${decision.documentId ?? ''}|${decision.reason}`;
  return createHash('sha256').update(material).digest('hex').slice(0, 8);
}
