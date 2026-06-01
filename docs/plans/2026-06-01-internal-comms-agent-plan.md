# Internal Comms Agent (v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Notify the org's internal pipeline channel when a deal_status enters a noteworthy state (ready-for-review / awaiting-input / exception), via a deterministic core + dormant channel seam, wired as a second post-commit fan-out in `transitionDealStatus`.

**Architecture:** New thin package `@cema/agents-internal-comms` (pure `notificationForStatus` core + `FixtureChannelAdapter`, no `@cema/db`/clock/LLM). An app-layer best-effort `notifyInternal` dispatcher (OTel span + PII-safe `internal_comm.notified` audit) called from `transitionDealStatus` after the existing agent dispatcher. 0 migrations.

**Tech Stack:** TypeScript (strict, ESM), Vitest, Drizzle (enum drift guard only), `@cema/compliance` (`emitAuditEvent`/`redactPii`), `@opentelemetry/api`.

**Design spec:** `docs/plans/2026-06-01-internal-comms-agent.md`

---

## Task 1: Scaffold the `@cema/agents-internal-comms` package

**Files:**

- Create: `packages/agents/internal-comms/package.json`
- Create: `packages/agents/internal-comms/tsconfig.json`

- [ ] **Step 1: Create `package.json`** (copy of the exception-triage thin template, name changed)

```json
{
  "name": "@cema/agents-internal-comms",
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

- [ ] **Step 3: Install so pnpm links the new workspace package**

Run: `cmd /c "pnpm install"`
Expected: completes; `@cema/agents-internal-comms` appears in the workspace (no error).

- [ ] **Step 4: Commit**

```bash
git add packages/agents/internal-comms/package.json packages/agents/internal-comms/tsconfig.json pnpm-lock.yaml
git commit -S -m "feat(internal-comms): scaffold @cema/agents-internal-comms package"
```

---

## Task 2: Pure core — `types.ts` + `notify.ts` (TDD)

**Files:**

- Create: `packages/agents/internal-comms/src/types.ts`
- Create: `packages/agents/internal-comms/src/notify.ts`
- Test: `packages/agents/internal-comms/src/notify.test.ts`

- [ ] **Step 1: Write the failing test** — `packages/agents/internal-comms/src/notify.test.ts`

```ts
import { describe, expect, it } from 'vitest';

import { notificationForStatus } from './notify';
import { INTERNAL_CHANNELS, NOTIFY_STATUSES } from './types';

describe('notificationForStatus', () => {
  it('returns a pipeline notification for each notify-worthy status', () => {
    for (const status of NOTIFY_STATUSES) {
      const n = notificationForStatus(status);
      expect(n).not.toBeNull();
      expect(n).toMatchObject({ status, channel: 'pipeline' });
      expect(n!.message.length).toBeGreaterThan(0);
    }
  });

  it('returns null for routine/terminal statuses', () => {
    for (const status of [
      'intake',
      'eligibility',
      'title_work',
      'doc_prep',
      'closing',
      'recording',
      'completed',
      'cancelled',
    ]) {
      expect(notificationForStatus(status)).toBeNull();
    }
  });

  it('returns null for an unknown status string', () => {
    expect(notificationForStatus('not_a_status')).toBeNull();
  });

  it('messages are static PII-free strings (no interpolated ids/counts/names)', () => {
    for (const status of NOTIFY_STATUSES) {
      const message = notificationForStatus(status)!.message;
      expect(message).not.toMatch(/\d/); // no count/id/amount leaks
    }
  });

  it('exposes the notify-status and channel vocabularies', () => {
    expect([...NOTIFY_STATUSES].sort()).toEqual([
      'attorney_review',
      'authorization',
      'collateral_chase',
      'exception',
    ]);
    expect(INTERNAL_CHANNELS).toEqual(['pipeline']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cmd /c "pnpm --filter @cema/agents-internal-comms test"`
Expected: FAIL — `Cannot find module './notify'` / `'./types'`.

- [ ] **Step 3: Implement `types.ts`**

```ts
// Internal Comms vocabulary (spec §9.10). v1 notifies on the deal_status
// transitions that map to the spec's trigger categories (ready-for-review /
// awaiting-input / exception); routine pipeline progress + terminal milestones
// are deferred. Pure: no @cema/db, no clock, no LLM -- the core takes a plain
// status string (the Exception-Triage decoupling) so it stays node-testable.

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
// party names, or amounts) -- safe to post/persist.
export interface InternalNotification {
  readonly status: NotifyStatus;
  readonly channel: InternalChannel;
  readonly message: string;
}

// What the channel adapter sends. Carries the opaque dealId (NOT PII) so a real
// Slack adapter can render a deep link; the Fixture just records it.
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

- [ ] **Step 4: Implement `notify.ts`**

```ts
import { NOTIFY_STATUSES, type InternalNotification, type NotifyStatus } from './types';

// Static, PII-free message per notify-worthy status (no ids/counts/party names).
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

- [ ] **Step 5: Run test to verify it passes**

Run: `cmd /c "pnpm --filter @cema/agents-internal-comms test"`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/agents/internal-comms/src/types.ts packages/agents/internal-comms/src/notify.ts packages/agents/internal-comms/src/notify.test.ts
git commit -S -m "feat(internal-comms): pure notificationForStatus core + vocabulary"
```

---

## Task 3: `FixtureChannelAdapter` + `index.ts` (TDD)

**Files:**

- Create: `packages/agents/internal-comms/src/channel.ts`
- Create: `packages/agents/internal-comms/src/index.ts`
- Test: `packages/agents/internal-comms/src/channel.test.ts`

- [ ] **Step 1: Write the failing test** — `packages/agents/internal-comms/src/channel.test.ts`

```ts
import { describe, expect, it } from 'vitest';

import { FixtureChannelAdapter } from './channel';
import type { InternalCommPacket } from './types';

const PACKET: InternalCommPacket = {
  dealId: 'deal-1',
  status: 'attorney_review',
  channel: 'pipeline',
  message: 'A deal has entered attorney review and is ready for an attorney to act.',
};

describe('FixtureChannelAdapter', () => {
  it('records the packet and reports acceptance', async () => {
    const adapter = new FixtureChannelAdapter();
    const result = await adapter.send(PACKET);

    expect(result.accepted).toBe(true);
    expect(result.channelMessageId).toBe('fixture:deal-1:attorney_review');
    expect(adapter.sent).toEqual([PACKET]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cmd /c "pnpm --filter @cema/agents-internal-comms test channel"`
Expected: FAIL — `Cannot find module './channel'`.

- [ ] **Step 3: Implement `channel.ts`**

```ts
import type { ChannelSendResult, InternalChannelAdapter, InternalCommPacket } from './types';

/**
 * Dormant default channel adapter. Records packets in-memory and reports
 * acceptance without sending anything -- the wiring default until a real
 * SlackChannelAdapter is provisioned behind Slack OAuth + a configured channel.
 * Also the test double for the dispatcher behavioral guard.
 */
export class FixtureChannelAdapter implements InternalChannelAdapter {
  public readonly sent: InternalCommPacket[] = [];

  async send(packet: InternalCommPacket): Promise<ChannelSendResult> {
    this.sent.push(packet);
    return { accepted: true, channelMessageId: `fixture:${packet.dealId}:${packet.status}` };
  }
}
```

- [ ] **Step 4: Implement `index.ts`**

```ts
export * from './types';
export * from './notify';
export * from './channel';
```

- [ ] **Step 5: Run test + typecheck to verify green**

Run: `cmd /c "pnpm --filter @cema/agents-internal-comms test && pnpm --filter @cema/agents-internal-comms typecheck"`
Expected: PASS (6 tests total); typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/agents/internal-comms/src/channel.ts packages/agents/internal-comms/src/channel.test.ts packages/agents/internal-comms/src/index.ts
git commit -S -m "feat(internal-comms): dormant FixtureChannelAdapter + package barrel"
```

---

## Task 4: App dispatcher — `notifyInternal` (TDD)

**Files:**

- Modify: `apps/web/lib/constants/error-ids.ts` (add one ID)
- Modify: `apps/web/package.json` (add the workspace dep)
- Create: `apps/web/lib/agents/internal-comms/channel.ts`
- Create: `apps/web/lib/agents/internal-comms/notify-internal.ts`
- Test: `apps/web/lib/agents/internal-comms/notify-internal.test.ts`

- [ ] **Step 1: Add the dep to `apps/web/package.json`**

In the `"dependencies"` block, add (alphabetically near the other `@cema/agents-*` entries):

```json
    "@cema/agents-internal-comms": "workspace:*",
```

Then run: `cmd /c "pnpm install"` (links the dep).

- [ ] **Step 2: Add the error ID** — append to the `ERROR_IDS` object in `apps/web/lib/constants/error-ids.ts`, after `AGENT_DISPATCH_FAILED`:

```ts
  /** A post-commit internal-comms notification (notifyInternal) threw and was
   *  swallowed so the already-committed deal-status write survives. */
  INTERNAL_COMM_NOTIFY_FAILED: 'INTERNAL_COMM_NOTIFY_FAILED',
```

- [ ] **Step 3: Write the failing test** — `apps/web/lib/agents/internal-comms/notify-internal.test.ts`

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The channel adapter is mocked to a spy (mirrors how on-deal-status-changed.test
// mocks the agent entry points); the pure notificationForStatus decision runs real.
vi.mock('./channel', () => ({
  internalChannelAdapter: { send: vi.fn() },
}));

// emitAuditEvent mocked (no DB); redactPii stays REAL so the PII/log-injection
// assertions exercise the actual sanitizer.
vi.mock('@cema/compliance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@cema/compliance')>();
  return { ...actual, emitAuditEvent: vi.fn() };
});

// withRls runs its callback with a throwaway tx (emitAuditEvent is mocked).
vi.mock('../../with-rls', () => ({
  withRls: vi.fn((_orgId: string, cb: (tx: unknown) => unknown) => cb({})),
}));

import { emitAuditEvent } from '@cema/compliance';

import { withRls } from '../../with-rls';

import { internalChannelAdapter } from './channel';
import { notifyInternal } from './notify-internal';

const CTX = { organizationId: 'org-1', actorUserId: 'user-1' };

beforeEach(() => {
  vi.mocked(internalChannelAdapter.send).mockResolvedValue({
    accepted: true,
    channelMessageId: 'fixture:deal-1:attorney_review',
  });
  vi.mocked(emitAuditEvent).mockResolvedValue(undefined);
  vi.mocked(withRls).mockImplementation((_orgId, cb) => cb({} as never));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('notifyInternal', () => {
  it('sends a notification + records the audit for a notify-worthy status', async () => {
    await notifyInternal('deal-1', 'attorney_review', CTX);

    expect(internalChannelAdapter.send).toHaveBeenCalledTimes(1);
    expect(internalChannelAdapter.send).toHaveBeenCalledWith({
      dealId: 'deal-1',
      status: 'attorney_review',
      channel: 'pipeline',
      message: 'A deal has entered attorney review and is ready for an attorney to act.',
    });

    expect(withRls).toHaveBeenCalledWith('org-1', expect.any(Function));
    expect(emitAuditEvent).toHaveBeenCalledTimes(1);
    const [, event] = vi.mocked(emitAuditEvent).mock.calls[0]!;
    expect(event).toMatchObject({
      organizationId: 'org-1',
      actorUserId: 'user-1',
      action: 'internal_comm.notified',
      entityType: 'deal',
      entityId: 'deal-1',
      metadata: { status: 'attorney_review', channel: 'pipeline', accepted: true },
    });
  });

  it('does nothing for a routine status', async () => {
    await notifyInternal('deal-1', 'title_work', CTX);

    expect(internalChannelAdapter.send).not.toHaveBeenCalled();
    expect(emitAuditEvent).not.toHaveBeenCalled();
  });

  it('swallows a failing send so the status write is never blocked', async () => {
    vi.mocked(internalChannelAdapter.send).mockRejectedValue(new Error('slack boom'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(notifyInternal('deal-1', 'exception', CTX)).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalledTimes(1);

    errSpy.mockRestore();
  });

  it('emits a single-line, PII-redacted log entry on hostile dealId/error input', async () => {
    vi.mocked(internalChannelAdapter.send).mockRejectedValue(
      new Error('boom for SSN 123-45-6789\nFAKE forged log line'),
    );
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(notifyInternal('deal-1\nINJECTED', 'exception', CTX)).resolves.toBeUndefined();

    const line = errSpy.mock.calls[0]?.[0] as string;
    expect(line).not.toMatch(/[\r\n]/); // log-injection neutralized
    expect(line).not.toContain('123-45-6789'); // raw SSN never logged
    expect(line).toContain('***-**-6789'); // masked instead

    errSpy.mockRestore();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cmd /c "pnpm --filter web test notify-internal"`
Expected: FAIL — `Cannot find module './notify-internal'` / `'./channel'`.

- [ ] **Step 5: Implement `apps/web/lib/agents/internal-comms/channel.ts`**

```ts
import { FixtureChannelAdapter, type InternalChannelAdapter } from '@cema/agents-internal-comms';

/**
 * The wired internal-comms channel. Dormant FixtureChannelAdapter today; the
 * one-line swap point for a real SlackChannelAdapter (over org_slack_connections)
 * once Slack OAuth + a configured channel are provisioned.
 */
export const internalChannelAdapter: InternalChannelAdapter = new FixtureChannelAdapter();
```

- [ ] **Step 6: Implement `apps/web/lib/agents/internal-comms/notify-internal.ts`**

```ts
import { notificationForStatus } from '@cema/agents-internal-comms';
import { emitAuditEvent, redactPii } from '@cema/compliance';
import { SpanStatusCode, trace } from '@opentelemetry/api';

import type { DealStatus } from '../../actions/transition-deal-status';
import { ERROR_IDS } from '../../constants/error-ids';
import { withRls } from '../../with-rls';

import { internalChannelAdapter } from './channel';

const tracer = trace.getTracer('@cema/web-internal-comms');

/** Tenancy + actor context for the notification audit (threaded from the caller
 *  that already resolved the Clerk org + user for the status write). */
export interface NotifyInternalContext {
  organizationId: string;
  actorUserId: string;
}

/**
 * Post-commit internal-comms dispatcher (spec §9.10). Called AFTER a deal-status
 * change has committed + been audited; if the new status warrants a team
 * notification (ready-for-review / awaiting-input / exception), it posts a
 * PII-safe message to the org's internal pipeline channel and records an
 * `internal_comm.notified` audit.
 *
 * BEST-EFFORT by design: a failed notification must never roll back or surface
 * on the status change itself, so every error is swallowed and logged PII-safe.
 * Today this runs IN-REQUEST (the channel adapter is dormant); at real-Slack
 * activation the send should become fire-and-forget.
 */
export async function notifyInternal(
  dealId: string,
  toStatus: DealStatus,
  ctx: NotifyInternalContext,
): Promise<void> {
  const notification = notificationForStatus(toStatus);
  if (!notification) return; // routine/terminal status -- nothing to say

  return tracer.startActiveSpan('internal_comm.notify', async (span) => {
    // PII-safe attributes only: opaque dealId + enum/token fields (hard rule #3).
    span.setAttribute('comm.deal_id', dealId);
    span.setAttribute('comm.status', notification.status);
    span.setAttribute('comm.channel', notification.channel);
    try {
      const result = await internalChannelAdapter.send({
        dealId,
        status: notification.status,
        channel: notification.channel,
        message: notification.message,
      });
      span.setAttribute('comm.accepted', result.accepted);

      // PII-safe audit: enum/token fields only (never the message body, party
      // names, or amounts -- though the static template carries none anyway).
      await withRls(ctx.organizationId, (tx) =>
        emitAuditEvent(tx, {
          organizationId: ctx.organizationId,
          actorUserId: ctx.actorUserId,
          action: 'internal_comm.notified',
          entityType: 'deal',
          entityId: dealId,
          metadata: {
            status: notification.status,
            channel: notification.channel,
            accepted: result.accepted,
          },
        }),
      );
      span.setStatus({ code: SpanStatusCode.OK });
    } catch (err) {
      const message = redactPii(err instanceof Error ? err.message : String(err));
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      // PII-safe AND log-injection-safe: redact the WHOLE emitted line (hard
      // rule #3) and strip every CR/LF so an untrusted dealId cannot forge a
      // second log entry. The redact+replace MUST stay INLINE in the direct
      // dataflow to console.error -- the quantifier-free /[\r\n]/g is the form
      // CodeQL recognizes as a js/log-injection sanitizer.
      // eslint-disable-next-line no-console
      console.error(
        redactPii(
          `[${ERROR_IDS.INTERNAL_COMM_NOTIFY_FAILED}] internal comm failed for deal ${dealId}: ${message}`,
        ).replace(/[\r\n]/g, ' '),
      );
    } finally {
      span.end();
    }
  });
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cmd /c "pnpm --filter web test notify-internal"`
Expected: PASS (4 tests).

- [ ] **Step 8: Commit**

```bash
git add apps/web/lib/agents/internal-comms/channel.ts apps/web/lib/agents/internal-comms/notify-internal.ts apps/web/lib/agents/internal-comms/notify-internal.test.ts apps/web/lib/constants/error-ids.ts apps/web/package.json pnpm-lock.yaml
git commit -S -m "feat(internal-comms): best-effort notifyInternal dispatcher (span + audit)"
```

---

## Task 5: Drift guard — `NOTIFY_STATUSES ⊆ deal_status` enum

**Files:**

- Test: `apps/web/lib/agents/internal-comms/notify-statuses.test.ts`

- [ ] **Step 1: Write the test** — `apps/web/lib/agents/internal-comms/notify-statuses.test.ts`

```ts
import { NOTIFY_STATUSES } from '@cema/agents-internal-comms';
import { dealStatusEnum } from '@cema/db';
import { describe, expect, it } from 'vitest';

describe('NOTIFY_STATUSES drift guard', () => {
  it('is a subset of the deal_status enum (decoupled string literals stay valid)', () => {
    const valid = new Set<string>(dealStatusEnum.enumValues);
    for (const status of NOTIFY_STATUSES) {
      expect(valid.has(status)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cmd /c "pnpm --filter web test notify-statuses"`
Expected: PASS (1 test). (This guards against future enum renames silently orphaning a notify status. It passes immediately because the literals are correct today — its value is catching a future drift, like the collateral `types.test.ts` drift guard.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/agents/internal-comms/notify-statuses.test.ts
git commit -S -m "test(internal-comms): NOTIFY_STATUSES subset-of-deal_status drift guard"
```

---

## Task 6: Wire into `transitionDealStatus` (TDD)

**Files:**

- Modify: `apps/web/lib/actions/transition-deal-status.ts`
- Modify: `apps/web/lib/actions/transition-deal-status.test.ts`

- [ ] **Step 1: Extend the existing test (red).** In `apps/web/lib/actions/transition-deal-status.test.ts`:

(a) After the `vi.mock('../agents/on-deal-status-changed', ...)` block, add:

```ts
vi.mock('../agents/internal-comms/notify-internal', () => ({
  notifyInternal: vi.fn().mockResolvedValue(undefined),
}));
```

(b) After the `import { onDealStatusChanged } from '../agents/on-deal-status-changed';` line, add:

```ts
import { notifyInternal } from '../agents/internal-comms/notify-internal';
```

(c) In the existing "does nothing when status is unchanged" test (the one asserting `expect(onDealStatusChanged).not.toHaveBeenCalled();`), add below it:

```ts
expect(notifyInternal).not.toHaveBeenCalled();
```

(d) In the existing changed-transition test (the one asserting `expect(onDealStatusChanged).toHaveBeenCalledWith('deal-1', 'eligibility', { organizationId: 'org-1', actorUserId: 'user-1' });`), add below it:

```ts
expect(notifyInternal).toHaveBeenCalledWith('deal-1', 'eligibility', {
  organizationId: 'org-1',
  actorUserId: 'user-1',
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cmd /c "pnpm --filter web test transition-deal-status"`
Expected: FAIL — `notifyInternal` was not called (the wiring line does not exist yet).

- [ ] **Step 3: Add the wiring line** in `apps/web/lib/actions/transition-deal-status.ts`. Add the import alongside the existing dispatcher import (after `import { onDealStatusChanged } from '../agents/on-deal-status-changed';`):

```ts
import { notifyInternal } from '../agents/internal-comms/notify-internal';
```

Then in the `if (result.changed) { ... }` block, immediately after the existing `await onDealStatusChanged(dealId, result.to, { organizationId: org.id, actorUserId: user.id });` call, add:

```ts
// Second post-commit fan-out: internal-comms notification (spec §9.10).
// Independent of and after the agent dispatch; itself best-effort (it
// swallows its own errors), so it can never undo the committed status write.
await notifyInternal(dealId, result.to, {
  organizationId: org.id,
  actorUserId: user.id,
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cmd /c "pnpm --filter web test transition-deal-status"`
Expected: PASS (all existing cases + the two new assertions).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/actions/transition-deal-status.ts apps/web/lib/actions/transition-deal-status.test.ts
git commit -S -m "feat(internal-comms): fan out notifyInternal from transitionDealStatus"
```

---

## Task 7: Full verification + docs close-out

**Files:**

- (verification only) + `docs/plans/2026-06-01-internal-comms-agent-plan.md` (check the boxes)

- [ ] **Step 1: Format, lint, typecheck, full test sweep**

Run each and confirm clean (fix at the root if not — never `--no-verify`):

```bash
cmd /c "pnpm format:check"
cmd /c "pnpm --filter web lint"
cmd /c "pnpm typecheck"
cmd /c "pnpm --filter @cema/agents-internal-comms test"
cmd /c "pnpm --filter web test"
```

Expected: `format:check` clean (run `pnpm format` if not); lint clean; typecheck clean; package tests green (6); web tests green (all prior + the new notify-internal 4 / notify-statuses 1 / transition assertions).

- [ ] **Step 2: Commit any formatting fixups** (if `pnpm format` changed anything)

```bash
git add -A
git commit -S -m "chore(internal-comms): formatting"
```

(Skip if nothing changed.)

---

## Self-Review (author checklist — completed)

**1. Spec coverage:** every design-spec section maps to a task — pure core (§3 → Tasks 2–3), Fixture seam (§3 → Task 3), app dispatcher + audit + span + best-effort log (§4 → Task 4), wiring (§5 → Task 6), PII gate (§6 → Task 2 PII test + Task 4 hostile-input test), drift guard (§7 → Task 5), testing (§8 → all). 0 migrations (no DB task). ✓

**2. Placeholder scan:** no TBD/TODO; every code step shows complete code; every command has expected output. ✓

**3. Type consistency:** `notificationForStatus(status: string): InternalNotification | null`, `InternalCommPacket { dealId, status, channel, message }`, `ChannelSendResult { accepted, channelMessageId? }`, `internalChannelAdapter.send`, `notifyInternal(dealId, toStatus, ctx)`, `ERROR_IDS.INTERNAL_COMM_NOTIFY_FAILED`, audit `internal_comm.notified` with `metadata { status, channel, accepted }` — used identically across Tasks 2–6. The app dispatcher's relative imports use `../../` (file is two levels below `lib/`: `lib/agents/internal-comms/`). ✓
