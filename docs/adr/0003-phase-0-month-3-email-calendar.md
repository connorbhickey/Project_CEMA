# ADR 0003: Phase 0 Month 3 — Email + Calendar Foundation

**Status:** Accepted (shipped 2026-05-22)
**Author:** Phase 0 Month 3 implementation (Claude Opus 4.7 + Connor Hickey)
**Supersedes:** None
**Superseded by:** None

---

## Context

Phase 0 Month 3 (M3) built the email and calendar foundation that spec §8.3 + §11.1 require so the unified Communications timeline shows the same surface area for every channel a processor touches. The plan at `docs/superpowers/plans/2026-05-22-phase-0-month-3-email-calendar.md` targeted 17 in-scope tasks and 8 explicitly skipped tasks. This ADR records what shipped, where reality diverged from the plan, and the reasoning behind the load-bearing decisions.

Final M3 commits on `feat/m3-email-calendar`: 16 commits + the plan commit. 17 in-scope tasks completed. 8 tasks deferred per the active rule to skip anything requiring vendor account registration or credentials not yet provisioned.

---

## What shipped

### New workspace packages (1)

| Package                    | Contents                                                                                                                                                                                                 |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@cema/integrations-nylas` | Nylas Node SDK wrapper (v7.13.3): HMAC-SHA256 webhook verification, payload parser, `fetchEmailThread()`, `fetchCalendarEvent()`. Normalized DTO types decouple the rest of the app from raw SDK shapes. |

### Database (4 migrations, 0013–0016)

| Migration                     | Contents                                                                                                                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `0013_nylas_connections.sql`  | `org_nylas_connections` — one row per (org × provider × email_address). UNIQUE on `nylas_grant_id` plus a CHECK that enforces `revoked_at IS NOT NULL` iff `connection_status='revoked'`.        |
| `0014_email_threads.sql`      | `email_threads` 1:1 with `communications` via `communication_id`. JSONB participants + attachment IDs, body html/plain, message count, first/last message timestamps. UNIQUE on (thread, grant). |
| `0015_calendar_events.sql`    | `calendar_events` 1:1 with `communications` via `communication_id`. JSONB attendees with RSVP status enum, organizer, location, time range, all-day flag.                                        |
| `0016_rls_email_calendar.sql` | RLS policies: direct `organization_id` equality on `org_nylas_connections`; EXISTS-via-communications on `email_threads` + `calendar_events`. Same shape as `0011_rls_telephony.sql`.            |

### Application (`apps/web`) — webhook, server actions, UI

| File                                               | Purpose                                                                                                                                                           |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/api/webhooks/nylas/route.ts`                  | HMAC-SHA256 verified Nylas webhook. Resolves grant → org via `neondb_owner`, upserts comm + thread/event, publishes to `comms.email.ingest` queue (Phase 1 hook). |
| `lib/actions/list-emails.ts`                       | RSC server action: list email-kind comms for a Deal, left-joined to `email_threads`.                                                                              |
| `lib/actions/get-email.ts`                         | RSC server action: single email-kind comm + its thread row.                                                                                                       |
| `lib/actions/list-calendar-events.ts`              | RSC server action: list meeting-kind comms for a Deal, left-joined to `calendar_events`.                                                                          |
| `lib/actions/get-calendar-event.ts`                | RSC server action: single meeting-kind comm + its calendar event row.                                                                                             |
| `components/email-thread-card.tsx`                 | Timeline-row component for emails (subject, from, snippet, attachment count, medium pill).                                                                        |
| `components/email-thread-viewer.tsx`               | Detail-page renderer with iframe-sandboxed body HTML, plain-text fallback, attachment list.                                                                       |
| `components/calendar-event-card.tsx`               | Timeline-row component for meetings (title, time range, location, attendees, eventStatus pill).                                                                   |
| `app/(app)/deals/[id]/communications/page.tsx`     | Unified timeline: calls + emails + meetings merged and sorted reverse-chronologically.                                                                            |
| `app/(app)/deals/[id]/communications/[c]/page.tsx` | Detail page: routes by `comm.kind` to email viewer, calendar card, or existing call player.                                                                       |

### Queue topic registry (extended)

| Topic                | Payload schema                                                        |
| -------------------- | --------------------------------------------------------------------- |
| `comms.email.ingest` | `{ orgId, communicationId, nylasGrantId, nylasThreadId, receivedAt }` |

The topic is published on every successful email webhook upsert. M3 has no consumer — messages land in dead-letter and become the reprocessable source-of-truth when the Phase 1 WDK workflow (AI summary, Reducto IDP attachment classification) ships.

### Integration tests (1 new file, 6 assertions)

| File                                           | Assertion                                                                                                                                                |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/integration/email-calendar-rls.test.ts` | Cross-org isolation for `org_nylas_connections` (direct), `email_threads` (EXISTS-join), and `calendar_events` (EXISTS-join). 3 × (negative + positive). |

### Test count

91 tests across 19 test files at the M3 close-out (up from 65 / 13 at M2 close). Unit: 79. Integration: 12 (6 M2 + 6 M3). All green.

---

## Skipped tasks and rationale

Eight tasks were deferred per the active session rule. None of them are blockers for the M3 deliverables to compile, lint, type-check, and unit/integration-test green — they are blockers for **live data to start flowing** through the system.

| Task | Scope                                                         | Reason skipped                                            |
| ---- | ------------------------------------------------------------- | --------------------------------------------------------- |
| A    | Nylas app creation + Google Cloud OAuth app + Azure Entra app | External vendor portal registration required.             |
| B    | Nango provider config for Nylas                               | Depends on Task A.                                        |
| C    | `/settings/integrations/email-calendar` UI                    | Depends on Nango OAuth flow (same gap as M2 Task 22).     |
| D    | Reducto IDP for email attachment classification               | Requires Reducto account; full IDP is Phase 1.            |
| E    | Cal.com scheduling links                                      | Requires Cal.com account setup.                           |
| F    | NeverBounce outbound email verification                       | Requires NeverBounce account; outbound email is Phase 1+. |
| G    | WDK workflow for async email enrichment                       | `@vercel/workflow` not installed (carried over from M2).  |
| H    | Vercel env var provisioning + production smoke test           | Requires real `NYLAS_API_KEY` + `NYLAS_WEBHOOK_SECRET`.   |

These tasks carry forward to M4 (or Phase 1 where noted).

---

## Architectural decisions

### 1. Inline upsert (no WDK workflow) for email body

**Decision:** The Nylas webhook handler does its full work — verify, resolve org, fetch thread, upsert two tables, publish queue message — inside the single serverless function invocation. No durable workflow.

**Rationale:** Email body content is small (few KB of JSON) and already present in the webhook payload after the Nylas SDK fetch. Compare with telephony recordings, where a multi-MB audio blob must be downloaded async from the provider (Twilio) into Vercel Blob — that's what required the M2 WDK workflow design. Email doesn't have that latency or size problem. A serverless function can do the work inline and return 200 OK in under 2 s.

**Trade-off accepted:** The full email-ingest flow runs inside a single function timeout. If Nylas's `threads.find()` is slow, we don't have automatic retry. The `comms.email.ingest` queue message is published anyway so a downstream consumer (Phase 1) can perform AI enrichment idempotently; the webhook itself is the gate that converts a Nylas signal into our DB row.

### 2. Idempotency key: `vendor_event_id = thread_id` (email) and `= event_id` (calendar)

**Decision:** Use the existing UNIQUE column `communications.vendor_event_id` as the idempotency key for ON CONFLICT, with the Nylas thread ID (email) or event ID (calendar) as its value.

**Rationale:** The plan's example used `source_thread_id` as the conflict target, but that column has no UNIQUE constraint — the upsert would crash at runtime. `vendor_event_id` is already UNIQUE from M2 (used by Twilio for `RecordingSid` dedup). Reusing it for Nylas gives us:

- Thread-level dedup for email (multiple `message.created` webhooks for messages in the same thread map to one comm row).
- Event-level dedup for calendar (a redelivered `event.updated` webhook updates the same comm row in place).

Source of the divergence from the plan: a typecheck-and-grep audit before writing the handler caught that `source_thread_id` wasn't UNIQUE. The plan was wrong; the schema was right.

### 3. iframe sandboxing for email body HTML

**Decision:** Render `email_threads.body_html` inside an `<iframe sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={...}>`.

**Rationale:** Email body HTML is untrusted external content. Rendering it directly with `dangerouslySetInnerHTML` exposes XSS, CSS bleed into the app shell, and embedded `<script>` execution. An iframe with `sandbox` and `srcDoc` creates a same-origin-isolated rendering context with no script execution by default, no top-frame nav, no form submission. Two attributes we allow:

- `allow-popups` — lets `target="_blank"` links open new tabs (UX expectation for emails).
- `allow-popups-to-escape-sandbox` — opened tabs don't inherit the sandbox.

We considered DOMPurify (HTML sanitization), but it can't catch every CSS-class collision and doesn't isolate from the parent stylesheet. iframe + srcDoc is the simpler, more secure default.

**Trade-off accepted:** Fixed `h-96` (24 rem) iframe height. Long emails scroll inside the iframe rather than expanding the page. A future improvement is a `postMessage`-based auto-resize from the iframe content to its parent.

### 4. Attachment IDs stored, downloads deferred

**Decision:** `email_threads.nylas_attachment_ids` stores the Nylas attachment ID list as JSONB; no binaries are downloaded into Vercel Blob in M3.

**Rationale:** Attachment downloads in M3 would just be a button that calls Nylas's attachment endpoint and proxies the bytes — useful but premature. The real value is classification: a payoff letter PDF should auto-create a `documents` row with `kind='payoff_letter'`, classified by Reducto IDP. That's Phase 1 work, gated on the Reducto account. Storing the ID list now means Phase 1 has the link without a schema migration.

**Trade-off accepted:** No download UX in M3. The viewer shows an attachment count and a placeholder note: "Attachment download links available in Phase 1 (IDP integration)."

### 5. RLS via EXISTS-join (email_threads + calendar_events)

**Decision:** Neither `email_threads` nor `calendar_events` carries its own `organization_id` column. RLS policies use `EXISTS (SELECT 1 FROM communications c WHERE c.id = ... AND c.organization_id::text = current_setting('app.current_organization_id', true))`.

**Rationale:** Adding `organization_id` to these tables would duplicate data and create an integrity hazard — if the org on the comm row diverged from the org on the thread row, neither RLS nor the application would know which to trust. The communications row is the single source of truth for which org a comm belongs to; the 1:1 FK + CHECK on uniqueness gives us the same isolation without the redundancy.

This matches the M2 precedent (`recordings_org_isolation`). Migration 0016 is hand-written for the same reason 0011 was: drizzle-kit can't emit RLS DDL because its schema snapshot doesn't track pgPolicy declarations.

**Trade-off accepted:** RLS-blocked rows still require a join to evaluate the policy. Postgres optimizes the EXISTS into a hash-join probe; the M3 RLS test asserts both rejection and acceptance, exercising the path on every run.

### 6. `resolveMedium()` — gmail vs m365 from the connection

**Decision:** The webhook reads `org_nylas_connections.providerType` to set `communications.medium` to `gmail` or `m365`. Falls back to `gmail` only if a Nylas grant exists with no providerType set (which can't happen given the CHECK constraint, but the fallback is defensive).

**Rationale:** `medium` is a NOT NULL communications column. The Nylas webhook payload doesn't include "this came from a Gmail account" or "this came from M365" — Nylas abstracts it. The org_nylas_connections row is the only place that knows. Reading it on every webhook means we always tag the right value without an additional join later.

**Trade-off accepted:** One extra SELECT per email/meeting webhook (already paid for by the org resolution; the same query returns `providerType` and `organizationId` together).

---

## Carry-overs to M4 (or Phase 1)

1. **Nylas app + OAuth apps (Tasks A, B):** Required before live email/calendar data can flow. Blocks the `/settings/integrations/email-calendar` UI (Task C).
2. **Settings UI (Task C):** Same gap shape as M2 Task 22 — depends on Nango OAuth.
3. **Reducto IDP (Task D):** Phase 1 — turns email attachments into classified `documents` rows.
4. **Cal.com (Task E):** Out of scope until the scheduling agent feature lands.
5. **WDK workflow for async email enrichment (Task G):** Phase 1 — AI summary, sentiment, action items per email thread. The `comms.email.ingest` queue is the entry point.
6. **NeverBounce (Task F):** Phase 1+ — outbound email verification for Resend-based servicer outreach.
7. **Production smoke test (Task H):** After API keys are provisioned in Vercel Environment Variables.
8. **Communication ↔ Party resolution:** `from_party_id` / `to_party_ids` are still nullable on email/meeting rows. Apache AGE entity resolution is M5+.

---

## What changed against the plan

| Plan instruction                                                                   | Reality                                                                                                                                      | Reason                                                                                                                          |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `target: [communications.sourceThreadId]` in ON CONFLICT                           | Switched to `target: communications.vendorEventId`                                                                                           | `source_thread_id` isn't UNIQUE in the schema; would crash at runtime.                                                          |
| Plan's RLS migration used `AS PERMISSIVE FOR ALL TO cema_app_user` with UUID casts | Followed the proven `0011_rls_telephony.sql` pattern instead: no role targeting, text-comparison, `current_setting(name, true)` two-arg form | Consistency with the M2 policies that already pass cross-org isolation tests in PR #53. Two-arg `current_setting` is null-safe. |
| Plan referenced `Communication`, `EmailThread` type imports from `@cema/db`        | Used `typeof communications.$inferSelect` inline (existing codebase pattern)                                                                 | No `Communication` type alias exported; the inline pattern matches `communication-card.tsx`.                                    |
| Plan referenced `Badge` component from `@cema/ui`                                  | Used inline Tailwind classes for badge styling                                                                                               | `@cema/ui` has Button/Card/Input/Label only; introducing Badge for two callsites would be premature abstraction.                |
| Plan example: `client.threads.find(...)` returns `Thread`                          | SDK v7+ wraps in `NylasResponse<Thread>.data`                                                                                                | Typecheck caught the mismatch; both impl and test mock fixed in the same commit.                                                |
| Plan example: `client.events.find({ identifier, eventId })`                        | SDK requires `queryParams.calendarId`                                                                                                        | Typecheck caught the missing field.                                                                                             |
| Plan's `publish()` call omitted the transport arg                                  | Passes `vercelQueueSend` as the third arg per existing M2 contract                                                                           | The typed `publish()` signature requires `(topic, payload, sender)`.                                                            |

---

## Decision implications

- **Forward compat:** The `comms.email.ingest` queue topic is a stable contract — when the Phase 1 enrichment consumer ships, it can replay the dead-letter without changes to the producer.
- **Forward compat:** Storing only Nylas attachment IDs (not binaries) means the Phase 1 Reducto integration can pull what it needs without an M3 migration.
- **Tech debt:** Nylas attachment fetch is deferred; outbound email + calendar is deferred; WDK enrichment is deferred. None are blockers; all are tracked.
- **Risk:** Email body HTML rendered in a same-origin iframe. If a future spec change loads the page from a different origin (CSP move), the iframe sandbox flags may need to widen. Re-evaluate when Phase 1 ships.

---

## References

- Plan: `docs/superpowers/plans/2026-05-22-phase-0-month-3-email-calendar.md`
- Predecessor ADR: `docs/adr/0002-phase-0-month-2-telephony.md`
- Spec anchors: §8.3 (Email), §8.5 (Calendar & Scheduling), §11.1 Month 3, §16.K (Email catalog), §16.M (Calendar catalog).
- Final SHA on `feat/m3-email-calendar`: `e92fa7b` (Task 15) — Task 17 (this ADR) will be one above.
