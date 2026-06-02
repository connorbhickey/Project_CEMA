# Borrower Comms Agent (v1) — Design Spec

> **Status:** Approved (Connor, 2026-06-01) — implementation pending.
> **Milestone:** Phase 1 (the **7th & last** of 7 Layer-3 agents — spec §9.9). Push/transition model.
> **Authoritative spec:** `docs/superpowers/specs/2026-05-12-cema-ai-processor-design.md` §9.9.

---

## 1. Goal & scope

When a deal enters a borrower-relevant state, email every borrower party a plain-language, PII-safe
update. The Internal Comms shape (channel adapter + deterministic templates + dormant send + split
audit), but **borrower-facing** — the recipient is a _looked-up borrower party_, the channel is
**email-only** (TCPA-safe), via a dormant Resend seam.

**In scope:**

- A pure deterministic core (`borrowerNotificationForStatus`) in a new `@cema/agents-borrower-comms`
  package (no `@cema/db`/clock/LLM).
- A dormant `FixtureChannelAdapter` behind a `BorrowerChannelAdapter` seam (the swap point for a real
  Resend adapter).
- An app-layer best-effort `notifyBorrower` dispatcher that RLS-reads the deal's borrower parties and
  emails each, with a PII-safe OTel span + split audit.
- Wired as a **third post-commit fan-out** in `transitionDealStatus` (after agents + internal comms).

**Out of scope (deferred — carry-overs):**

- A real `ResendChannelAdapter` (gated on `RESEND_API_KEY` + a verified sending domain — the same
  carry-over as the Servicer Outreach channel; reuses Resend, no new `packages/integrations/*`).
- **SMS via Twilio** — the only TCPA-gated channel (hard rule #4). When added, it MUST call the
  existing `apps/web/lib/compliance/tcpa-guard.ts:tcpaGuard(party)` (throws `TcpaConsentMissingError`
  for a borrower/co_borrower party without `tcpaOptIn` + `tcpaOptInAt`) before any send. Email is
  TCPA-exempt, so v1 needs no runtime consent gate; the single-member `BorrowerChannel = 'email'`
  union makes adding SMS a deliberate type change that forces touching the consent path.
- LLM (Claude Sonnet 4.6) plain-language personalization — dormant, with the static template as the
  floor (mirrors Outreach's `draftOutreachEmail`).
- On-reply parse/classify/route to processor (spec step 4) — needs inbound email (Nylas/Resend).
- Borrower-portal notifications; per-borrower preferred-channel; document-available / schedule-change
  triggers; broader touchpoints (intake acknowledgment, cancelled closure).
- A Braintrust eval — the PII-safety unit test is the v1 gate (matching the no-LLM agents).

## 2. Why email-only, why these touchpoints

**TCPA (hard rule #4) gates SMS/voice, not email.** Email-only sidesteps the consent risk entirely
while matching the spec's "email default." The borrower is a `parties` row with `role IN ('borrower',
'co_borrower')` (co-borrowers are a _distinct_ role — both must be notified), carrying `email` + the
`tcpaOptIn`/`tcpaOptInAt` fields.

The borrower cares about **their** actions and milestones, not internal pipeline states — so the
touchpoints are a deliberately different (and smaller) set than Internal Comms. v1 emails on three
high-signal transitions; the internal-only states (`eligibility`/`collateral_chase`/`title_work`/
`doc_prep`/`attorney_review`/`recording`/`exception`) are excluded, and `exception` especially must
never reach a borrower.

## 3. Pure core — `@cema/agents-borrower-comms` (new 27th package)

No `@cema/db`, takes a plain `status: string` (the decoupling pattern), node-testable.

```ts
// types.ts
export const BORROWER_NOTIFY_STATUSES = ['authorization', 'closing', 'completed'] as const;
export type BorrowerNotifyStatus = (typeof BORROWER_NOTIFY_STATUSES)[number];

// v1 is email-only. A single-member union (not a bare string): adding 'sms' later is a deliberate
// type change that forces the consent path (hard rule #4 — call tcpaGuard before any SMS send).
export const BORROWER_CHANNELS = ['email'] as const;
export type BorrowerChannel = (typeof BORROWER_CHANNELS)[number];

// Pure-core output. Static PII-free email content (no name, amount, id, or account number).
export interface BorrowerNotification {
  readonly status: BorrowerNotifyStatus;
  readonly channel: BorrowerChannel;
  readonly subject: string;
  readonly body: string;
}

// What the channel adapter sends. `to` is the borrower's email — required by the adapter, but it is
// PII and MUST NOT enter logs/audits/spans (hard rule #3); only `partyId` is logged.
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

```ts
// notify.ts
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

// Exhaustiveness guard: a new BORROWER_NOTIFY_STATUSES member without a template throws at load
// (mirrors ROUTE_BY_BREAK / the Internal-Comms map).
for (const status of BORROWER_NOTIFY_STATUSES) {
  if (!(status in TEMPLATE_BY_STATUS)) {
    throw new Error(`borrower-comms template map is missing an entry for "${status}"`);
  }
}

/**
 * Pure, deterministic borrower-notify decision (spec §9.9). Given a freshly-entered deal_status,
 * returns the email notification, or null for statuses the borrower is not notified about. No clock,
 * no LLM, no IO. PII-safe by construction (static templates, enum tokens).
 */
export function borrowerNotificationForStatus(status: string): BorrowerNotification | null {
  if (!(BORROWER_NOTIFY_STATUSES as readonly string[]).includes(status)) return null;
  const s = status as BorrowerNotifyStatus;
  const { subject, body } = TEMPLATE_BY_STATUS[s];
  return { status: s, channel: 'email', subject, body };
}
```

```ts
// channel.ts — dormant default + test double
export class FixtureChannelAdapter implements BorrowerChannelAdapter {
  public readonly sent: BorrowerCommPacket[] = [];
  // Not `async` (no await) — returns a resolved Promise to satisfy the contract without tripping
  // require-await (packages/agents/* are outside the eslint type-aware project glob).
  send(packet: BorrowerCommPacket): Promise<ChannelSendResult> {
    this.sent.push(packet);
    return Promise.resolve({
      accepted: true,
      channelMessageId: `fixture:${packet.dealId}:${packet.partyId}:${packet.status}`,
    });
  }
}
```

### The touchpoint map (the substance)

| `deal_status` →                                                                                               | Notify borrower? | Subject                           |
| ------------------------------------------------------------------------------------------------------------- | ---------------- | --------------------------------- |
| `authorization`                                                                                               | ✅               | "Action needed on your CEMA"      |
| `closing`                                                                                                     | ✅               | "Your CEMA is scheduled to close" |
| `completed`                                                                                                   | ✅               | "Your CEMA is complete"           |
| intake, eligibility, collateral_chase, title_work, doc_prep, attorney_review, recording, exception, cancelled | ❌ → `null`      | (internal-only / deferred)        |

## 4. App dispatcher — `apps/web/lib/agents/borrower-comms/`

- `channel.ts` — `sendBorrowerComm(packet)` module-level function wrapping the `FixtureChannelAdapter`
  (the Resend swap point; a function, not an exported adapter object, so the dispatcher test mocks it
  without tripping `unbound-method`).
- `notify-borrower.ts` — `notifyBorrower(dealId, status, ctx)`:
  1. `const notification = borrowerNotificationForStatus(status)`; if `null`, **return immediately**.
  2. RLS-read the deal's borrower parties: `withRls(ctx.organizationId, tx => tx.select().from(parties)
.where(and(eq(parties.dealId, dealId), inArray(parties.role, ['borrower', 'co_borrower']))))`.
     Keep only parties with a non-null, non-empty `email`. If none, emit a PII-safe log and return
     (best-effort — nothing to send).
  3. **For each borrower party** (co-borrowers included):
     - Open an OTel span `borrower_comm.notify` with PII-safe attributes only (`comm.deal_id`,
       `comm.party_id`, `comm.status`, `comm.channel` — **never** the email, name, or body).
     - **Split audit (part 1):** `borrower_comm.evaluated` inside `withRls` — `metadata { status,
channel, partyId }` — before the send.
     - `await sendBorrowerComm({ dealId, partyId, status, channel: 'email', to: email, subject,
body })`.
     - **Split audit (part 2):** `borrower_comm.notified` (`metadata { status, channel, partyId,
accepted }`) on success.
     - **Best-effort:** wrap each party's send in try/catch; on failure set span `ERROR` and log with
       the inline `redactPii(...).replace(/[\r\n]/g, ' ')` + `ERROR_IDS.BORROWER_COMM_NOTIFY_FAILED`.
       A failure on one borrower never blocks the other co-borrowers or the committed status write;
       never rethrows.

`ctx` reuses the `{ organizationId, actorUserId }` shape threaded through the other dispatchers.

**TCPA note (hard rule #4):** v1 is email-only and email is TCPA-exempt, so there is no runtime
consent gate. Any future SMS/voice channel MUST call `tcpaGuard(party)` (already implemented +
tested at `apps/web/lib/compliance/tcpa-guard.ts`) before sending. The `BorrowerChannel = 'email'`
single-member union enforces this at compile time (adding `'sms'` forces the consent path).

## 5. Wiring — `apps/web/lib/actions/transition-deal-status.ts` (1 line)

A **third** independent post-commit fan-out, after the agent dispatcher and the internal-comms one:

```ts
if (result.changed) {
  revalidatePath('/deals');
  await onDealStatusChanged(dealId, result.to, ctx);
  await notifyInternal(dealId, result.to, ctx);
  await notifyBorrower(dealId, result.to, ctx); // borrower-facing email (spec §9.9)
}
```

(`ctx` = `{ organizationId: org.id, actorUserId: user.id }`.) Each fan-out is best-effort and
swallows its own errors, so none can undo the committed status write.

## 6. Compliance / PII (hard rules #3 + #4)

- **#3 (PII in logs):** messages are static templates (no name/amount/id); the recipient email rides
  in the packet for the adapter but **never** enters logs/audits/spans — only `partyId` (opaque uuid),
  `status`, and `channel` tokens do. A unit test asserts templates are digit/PII-free; a dispatcher
  test asserts the audit metadata contains no email. The best-effort log path uses the inline
  `redactPii` + quantifier-free `/[\r\n]/g` sanitizer at the sink.
- **#4 (TCPA):** email-only ships (TCPA-exempt); the deferred SMS/voice path reuses the existing
  tested `tcpaGuard`; the channel union enforces email-only at compile time.

## 7. Drift guard

An app-layer test asserts `BORROWER_NOTIFY_STATUSES ⊆ dealStatusEnum.enumValues`.

## 8. Testing

- **Package** (`@cema/agents-borrower-comms`):
  - `notify.test.ts` — each touchpoint status returns subject+body+`channel:'email'`; each
    non-touchpoint status returns `null`; **PII-safety**: no subject/body contains a digit.
  - `channel.test.ts` — `FixtureChannelAdapter` records the packet + reports accepted.
- **App** (`apps/web`):
  - `notify-borrower.test.ts` — a touchpoint status sends + split-audits **once per borrower party**
    (co-borrower fan-out: 2 parties → 2 sends); a routine status does nothing; a deal with no
    borrower-email party does nothing; a failing send is swallowed (never rethrows) and leaves the
    `evaluated` trail; the audit metadata carries `partyId` but **no email**.
  - `borrower-notify-statuses.test.ts` (drift guard) — `BORROWER_NOTIFY_STATUSES ⊆ deal_status`.

Target: ~14 tests. **0 migrations.** Package count 26 → **27**.

## 9. File structure

```text
packages/agents/borrower-comms/
  package.json            # @cema/agents-borrower-comms, devDeps only
  tsconfig.json           # extends @cema/config/tsconfig/node.json
  src/
    types.ts
    notify.ts
    channel.ts
    index.ts
    notify.test.ts
    channel.test.ts
apps/web/lib/agents/borrower-comms/
  channel.ts              # sendBorrowerComm fn (Resend swap point)
  notify-borrower.ts      # notifyBorrower dispatcher (per-party span + split audit, best-effort)
  notify-borrower.test.ts
  borrower-notify-statuses.test.ts   # drift guard
apps/web/lib/constants/error-ids.ts  # + BORROWER_COMM_NOTIFY_FAILED
apps/web/lib/actions/transition-deal-status.ts  # +1 line wiring
apps/web/package.json     # + @cema/agents-borrower-comms dep
```
