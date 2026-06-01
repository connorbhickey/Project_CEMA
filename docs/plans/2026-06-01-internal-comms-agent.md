# Internal Comms Agent (v1) — Design Spec

> **Status:** Approved (Connor, 2026-06-01) — implementation pending.
> **Milestone:** Phase 1 (the 6th of 7 Layer-3 agents — spec §9.10). Push/transition model.
> **Authoritative spec:** `docs/superpowers/specs/2026-05-12-cema-ai-processor-design.md` §9.10.

---

## 1. Goal & scope

When a deal's lifecycle status enters a noteworthy state, post a PII-safe notification to the
org's internal pipeline channel so a human knows to act. The Servicer-Outreach shape (channel
adapter + deterministic templates + dormant send), but **internal recipients, fired by deal-status
transitions** instead of a cadence.

**In scope:**

- A pure deterministic core (`notificationForStatus`) in a new `@cema/agents-internal-comms`
  package (no `@cema/db`, no clock, no LLM).
- A dormant `FixtureChannelAdapter` behind an `InternalChannelAdapter` seam (the one-line swap point
  for a real Slack adapter later).
- An app-layer best-effort dispatcher (`notifyInternal`) wired as a **second post-commit fan-out**
  in `transitionDealStatus`, alongside the existing agent dispatcher (`onDealStatusChanged`).
- A PII-safe OTel span + audit-log write per notification (agent tooling parity, CLAUDE.md §8).

**Out of scope (deferred — noted as carry-overs):**

- A real `SlackChannelAdapter` over the existing `org_slack_connections` (gated on Slack OAuth +
  a configured channel — like Outreach's Resend adapter, hard rule #12 reuses the existing Slack
  integration, so **no** new `packages/integrations/*` and **no** spec §16 row).
- Haiku message polish (the spec's LLM step) — dormant, with the static template as the floor,
  mirroring Outreach's `draftOutreachEmail`.
- Per-user / Slack-DM routing + deal-team membership (no user→Slack mapping exists yet).
- Read/reply tracking (spec step 4) — needs inbound Slack webhooks + persisted message ids.
- Teams / email / calendar channels (Teams would need a new `packages/integrations/teams` +
  a spec §16 row).
- Notifications on routine pipeline progress (intake/eligibility/title_work/doc_prep/closing/
  recording) and terminal milestones (completed/cancelled) — would be noise in v1.
- A Braintrust eval — the PII-safety unit test is the v1 compliance gate, matching the no-LLM
  agents (IDP, Chain-of-Title, Exception Triage).

## 2. Why push (transitions), why the org channel

The spec's open-ended triggers ("exceptions, ready-for-review, awaiting-input") all map onto
_entered_ deal states, and the `deal_status` lifecycle is the **live event hub** —
`transitionDealStatus` already commits the status, emits `deal.status_changed`, and fans out
post-commit via `onDealStatusChanged`. So the notify decision keys on the **destination status
alone** (`to`), exactly like the existing `triggerForStatus(status)`, and needs **zero** change to
the dispatch signature (the call site already passes `result.to`).

The destination is the org's single internal pipeline channel (v1). Per-user DM routing (the spec's
"identify which human(s)" + "Slack DM") needs a user→Slack-user mapping and deal-team membership
that aren't modeled yet — a clean follow-up, not a v1 blocker.

## 3. Pure core — `@cema/agents-internal-comms` (new 26th package)

Mirrors the thin sibling packages: no `@cema/db`, takes a plain `status: string` (the
Exception-Triage decoupling), so it stays node-testable.

```ts
// types.ts
export const NOTIFY_STATUSES = [
  'authorization', // awaiting-input (borrower authorization)
  'collateral_chase', // awaiting-input (prior servicer's collateral file)
  'attorney_review', // ready-for-review
  'exception', // exception
] as const;
export type NotifyStatus = (typeof NOTIFY_STATUSES)[number];

// v1 has a single internal destination. A union (not a bare string) so a real
// adapter can exhaustively map each token to a Slack channel id later, and so
// status->channel routing is a trivial future extension.
export const INTERNAL_CHANNELS = ['pipeline'] as const;
export type InternalChannel = (typeof INTERNAL_CHANNELS)[number];

// Pure-core output. `message` is a static PII-free template (no ids, counts,
// party names, or amounts) — safe to post/persist.
export interface InternalNotification {
  readonly status: NotifyStatus;
  readonly channel: InternalChannel;
  readonly message: string;
}

// What the adapter sends. Carries the opaque dealId (NOT PII) so a real Slack
// adapter can render a deep link; the Fixture just records it.
export interface InternalCommPacket {
  readonly dealId: string;
  readonly status: NotifyStatus;
  readonly channel: InternalChannel;
  readonly message: string;
}

export interface ChannelSendResult {
  readonly accepted: boolean;
  readonly channelMessageId?: string;
}

export interface InternalChannelAdapter {
  send(packet: InternalCommPacket): Promise<ChannelSendResult>;
}
```

```ts
// notify.ts
const MESSAGE_BY_STATUS: Record<NotifyStatus, string> = {
  attorney_review: 'A deal has entered attorney review and is ready for an attorney to act.',
  collateral_chase: 'A deal is awaiting the collateral file from the prior servicer.',
  authorization: 'A deal is awaiting borrower authorization to proceed.',
  exception: 'A deal has been flagged as an exception and needs attention.',
};

// Exhaustiveness guard: if NOTIFY_STATUSES gains a member the map does not
// cover, throw at module load rather than emit an undefined message (mirrors
// ROUTE_BY_BREAK in @cema/agents-chain-of-title and the Exception-Triage maps).
for (const status of NOTIFY_STATUSES) {
  if (!(status in MESSAGE_BY_STATUS)) {
    throw new Error(`internal-comms message map is missing an entry for "${status}"`);
  }
}

/**
 * Pure, deterministic notify decision (spec §9.10). Given a freshly-entered
 * deal_status, returns the internal notification to post, or null for the
 * routine/terminal statuses that do not warrant one. No clock, no LLM, no IO.
 * PII-safe by construction (enum tokens + static reasons only).
 */
export function notificationForStatus(status: string): InternalNotification | null {
  if (!(NOTIFY_STATUSES as readonly string[]).includes(status)) return null;
  const s = status as NotifyStatus;
  return { status: s, channel: 'pipeline', message: MESSAGE_BY_STATUS[s] };
}
```

```ts
// channel.ts — dormant default + test double (byte-for-byte the Outreach pattern)
export class FixtureChannelAdapter implements InternalChannelAdapter {
  public readonly sent: InternalCommPacket[] = [];

  async send(packet: InternalCommPacket): Promise<ChannelSendResult> {
    this.sent.push(packet);
    return { accepted: true, channelMessageId: `fixture:${packet.dealId}:${packet.status}` };
  }
}
```

### The notify map (the substance)

| `deal_status` →                                                                     | Notify?     | Message (static, PII-free)                                                |
| ----------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------- |
| `attorney_review`                                                                   | ✅          | "A deal has entered attorney review and is ready for an attorney to act." |
| `collateral_chase`                                                                  | ✅          | "A deal is awaiting the collateral file from the prior servicer."         |
| `authorization`                                                                     | ✅          | "A deal is awaiting borrower authorization to proceed."                   |
| `exception`                                                                         | ✅          | "A deal has been flagged as an exception and needs attention."            |
| intake, eligibility, title_work, doc_prep, closing, recording, completed, cancelled | ❌ → `null` | (routine/terminal — deferred)                                             |

## 4. App dispatcher — `apps/web/lib/agents/internal-comms/`

- `channel.ts` — instantiates the `FixtureChannelAdapter` (the one-line swap point for a real
  `SlackChannelAdapter`).
- `notify-internal.ts` — `notifyInternal(dealId, status, ctx)`:
  1. `const notification = notificationForStatus(status)`; if `null`, **return immediately** (the 8
     routine/terminal statuses — no span, no send, no audit).
  2. Open an OTel span `internal_comm.notify` with PII-safe attributes only
     (`comm.deal_id`, `comm.status`, `comm.channel`, `comm.accepted`).
  3. Build the `InternalCommPacket` and `await adapter.send(packet)`.
  4. Emit a PII-safe audit `internal_comm.notified` inside `withRls(ctx.organizationId, ...)` —
     `metadata { status, channel }` (enum/token only).
  5. **Best-effort**: wrap in try/catch. On failure, set span `ERROR`, and log with the **inline**
     `redactPii(\`...\`).replace(/[\r\n]/g, ' ')`+`ERROR_IDS`pattern (the exact form CodeQL
recognizes as a`js/log-injection` sanitizer — must stay inline at the sink). A failed
     notification must **never** roll back or surface on the committed status write. Never rethrows.

`ctx` reuses the `DealStatusDispatchContext { organizationId, actorUserId }` shape already threaded
through `onDealStatusChanged`.

## 5. Wiring — `apps/web/lib/actions/transition-deal-status.ts` (1 line)

After the existing post-commit agent dispatch, add a **second** independent fan-out:

```ts
if (result.changed) {
  revalidatePath('/deals');
  await onDealStatusChanged(dealId, result.to, { organizationId: org.id, actorUserId: user.id });
  await notifyInternal(dealId, result.to, { organizationId: org.id, actorUserId: user.id });
}
```

`onDealStatusChanged` swallows its own errors (returns void, never throws), so `notifyInternal`
always runs after it; `notifyInternal` is itself best-effort. Order is not load-bearing (the two are
independent).

**Idempotency:** `transitionDealStatus` only fans out on a real change (`result.changed`), so a
status transition notifies exactly once. Re-entering a status later (e.g. `attorney_review →
exception → attorney_review`) re-notifies — which is correct (it re-entered). No idempotency key is
needed (unlike Outreach's cadence touches).

## 6. Compliance / PII (hard rule #3)

- Messages are static templates — no party names, amounts, or ids. A unit test asserts every
  template is digit-free / PII-free (the v1 compliance gate).
- The deal UUID rides in the packet (for a future deep link) but is **not** PII.
- Audit metadata is enum/token-only (`{ status, channel }`).
- The best-effort log path uses the inline `redactPii` + quantifier-free `/[\r\n]/g` sanitizer at
  the sink.

## 7. Drift guard

An app-layer test asserts `NOTIFY_STATUSES ⊆ dealStatusEnum.enumValues` — ties the package's
decoupled string literals to the real `deal_status` enum without coupling the package to `@cema/db`
(the Exception-Triage decoupling, with a safety net against enum drift).

## 8. Testing

- **Package** (`@cema/agents-internal-comms`):
  - `notify.test.ts` — each notify-worthy status returns its message; each routine/terminal status
    returns `null`; **PII-safety**: no message contains a digit or a forbidden PII token.
  - `channel.test.ts` — `FixtureChannelAdapter` records the packet and reports `accepted`.
- **App** (`apps/web`):
  - `notify-internal.test.ts` — a notify-worthy status calls `adapter.send` once + emits the audit;
    a routine status does neither; an adapter throw is swallowed (never rethrows). Mock the audit +
    adapter (mirrors the `on-deal-status-changed` dispatcher test).
  - `internal-comms-statuses.test.ts` (drift guard) — `NOTIFY_STATUSES ⊆ dealStatusEnum.enumValues`.

Target: +~12 tests. **0 migrations.** Package count 25 → **26**.

## 9. File structure

```
packages/agents/internal-comms/
  package.json            # @cema/agents-internal-comms, devDeps only (no runtime deps)
  tsconfig.json           # extends @cema/config/tsconfig/node.json
  src/
    types.ts
    notify.ts
    channel.ts
    index.ts
    notify.test.ts
    channel.test.ts
apps/web/lib/agents/internal-comms/
  channel.ts              # FixtureChannelAdapter instance (swap point)
  notify-internal.ts      # notifyInternal dispatcher (span + send + audit, best-effort)
  notify-internal.test.ts
apps/web/lib/agents/
  internal-comms-statuses.test.ts   # drift guard
apps/web/lib/actions/transition-deal-status.ts  # +1 line wiring
apps/web/package.json     # + @cema/agents-internal-comms dep
```
