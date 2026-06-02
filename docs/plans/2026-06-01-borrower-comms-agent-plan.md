# Borrower Comms Agent (v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Email every borrower party a plain-language, PII-safe update when a deal enters a borrower-relevant state (authorization / closing / completed), via a deterministic core + dormant Resend seam, wired as a third post-commit fan-out in `transitionDealStatus`.

**Architecture:** New thin package `@cema/agents-borrower-comms` (pure `borrowerNotificationForStatus` + `FixtureChannelAdapter`). An app-layer best-effort `notifyBorrower` dispatcher that RLS-reads the deal's `borrower`/`co_borrower` parties (via a mockable `loadBorrowerParties` loader) and emails each (OTel span + split audit, PII-safe — email never logged). Email-only (TCPA-exempt); 0 migrations.

**Tech Stack:** TypeScript (strict, ESM), Vitest, Drizzle (`parties` read), `@cema/compliance` (`emitAuditEvent`/`redactPii`), `@opentelemetry/api`.

**Design spec:** `docs/plans/2026-06-01-borrower-comms-agent.md`

---

## Task 1: Scaffold the `@cema/agents-borrower-comms` package

**Files:**

- Create: `packages/agents/borrower-comms/package.json`
- Create: `packages/agents/borrower-comms/tsconfig.json`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@cema/agents-borrower-comms",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@cema/config": "workspace:*",
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "extends": "@cema/config/tsconfig/node.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "noEmit": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Install + commit**

Run: `cmd /c "pnpm install"` (links the workspace package)

```bash
git add packages/agents/borrower-comms/package.json packages/agents/borrower-comms/tsconfig.json pnpm-lock.yaml
git commit -S -m "feat(borrower-comms): scaffold @cema/agents-borrower-comms package"
```

---

## Task 2: Pure core — `types.ts` + `notify.ts` (TDD)

**Files:**

- Create: `packages/agents/borrower-comms/src/types.ts`
- Create: `packages/agents/borrower-comms/src/notify.ts`
- Test: `packages/agents/borrower-comms/src/notify.test.ts`

- [ ] **Step 1: Write the failing test** — `packages/agents/borrower-comms/src/notify.test.ts`

```ts
import { describe, expect, it } from 'vitest';

import { borrowerNotificationForStatus } from './notify';
import { BORROWER_CHANNELS, BORROWER_NOTIFY_STATUSES } from './types';

describe('borrowerNotificationForStatus', () => {
  it('returns an email notification for each borrower touchpoint status', () => {
    for (const status of BORROWER_NOTIFY_STATUSES) {
      const n = borrowerNotificationForStatus(status);
      expect(n).not.toBeNull();
      expect(n).toMatchObject({ status, channel: 'email' });
      expect(n!.subject.length).toBeGreaterThan(0);
      expect(n!.body.length).toBeGreaterThan(0);
    }
  });

  it('returns null for internal-only / non-touchpoint statuses', () => {
    for (const status of [
      'intake',
      'eligibility',
      'collateral_chase',
      'title_work',
      'doc_prep',
      'attorney_review',
      'recording',
      'exception',
      'cancelled',
    ]) {
      expect(borrowerNotificationForStatus(status)).toBeNull();
    }
  });

  it('returns null for an unknown status string', () => {
    expect(borrowerNotificationForStatus('not_a_status')).toBeNull();
  });

  it('subjects + bodies are static PII-free strings (no digits/ids/amounts)', () => {
    for (const status of BORROWER_NOTIFY_STATUSES) {
      const n = borrowerNotificationForStatus(status)!;
      expect(n.subject).not.toMatch(/\d/);
      expect(n.body).not.toMatch(/\d/);
    }
  });

  it('exposes the touchpoint + channel vocabularies', () => {
    expect([...BORROWER_NOTIFY_STATUSES].sort()).toEqual(['authorization', 'closing', 'completed']);
    expect(BORROWER_CHANNELS).toEqual(['email']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cmd /c "pnpm --filter @cema/agents-borrower-comms test"`
Expected: FAIL — `Cannot find module './notify'` / `'./types'`.

- [ ] **Step 3: Implement `types.ts`**

```ts
// Borrower Comms vocabulary (spec §9.9). Email-only v1 (TCPA-exempt). Pure: no
// @cema/db, no clock, no LLM -- the core takes a plain status string so it stays
// node-testable.

export const BORROWER_NOTIFY_STATUSES = ['authorization', 'closing', 'completed'] as const;
export type BorrowerNotifyStatus = (typeof BORROWER_NOTIFY_STATUSES)[number];

// v1 is email-only. A single-member union (not a bare string): adding 'sms' later
// is a deliberate type change that forces the consent path (hard rule #4 -- call
// tcpaGuard before any SMS send; email is TCPA-exempt).
export const BORROWER_CHANNELS = ['email'] as const;
export type BorrowerChannel = (typeof BORROWER_CHANNELS)[number];

// Pure-core output. Static PII-free email content (no name, amount, id, account).
export interface BorrowerNotification {
  readonly status: BorrowerNotifyStatus;
  readonly channel: BorrowerChannel;
  readonly subject: string;
  readonly body: string;
}

// What the channel adapter sends. `to` is the borrower's email -- required by the
// adapter, but it is PII and MUST NOT enter logs/audits/spans (hard rule #3);
// only `partyId` is logged.
export interface BorrowerCommPacket {
  readonly dealId: string;
  readonly partyId: string;
  readonly status: BorrowerNotifyStatus;
  readonly channel: BorrowerChannel;
  readonly to: string;
  readonly subject: string;
  readonly body: string;
}

export interface ChannelSendResult {
  readonly accepted: boolean;
  readonly channelMessageId?: string;
}

export interface BorrowerChannelAdapter {
  send(packet: BorrowerCommPacket): Promise<ChannelSendResult>;
}
```

- [ ] **Step 4: Implement `notify.ts`**

```ts
import {
  BORROWER_NOTIFY_STATUSES,
  type BorrowerNotification,
  type BorrowerNotifyStatus,
} from './types';

// Static, PII-free email content per borrower touchpoint (no name/amount/id).
const TEMPLATE_BY_STATUS: Record<BorrowerNotifyStatus, { subject: string; body: string }> = {
  authorization: {
    subject: 'Action needed on your CEMA',
    body: 'We need your authorization to proceed with your CEMA. Your processing team will follow up shortly with the details and next steps.',
  },
  closing: {
    subject: 'Your CEMA is scheduled to close',
    body: 'Good news — your CEMA is ready for closing. Your processing team will be in touch with the closing details and next steps.',
  },
  completed: {
    subject: 'Your CEMA is complete',
    body: 'Your CEMA has closed and been recorded. Thank you for working with us. Your processing team will send any final documentation.',
  },
};

// Exhaustiveness guard: a new BORROWER_NOTIFY_STATUSES member without a template
// throws at load (mirrors ROUTE_BY_BREAK / the Internal-Comms map).
for (const status of BORROWER_NOTIFY_STATUSES) {
  if (!(status in TEMPLATE_BY_STATUS)) {
    throw new Error(`borrower-comms template map is missing an entry for "${status}"`);
  }
}

/**
 * Pure, deterministic borrower-notify decision (spec §9.9). Returns the email
 * notification for a borrower touchpoint status, or null otherwise. No clock,
 * no LLM, no IO. PII-safe by construction (static templates, enum tokens).
 */
export function borrowerNotificationForStatus(status: string): BorrowerNotification | null {
  if (!(BORROWER_NOTIFY_STATUSES as readonly string[]).includes(status)) return null;
  const s = status as BorrowerNotifyStatus;
  const { subject, body } = TEMPLATE_BY_STATUS[s];
  return { status: s, channel: 'email', subject, body };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cmd /c "pnpm --filter @cema/agents-borrower-comms test"`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/agents/borrower-comms/src/types.ts packages/agents/borrower-comms/src/notify.ts packages/agents/borrower-comms/src/notify.test.ts
git commit -S -m "feat(borrower-comms): pure borrowerNotificationForStatus core + vocabulary"
```

---

## Task 3: `FixtureChannelAdapter` + `index.ts` (TDD)

**Files:**

- Create: `packages/agents/borrower-comms/src/channel.ts`
- Create: `packages/agents/borrower-comms/src/index.ts`
- Test: `packages/agents/borrower-comms/src/channel.test.ts`

- [ ] **Step 1: Write the failing test** — `packages/agents/borrower-comms/src/channel.test.ts`

```ts
import { describe, expect, it } from 'vitest';

import { FixtureChannelAdapter } from './channel';
import type { BorrowerCommPacket } from './types';

const PACKET: BorrowerCommPacket = {
  dealId: 'deal-1',
  partyId: 'party-1',
  status: 'closing',
  channel: 'email',
  to: 'borrower@example.com',
  subject: 'Your CEMA is scheduled to close',
  body: 'Good news — your CEMA is ready for closing.',
};

describe('FixtureChannelAdapter', () => {
  it('records the packet and reports acceptance', async () => {
    const adapter = new FixtureChannelAdapter();
    const result = await adapter.send(PACKET);

    expect(result.accepted).toBe(true);
    expect(result.channelMessageId).toBe('fixture:deal-1:party-1:closing');
    expect(adapter.sent).toEqual([PACKET]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cmd /c "pnpm --filter @cema/agents-borrower-comms test channel"`
Expected: FAIL — `Cannot find module './channel'`.

- [ ] **Step 3: Implement `channel.ts`**

```ts
import type { BorrowerChannelAdapter, BorrowerCommPacket, ChannelSendResult } from './types';

/**
 * Dormant default channel adapter. Records packets in-memory and reports
 * acceptance without sending -- the wiring default until a real ResendChannelAdapter
 * is provisioned behind RESEND_API_KEY + a verified sending domain. Also the test
 * double for the dispatcher behavioral guard.
 */
export class FixtureChannelAdapter implements BorrowerChannelAdapter {
  public readonly sent: BorrowerCommPacket[] = [];

  // Not `async` (no await) -- returns a resolved Promise to satisfy the contract
  // without tripping require-await (packages/agents/* are outside the eslint
  // type-aware project glob).
  send(packet: BorrowerCommPacket): Promise<ChannelSendResult> {
    this.sent.push(packet);
    return Promise.resolve({
      accepted: true,
      channelMessageId: `fixture:${packet.dealId}:${packet.partyId}:${packet.status}`,
    });
  }
}
```

- [ ] **Step 4: Implement `index.ts`**

```ts
export * from './types';
export * from './notify';
export * from './channel';
```

- [ ] **Step 5: Run test + typecheck**

Run: `cmd /c "pnpm --filter @cema/agents-borrower-comms test && pnpm --filter @cema/agents-borrower-comms typecheck"`
Expected: PASS (6 tests total); typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/agents/borrower-comms/src/channel.ts packages/agents/borrower-comms/src/channel.test.ts packages/agents/borrower-comms/src/index.ts
git commit -S -m "feat(borrower-comms): dormant FixtureChannelAdapter + package barrel"
```

---

## Task 4: App dispatcher — `notifyBorrower` (TDD)

**Files:**

- Modify: `apps/web/lib/constants/error-ids.ts` (add one ID)
- Modify: `apps/web/package.json` (add the workspace dep)
- Create: `apps/web/lib/agents/borrower-comms/parties.ts` (the mockable RLS loader)
- Create: `apps/web/lib/agents/borrower-comms/channel.ts` (the `sendBorrowerComm` fn)
- Create: `apps/web/lib/agents/borrower-comms/notify-borrower.ts`
- Test: `apps/web/lib/agents/borrower-comms/notify-borrower.test.ts`

- [ ] **Step 1: Add the dep to `apps/web/package.json`** — in `"dependencies"`, after `"@cema/agents-borrower-comms"`'s alphabetical neighbor (it sorts first among `@cema/agents-*`):

```json
    "@cema/agents-borrower-comms": "workspace:*",
```

Then run: `cmd /c "pnpm install"`.

- [ ] **Step 2: Add the error ID** — append to `ERROR_IDS` in `apps/web/lib/constants/error-ids.ts`, after `INTERNAL_COMM_NOTIFY_FAILED`:

```ts
  /** A post-commit borrower-comms notification (notifyBorrower) threw for a
   *  borrower party and was swallowed so the already-committed deal-status write
   *  survives. The durable trail is the split audit: a `borrower_comm.evaluated`
   *  row WITHOUT a following `borrower_comm.notified` is the queryable failure
   *  record; this token is the matching greppable console line. */
  BORROWER_COMM_NOTIFY_FAILED: 'BORROWER_COMM_NOTIFY_FAILED',
```

- [ ] **Step 3: Implement the RLS loader** — `apps/web/lib/agents/borrower-comms/parties.ts`

```ts
import { parties } from '@cema/db';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';

import { withRls } from '../../with-rls';

/** A borrower recipient: opaque id + email. Role is not carried downstream (the
 *  query already filtered to borrower/co_borrower), keeping the surface minimal. */
export interface BorrowerRecipient {
  id: string;
  email: string;
}

/**
 * RLS-read the deal's borrower + co_borrower parties that have an email. Both
 * roles are returned (co-borrowers are a distinct role and must be notified).
 */
export async function loadBorrowerParties(
  organizationId: string,
  dealId: string,
): Promise<BorrowerRecipient[]> {
  const rows = await withRls(organizationId, (tx) =>
    tx
      .select({ id: parties.id, email: parties.email })
      .from(parties)
      .where(
        and(
          eq(parties.dealId, dealId),
          inArray(parties.role, ['borrower', 'co_borrower']),
          isNotNull(parties.email),
        ),
      ),
  );
  // Drop empty-string emails the SQL NULL filter does not catch.
  return rows.filter((r): r is BorrowerRecipient => !!r.email && r.email.trim().length > 0);
}
```

- [ ] **Step 4: Implement the channel fn** — `apps/web/lib/agents/borrower-comms/channel.ts`

```ts
import {
  FixtureChannelAdapter,
  type BorrowerCommPacket,
  type ChannelSendResult,
} from '@cema/agents-borrower-comms';

// Dormant FixtureChannelAdapter today; the one-line swap point for a real
// ResendChannelAdapter once RESEND_API_KEY + a verified sending domain exist.
const adapter = new FixtureChannelAdapter();

/**
 * Send a borrower-comms packet via the wired channel. A module-level function
 * (not an exported adapter object) so the dispatcher test mocks it cleanly
 * without tripping unbound-method.
 */
export function sendBorrowerComm(packet: BorrowerCommPacket): Promise<ChannelSendResult> {
  return adapter.send(packet);
}
```

- [ ] **Step 5: Write the failing dispatcher test** — `apps/web/lib/agents/borrower-comms/notify-borrower.test.ts`

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./parties', () => ({ loadBorrowerParties: vi.fn() }));
vi.mock('./channel', () => ({ sendBorrowerComm: vi.fn() }));

vi.mock('@cema/compliance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@cema/compliance')>();
  return { ...actual, emitAuditEvent: vi.fn() };
});

vi.mock('../../with-rls', () => ({
  withRls: vi.fn((_orgId: string, cb: (tx: unknown) => unknown) => cb({})),
}));

import { emitAuditEvent } from '@cema/compliance';

import { withRls } from '../../with-rls';

import { sendBorrowerComm } from './channel';
import { notifyBorrower } from './notify-borrower';
import { loadBorrowerParties } from './parties';

const CTX = { organizationId: 'org-1', actorUserId: 'user-1' };

beforeEach(() => {
  vi.mocked(loadBorrowerParties).mockResolvedValue([{ id: 'party-1', email: 'b1@example.com' }]);
  vi.mocked(sendBorrowerComm).mockResolvedValue({ accepted: true, channelMessageId: 'fixture:x' });
  vi.mocked(emitAuditEvent).mockResolvedValue(undefined);
  vi.mocked(withRls).mockImplementation((_orgId, cb) => cb({} as never));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('notifyBorrower', () => {
  it('split-audits + emails for a borrower touchpoint status', async () => {
    await notifyBorrower('deal-1', 'closing', CTX);

    expect(sendBorrowerComm).toHaveBeenCalledTimes(1);
    const packet = vi.mocked(sendBorrowerComm).mock.calls[0]![0];
    expect(packet).toMatchObject({
      dealId: 'deal-1',
      partyId: 'party-1',
      status: 'closing',
      channel: 'email',
      to: 'b1@example.com',
    });

    // Split audit: evaluated before, notified after — per party.
    expect(emitAuditEvent).toHaveBeenCalledTimes(2);
    const [, evaluated] = vi.mocked(emitAuditEvent).mock.calls[0]!;
    expect(evaluated).toMatchObject({
      action: 'borrower_comm.evaluated',
      entityType: 'deal',
      entityId: 'deal-1',
      metadata: { status: 'closing', channel: 'email', partyId: 'party-1' },
    });
    const [, notified] = vi.mocked(emitAuditEvent).mock.calls[1]!;
    expect(notified).toMatchObject({ action: 'borrower_comm.notified', entityId: 'deal-1' });
  });

  it('the audit metadata never contains the borrower email (hard rule #3)', async () => {
    await notifyBorrower('deal-1', 'closing', CTX);
    for (const call of vi.mocked(emitAuditEvent).mock.calls) {
      expect(JSON.stringify(call[1].metadata)).not.toContain('b1@example.com');
    }
  });

  it('fans out to every borrower party (co-borrowers included)', async () => {
    vi.mocked(loadBorrowerParties).mockResolvedValue([
      { id: 'party-1', email: 'b1@example.com' },
      { id: 'party-2', email: 'b2@example.com' },
    ]);

    await notifyBorrower('deal-1', 'completed', CTX);

    expect(sendBorrowerComm).toHaveBeenCalledTimes(2);
    expect(emitAuditEvent).toHaveBeenCalledTimes(4); // 2 parties × (evaluated + notified)
  });

  it('does nothing for a routine status', async () => {
    await notifyBorrower('deal-1', 'title_work', CTX);
    expect(loadBorrowerParties).not.toHaveBeenCalled();
    expect(sendBorrowerComm).not.toHaveBeenCalled();
    expect(emitAuditEvent).not.toHaveBeenCalled();
  });

  it('does nothing when the deal has no borrower-email party', async () => {
    vi.mocked(loadBorrowerParties).mockResolvedValue([]);
    await notifyBorrower('deal-1', 'closing', CTX);
    expect(sendBorrowerComm).not.toHaveBeenCalled();
    expect(emitAuditEvent).not.toHaveBeenCalled();
  });

  it('swallows a failing send (leaves the evaluated trail) without blocking other parties', async () => {
    vi.mocked(loadBorrowerParties).mockResolvedValue([
      { id: 'party-1', email: 'b1@example.com' },
      { id: 'party-2', email: 'b2@example.com' },
    ]);
    vi.mocked(sendBorrowerComm)
      .mockRejectedValueOnce(new Error('resend boom for SSN 123-45-6789'))
      .mockResolvedValueOnce({ accepted: true });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(notifyBorrower('deal-1', 'closing', CTX)).resolves.toBeUndefined();

    // party-1 failed (evaluated only), party-2 succeeded (evaluated + notified) = 3 audits.
    expect(emitAuditEvent).toHaveBeenCalledTimes(3);
    expect(sendBorrowerComm).toHaveBeenCalledTimes(2); // the failure did not stop party-2
    const line = errSpy.mock.calls[0]?.[0] as string;
    expect(line).not.toMatch(/[\r\n]/);
    expect(line).not.toContain('123-45-6789');
    expect(line).toContain('***-**-6789');

    errSpy.mockRestore();
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `cmd /c "pnpm --filter web test notify-borrower"`
Expected: FAIL — `Cannot find module './notify-borrower'`.

- [ ] **Step 7: Implement the dispatcher** — `apps/web/lib/agents/borrower-comms/notify-borrower.ts`

```ts
import { borrowerNotificationForStatus } from '@cema/agents-borrower-comms';
import { emitAuditEvent, redactPii } from '@cema/compliance';
import { SpanStatusCode, trace } from '@opentelemetry/api';

import type { DealStatus } from '../../actions/transition-deal-status';
import { ERROR_IDS } from '../../constants/error-ids';
import { withRls } from '../../with-rls';

import { sendBorrowerComm } from './channel';
import { loadBorrowerParties } from './parties';

const tracer = trace.getTracer('@cema/web-borrower-comms');

/** Tenancy + actor context for the notification audits. */
export interface NotifyBorrowerContext {
  organizationId: string;
  actorUserId: string;
}

/**
 * Post-commit borrower-comms dispatcher (spec §9.9). If the new deal status is a
 * borrower touchpoint (authorization / closing / completed), emails every
 * borrower + co_borrower party (with an email) a PII-safe update and split-audits
 * each (borrower_comm.evaluated before send, borrower_comm.notified on success).
 *
 * Email-only (TCPA-exempt — hard rule #4; the deferred SMS/voice path must call
 * tcpaGuard). BEST-EFFORT: a failed send for one party never blocks the other
 * co-borrowers or the already-committed status write. PII (#3): the recipient
 * email rides only in the send packet, never the audits/logs/spans.
 */
export async function notifyBorrower(
  dealId: string,
  toStatus: DealStatus,
  ctx: NotifyBorrowerContext,
): Promise<void> {
  const notification = borrowerNotificationForStatus(toStatus);
  if (!notification) return; // not a borrower touchpoint

  const recipients = await loadBorrowerParties(ctx.organizationId, dealId);
  if (recipients.length === 0) return; // no borrower with an email -- nothing to send

  for (const recipient of recipients) {
    await tracer.startActiveSpan('borrower_comm.notify', async (span) => {
      // PII-safe attributes only: opaque ids + enum tokens (never email/name/body).
      span.setAttribute('comm.deal_id', dealId);
      span.setAttribute('comm.party_id', recipient.id);
      span.setAttribute('comm.status', notification.status);
      span.setAttribute('comm.channel', notification.channel);
      try {
        // Split audit (part 1): record the decision BEFORE the side effect.
        await withRls(ctx.organizationId, (tx) =>
          emitAuditEvent(tx, {
            organizationId: ctx.organizationId,
            actorUserId: ctx.actorUserId,
            action: 'borrower_comm.evaluated',
            entityType: 'deal',
            entityId: dealId,
            metadata: {
              status: notification.status,
              channel: notification.channel,
              partyId: recipient.id,
            },
          }),
        );

        const result = await sendBorrowerComm({
          dealId,
          partyId: recipient.id,
          status: notification.status,
          channel: notification.channel,
          to: recipient.email,
          subject: notification.subject,
          body: notification.body,
        });
        span.setAttribute('comm.accepted', result.accepted);

        // Split audit (part 2): record success after the side effect.
        await withRls(ctx.organizationId, (tx) =>
          emitAuditEvent(tx, {
            organizationId: ctx.organizationId,
            actorUserId: ctx.actorUserId,
            action: 'borrower_comm.notified',
            entityType: 'deal',
            entityId: dealId,
            metadata: {
              status: notification.status,
              channel: notification.channel,
              partyId: recipient.id,
              accepted: result.accepted,
            },
          }),
        );
        span.setStatus({ code: SpanStatusCode.OK });
      } catch (err) {
        const message = redactPii(err instanceof Error ? err.message : String(err));
        span.setStatus({ code: SpanStatusCode.ERROR, message });
        // PII-safe + log-injection-safe: redact the whole line + strip CR/LF
        // inline at the sink (quantifier-free /[\r\n]/g is the CodeQL-recognized
        // sanitizer). partyId is opaque (not PII); email is never in the line.
        // eslint-disable-next-line no-console
        console.error(
          redactPii(
            `[${ERROR_IDS.BORROWER_COMM_NOTIFY_FAILED}] borrower comm failed for deal ${dealId} party ${recipient.id}: ${message}`,
          ).replace(/[\r\n]/g, ' '),
        );
      } finally {
        span.end();
      }
    });
  }
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `cmd /c "pnpm --filter web test notify-borrower"`
Expected: PASS (6 tests).

- [ ] **Step 9: Commit**

```bash
git add apps/web/lib/agents/borrower-comms/ apps/web/lib/constants/error-ids.ts apps/web/package.json pnpm-lock.yaml
git commit -S -m "feat(borrower-comms): best-effort notifyBorrower dispatcher (per-party split audit)"
```

---

## Task 5: Drift guard — `BORROWER_NOTIFY_STATUSES ⊆ deal_status` enum

**Files:**

- Test: `apps/web/lib/agents/borrower-comms/borrower-notify-statuses.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { BORROWER_NOTIFY_STATUSES } from '@cema/agents-borrower-comms';
import { dealStatusEnum } from '@cema/db';
import { describe, expect, it } from 'vitest';

describe('BORROWER_NOTIFY_STATUSES drift guard', () => {
  it('is a subset of the deal_status enum', () => {
    const valid = new Set<string>(dealStatusEnum.enumValues);
    for (const status of BORROWER_NOTIFY_STATUSES) {
      expect(valid.has(status)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run to verify it passes**

Run: `cmd /c "pnpm --filter web test borrower-notify-statuses"`
Expected: PASS (1 test).

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/agents/borrower-comms/borrower-notify-statuses.test.ts
git commit -S -m "test(borrower-comms): BORROWER_NOTIFY_STATUSES subset-of-deal_status drift guard"
```

---

## Task 6: Wire into `transitionDealStatus` (TDD)

**Files:**

- Modify: `apps/web/lib/actions/transition-deal-status.ts`
- Modify: `apps/web/lib/actions/transition-deal-status.test.ts`

- [ ] **Step 1: Extend the existing test (red).** In `apps/web/lib/actions/transition-deal-status.test.ts`:

(a) After the `vi.mock('../agents/internal-comms/notify-internal', ...)` block, add:

```ts
vi.mock('../agents/borrower-comms/notify-borrower', () => ({
  notifyBorrower: vi.fn().mockResolvedValue(undefined),
}));
```

(b) After the `import { notifyInternal } from '../agents/internal-comms/notify-internal';` line, add:

```ts
import { notifyBorrower } from '../agents/borrower-comms/notify-borrower';
```

(c) In the unchanged-status test (asserting `expect(notifyInternal).not.toHaveBeenCalled();`), add below it:

```ts
expect(notifyBorrower).not.toHaveBeenCalled();
```

(d) In the changed-transition test (asserting `expect(notifyInternal).toHaveBeenCalledWith('deal-1', 'eligibility', { organizationId: 'org-1', actorUserId: 'user-1' });`), add below it:

```ts
expect(notifyBorrower).toHaveBeenCalledWith('deal-1', 'eligibility', {
  organizationId: 'org-1',
  actorUserId: 'user-1',
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cmd /c "pnpm --filter web test transition-deal-status"`
Expected: FAIL — `notifyBorrower` was not called.

- [ ] **Step 3: Add the wiring** in `apps/web/lib/actions/transition-deal-status.ts`. Add the import after the `notifyInternal` import:

```ts
import { notifyBorrower } from '../agents/borrower-comms/notify-borrower';
```

Then in the `if (result.changed) { ... }` block, immediately after the `await notifyInternal(...)` call, add:

```ts
// Third post-commit fan-out: borrower-facing email (spec §9.9). Independent
// of and after the agent + internal-comms dispatch; itself best-effort.
await notifyBorrower(dealId, result.to, {
  organizationId: org.id,
  actorUserId: user.id,
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `cmd /c "pnpm --filter web test transition-deal-status"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/actions/transition-deal-status.ts apps/web/lib/actions/transition-deal-status.test.ts
git commit -S -m "feat(borrower-comms): fan out notifyBorrower from transitionDealStatus"
```

---

## Task 7: Full verification

- [ ] **Step 1: Format, lint, typecheck, tests**

```bash
cmd /c "pnpm format:check"
cmd /c "pnpm --filter web lint"
cmd /c "pnpm typecheck"
cmd /c "pnpm --filter @cema/agents-borrower-comms test"
cmd /c "pnpm --filter web test"
```

Expected: `format:check` clean (only pre-existing untracked `.well-known/workflow/*` artifacts may warn — not ours); `web lint` 0 errors; typecheck 31/31; package 6/6; web suite green (the new notify-borrower 6 / drift 1 / transition assertions). If a full-parallel web run flakes on a Neon integration test, re-run `pnpm --filter web exec vitest run tests/integration --no-file-parallelism` to confirm it passes serially (shared-branch race, not a regression).

- [ ] **Step 2: Commit any formatting fixups** (if `pnpm format` changed anything)

```bash
git add -A && git commit -S -m "chore(borrower-comms): formatting"
```

---

## Self-Review (author checklist — completed)

**1. Spec coverage:** pure core (§3 → Tasks 2–3), Fixture seam (§3 → Task 3), per-party dispatcher + RLS loader + split audit + span + best-effort + PII fence (§4/§6 → Task 4), wiring (§5 → Task 6), TCPA note (§6 — email-only, no v1 gate; documented in the dispatcher), drift guard (§7 → Task 5), testing (§8 → all). ✓

**2. Placeholder scan:** no TBD/TODO; every code step is complete; every command has expected output. ✓

**3. Type consistency:** `borrowerNotificationForStatus(status: string): BorrowerNotification | null`; `BorrowerCommPacket { dealId, partyId, status, channel, to, subject, body }`; `loadBorrowerParties(organizationId, dealId): Promise<BorrowerRecipient[]>` with `BorrowerRecipient { id, email }`; `sendBorrowerComm`; `notifyBorrower(dealId, toStatus, ctx)`; `ERROR_IDS.BORROWER_COMM_NOTIFY_FAILED`; audits `borrower_comm.evaluated` / `borrower_comm.notified` with `metadata { status, channel, partyId, accepted? }` — consistent across Tasks 2–6. App dispatcher relative imports use `../../` (two levels below `lib/`). ✓
