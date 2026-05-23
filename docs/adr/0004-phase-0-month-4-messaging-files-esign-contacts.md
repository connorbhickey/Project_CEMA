# ADR 0004: Phase 0 Month 4 — Internal Messaging, Files, eSign, and Contacts

**Status:** Accepted (shipped 2026-05-22)
**Author:** Phase 0 Month 4 implementation (Claude Sonnet 4.6 + Connor Hickey)
**Supersedes:** None
**Superseded by:** None

---

## Context

Phase 0 Month 4 (M4) built four canonical integration surfaces that spec §8.2 (internal messaging), §8.4 (document files), §11.1 (eSignature), and §9.1 (contact entity resolution) require before the unified processor workspace can serve a real deal lifecycle. The plan targeted 33 numbered tasks across four subsystems — Slack, Google Drive, DocuSign Connect, and a Postgres-only contact entity-resolution layer — with an explicit rule to skip any task requiring external vendor account registration or production API key provisioning.

The four-subsystem scope decision was deliberate: each subsystem produces a self-contained data surface (slack_messages, drive_files, docusign_envelopes, contacts) that the deal workspace can display without the others. Keeping them in a single month lets the RLS migration (0023) lock all four surfaces under the same access-control pattern in one DDL file, avoiding fragmented policy evolution. The contacts layer is the only one that has no external vendor dependency — it derives its data entirely from existing deal + party rows using deterministic matching — so it was added here rather than deferred to Phase 1.

---

## What shipped

### New workspace packages (4)

| Package                       | Contents                                                                                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@cema/integrations-slack`    | Slack request signature verification (HMAC-SHA256 over `X-Slack-Signature` + timestamp), payload parsers for events and slash commands, Web API client (`postEphemeral`). |
| `@cema/integrations-drive`    | Google Drive REST client: file list (`files.list`), single-file fetch, binary download via signed URL + `fetch`, push-notification channel registration (`watch`).        |
| `@cema/integrations-docusign` | DocuSign Connect HMAC-SHA256 webhook verification, Connect payload parser, envelope creation client using a lazy `require('docusign-esign')` (see decisions §3).          |
| `@cema/contacts`              | Contact normalization (`normalizeEmail`, `normalizePhone` — E.164 with `libphonenumber-js`) and deterministic dedup engine (`findOrCreateContact`).                       |

### Database (7 migrations, 0017–0023)

| Migration                                     | Contents                                                                                                                                                                                                                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `0017_slack_connections.sql`                  | `org_slack_connections` — one row per (org × Slack workspace). UNIQUE on `team_id`.                                                                                                                                                                                            |
| `0018a_slack_connections_org_status_idx.sql`  | Composite index `(organization_id, status)` on `org_slack_connections` — missed in the initial Task 1 schema, added as a follow-up migration to maintain alphabetical ordering.                                                                                                |
| `0019_slack_messages.sql`                     | `slack_messages` 1:1 with `communications` via `communication_id`. Stores `team_id`, `channel_id`, `message_ts` (Slack's natural ID), `user_id`, `text`, `thread_ts`, `subtype`, `blocks` JSONB. UNIQUE on `(team_id, channel_id, message_ts)` for idempotent webhook upserts. |
| `0020_drive_connections_and_files.sql`        | `org_drive_connections` (one row per Google account, stores refresh token) + `drive_files` (mirrors Drive file metadata and blob path). Tasks 9 + 10 merged into one Drizzle generate call.                                                                                    |
| `0021_docusign_connections_and_envelopes.sql` | `org_docusign_connections` (stores JWT credentials) + `docusign_envelopes` (envelope status, JSONB recipients, link to `documents` row, attorney-approval FK). Tasks 16 + 17 merged.                                                                                           |
| `0022_contacts.sql`                           | `contacts` (canonical person record: display name, source, dedup status) + `contact_identities` (normalized email or phone, one row per identity per contact). `contact_identities.organization_id` is a denormalized RLS-helper column (see decisions §7).                    |
| `0023_rls_m4.sql`                             | RLS policies for all M4 tables. Direct `organization_id` equality on connection tables and `contacts`. EXISTS-via-communications join on `slack_messages` and `drive_files`.                                                                                                   |

### Application surfaces (apps/web)

**Webhook routes (3):**

| Route                                | Purpose                                                                                                                                                                                                         |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/api/webhooks/slack/route.ts`    | Handles URL verification challenge, events (`message`, `app_mention`), and slash commands. Signature verification on every request. Upserts comm + slack_message rows, publishes `comms.slack.ingest`.          |
| `app/api/webhooks/drive/route.ts`    | Receives Drive push notifications (channel-token equality check — Google does not sign push notifications). Downloads file bytes, stores in Vercel Blob, upserts `drive_files`. Publishes `files.drive.ingest`. |
| `app/api/webhooks/docusign/route.ts` | DocuSign Connect HMAC-verified webhook. Resolves envelope → org, updates `docusign_envelopes.status`, emits audit event, publishes `esign.docusign.events`.                                                     |

**Server actions (10):**

`list-slack-messages`, `get-slack-message`, `list-drive-files`, `send-envelope` (attorney-review gated), `list-envelopes`, `get-envelope`, `list-contacts`, `get-contact`, `merge-contacts`, `list-contact-suggestions`.

**UI components (7):**

`SlackMessageCard`, `DriveFileCard`, `EnvelopeStatusCard`, `SendEnvelopeButton` (client component with attorney-review gate UI), `ContactCard`, `ContactDetail`, `ContactSuggestionSidebar`.

**New pages (3):**

`/contacts` (index), `/contacts/[id]` (contact detail + merge UI), `/deals/[id]/files` (per-deal Drive file list tab).

### Integration tests (2 new files, 14 assertions)

| File                                          | Assertions                                                                                                                                                                                                                        |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/integration/m4-rls-isolation.test.ts`  | 9 assertions: cross-org isolation for `org_slack_connections`, `slack_messages`, `org_drive_connections`, `drive_files`, `org_docusign_connections`, `docusign_envelopes`, `contacts`, `contact_identities` (direct + EXISTS).    |
| `tests/integration/contact-dedup-e2e.test.ts` | 5 assertions: second source links to same contact for same normalized email; `bob+notes@x` and `BOB@x` treated as same identity; `(212) 555-1234` and `+12125551234` treated as same identity; plus two non-merge boundary cases. |

### Test count

158 tests across 35 test files at the M4 close-out (up from 91 / 19 at M3 close). Unit: 130+. Integration: 28+ (12 M1-M3 + 14 M4 + 2 pre-M4 carryover). All green.

### Queue topics published (3 new, no consumers)

| Topic                   | Payload schema                                                         |
| ----------------------- | ---------------------------------------------------------------------- |
| `comms.slack.ingest`    | `{ orgId, communicationId, teamId, channelId, messageTs, receivedAt }` |
| `files.drive.ingest`    | `{ orgId, driveFileId, blobUrl, mimeType, receivedAt }`                |
| `esign.docusign.events` | `{ orgId, envelopeId, event, receivedAt }`                             |

All three topics are published by the webhook routes but have no consumers. Messages land in dead-letter and become the reprocessable source-of-truth when Phase 1 WDK workflows (AI classification, enrichment) ship.

---

## Skipped tasks and rationale

Twenty-three tasks were deferred per the session rule (skip anything requiring vendor account registration or credentials not yet provisioned). None are blockers for compile/lint/typecheck/test-green.

| Task group                               | Scope                                                       | Reason skipped                                                          |
| ---------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| A — Teams messaging                      | Microsoft Teams webhook + `@cema/integrations-teams`        | Requires Azure app registration + Teams tenant for webhook validation.  |
| B — OneDrive files                       | OneDrive/SharePoint watch + `@cema/integrations-onedrive`   | Requires Azure app registration; mirrors Drive tasks but for M365.      |
| C — Box files                            | Box webhook + `@cema/integrations-box`                      | Requires Box developer account.                                         |
| D — Dropbox files                        | Dropbox webhook + `@cema/integrations-dropbox`              | Requires Dropbox app registration.                                      |
| E — Egnyte files                         | Egnyte webhook + integration package                        | Requires Egnyte account; niche but common at title agents.              |
| F — NetDocs                              | NetDocs webhook + integration package                       | Requires NetDocs account; law-firm DMS out of scope until Phase 1.      |
| G — iManage                              | iManage webhook + integration package                       | Same as NetDocs.                                                        |
| H — Adobe Sign                           | Adobe Sign webhook + `@cema/integrations-adobe-sign`        | Requires Adobe account; DocuSign is primary eSign vendor.               |
| I — PandaDoc                             | PandaDoc webhook + `@cema/integrations-pandadoc`            | Requires PandaDoc account; secondary eSign.                             |
| J — Snapdocs                             | Snapdocs RON integration                                    | Requires Snapdocs account; RON is Phase 2.                              |
| K — Pavaso / Stavvy                      | RON platform integrations                                   | Requires vendor accounts; RON is Phase 2 (spec §14.3).                  |
| L — Reducto IDP                          | Email attachment + Drive file auto-classification           | Requires Reducto account; full IDP is Phase 1.                          |
| M — ClamAV                               | Malware scan for uploaded Drive files                       | Requires ClamAV sidecar or SaaS account; security hardening is Phase 1. |
| N — CRM Merge.dev pulls                  | Salesforce / HubSpot contact pull via Merge.dev             | Requires Merge.dev account + CRM OAuth; enrichment is Phase 1.          |
| O — Clay / Apollo / ZoomInfo             | Contact enrichment services                                 | Requires API keys; enrichment is Phase 1.                               |
| P — ML similarity                        | Vector-based contact dedup (Phase 1 Apache AGE + pgvector)  | Deterministic matching implemented; ML layer is Phase 1 per spec §9.1.  |
| Q — Apache AGE (M5)                      | Knowledge graph entity links                                | Apache AGE is M5; contacts are currently flat Postgres rows.            |
| R — WDK consumers                        | Durable workflows consuming Slack / Drive / DocuSign topics | `@vercel/workflow` not installed; Phase 1 WDK workflows.                |
| S — `/settings/integrations` Slack UI    | Nango OAuth flow for Slack                                  | Depends on Nango provider config + Slack app registration.              |
| T — `/settings/integrations` Drive UI    | Nango OAuth flow for Google Drive                           | Same as S but for Google.                                               |
| U — `/settings/integrations` DocuSign UI | DocuSign JWT consent flow                                   | Requires DocuSign Integration Key setup.                                |
| V — Vercel env var provisioning          | Push vars to Vercel project                                 | Requires real API keys.                                                 |
| W — Production smoke test                | End-to-end with live credentials                            | Requires provisioned keys (same as V).                                  |

---

## Architectural decisions

### 1. Slack URL verification + events + slash commands share one route

**Decision:** `app/api/webhooks/slack/route.ts` handles all three Slack request types: the initial URL verification challenge, event callbacks, and slash command payloads.

**Rationale:** Slack requires a single HTTPS endpoint URL per event subscription and per slash command. Splitting them into three routes would require registering three separate URLs in the Slack app manifest and duplicating the HMAC-SHA256 signature verification middleware. A single route with a type discriminator (`type === 'url_verification'`, `type === 'event_callback'`, payload has `command` field) keeps the verification logic in one place and matches the Slack documentation's recommended pattern.

**Trade-off accepted:** The single handler is slightly larger than three dedicated handlers. A `switch` on payload type keeps it readable.

### 2. Drive push notifications use channel-token equality (Google does not sign push)

**Decision:** Google Drive push notifications are authenticated by checking that the `X-Goog-Channel-Token` header matches the token stored in `org_drive_connections.channel_token` for the channel ID in `X-Goog-Channel-ID`.

**Rationale:** Google's Drive push notification API does not provide an HMAC signature. The channel token is a shared secret generated at channel registration time (`watch` API call) and stored in our DB. An attacker would need to know both the channel ID (which Google sends in plain text) and our random token to forge a notification. This is weaker than HMAC (it doesn't prevent replay), but it matches the `googleapis` documentation and the constraints of the Drive API.

**Trade-off accepted:** No replay protection. A future hardening pass can add an Upstash SETNX check on `X-Goog-Resource-State + channelId + resourceId` to prevent replay attacks (same idempotency pattern as the telephony webhook spec §8.5).

### 3. Drive mirrors files into Vercel Blob; Drive remains source-of-truth

**Decision:** On every push notification, the Drive webhook downloads the file bytes from Google and stores them in Vercel Blob. The `drive_files` row records both the Drive file ID and the Blob URL. The Drive file is not deleted or moved.

**Rationale:** Phase 1 IDP (Reducto) needs durable bytes at a stable URL. If the processor revokes the Google OAuth grant — which happens — the Blob copy survives. Vercel Blob is also in the same cloud region as the Neon database and Next.js functions, so IDP latency is lower than cross-network fetches to Google. Drive remains source-of-truth for the human-readable file (edit, rename, share); our Blob copy is the machine-readable input for IDP.

**Trade-off accepted:** Storage cost: files are stored twice. For mortgage documents (typically 1–20 MB PDFs), this is negligible in Phase 0. A retention policy (scan Blob copies older than `drive_files.blob_mirrored_at + 7 days` and delete if not linked to an IDP document row) is Phase 1.

### 4. DocuSign `sendEnvelope` is the only attorney-review-gated server action; gate runs server-side

**Decision:** The `send-envelope` server action checks `document.attorney_review_required` and throws `Error('attorney-review-required')` if no corresponding `AttorneyApproval` row exists for the document. The check runs inside `withRls()` so it sees only the calling org's data.

**Rationale:** Hard rule #2 of CLAUDE.md: no document with kind in `{cema_3172, exhibit_*, gap_note, gap_mortgage, …}` may be executed or recorded without an `AttorneyApproval` event. An envelope sent via DocuSign is the execution step — the point at which borrowers receive and sign the document. The gate must be server-side (not just client-side UI) so it cannot be bypassed by a direct API call. A server action that throws returns a 500 to the client, which the `SendEnvelopeButton` displays as an error toast.

**Trade-off accepted:** The gate check adds one extra SELECT per `sendEnvelope` call. This is intentional overhead — attorney review is the product's core compliance guarantee.

### 5. Slack `vendor_event_id` composite key: `team:channel:ts`

**Decision:** `communications.vendor_event_id` for Slack messages is set to `${teamId}:${channelId}:${messageTs}`. The `slack_messages` table additionally has a UNIQUE constraint on `(team_id, channel_id, message_ts)` for the natural Slack key.

**Rationale:** Slack's message timestamp (`message_ts`) is unique within a channel but not across channels or teams. A composite key of all three fields is globally unique for a Slack message. The `vendor_event_id` on `communications` provides the cross-table idempotency key (same field used by Twilio for `RecordingSid` and Nylas for `threadId`). The secondary UNIQUE on `slack_messages` provides a faster ON CONFLICT target that avoids hitting the `communications` table in the upsert path.

**Trade-off accepted:** ON CONFLICT on `vendor_event_id` (communications) hits a longer composite string; the `slack_messages` UNIQUE constraint ON CONFLICT is a tighter index. Both are correct; both are used in their respective upsert queries.

### 6. Contacts use deterministic matching only; ML similarity deferred to Phase 1

**Decision:** The `@cema/contacts` dedup engine uses normalized email (lowercase, strip `+suffix`, strip dots in local part for Google addresses) and normalized phone (E.164 via `libphonenumber-js`) as the sole identity keys. No vector similarity, no fuzzy name match.

**Rationale:** Deterministic matching has zero false-positive rate for the identity signals mortgage processors actually have on file — email and phone. For the Phase 0 contact graph, a false positive (two different people merged into one contact) is worse than a false negative (one person with two contact cards). Deterministic matching errs toward false negatives, which surface as duplicate suggestions in the UI rather than silently merged data. Phase 1 will add vector-based name + address similarity (Apache AGE + pgvector) per spec §9.1.

**Trade-off accepted:** Some real duplicates are not caught in Phase 0 (e.g., two email addresses for the same person). The `contact_suggestions` query surfaces these for manual review.

### 7. `contact_identities.organization_id` is a denormalized RLS-helper column

**Decision:** `contact_identities` stores `organization_id` explicitly even though the parent `contacts` row already carries it.

**Rationale:** RLS on `contact_identities` without the denormalized column would require `EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_identities.contact_id AND c.organization_id::text = current_setting(...))`. This EXISTS-join is correct but adds a probe on every row access. For a table that may eventually hold millions of identity rows (one per email/phone per person per org), the direct equality check on a denormalized column is significantly faster. The trade-off is an integrity hazard (org on identity diverging from org on contact), mitigated by a database-level trigger or CHECK that would be added in Phase 1.

**Trade-off accepted:** `organization_id` is duplicated. The application never sets it independently — the backfill engine and `findOrCreateContact` always set it from the contact's org. Phase 1 adds the integrity constraint.

### 8. Three new queue topics published with no consumer (Phase 1 hook)

**Decision:** `comms.slack.ingest`, `files.drive.ingest`, and `esign.docusign.events` are published on every successful webhook upsert. No consumer exists in M4.

**Rationale:** The same pattern as M2 (`comms.twilio.recording`) and M3 (`comms.email.ingest`). Publishing without a consumer gives Phase 1 a replayable event log at zero additional cost — dead-letter messages are reprocessable. The alternative (not publishing until a consumer exists) would require a schema-compatible message format change at Phase 1 time, which is riskier. The queue contract is now stable.

---

## What changed against the plan

| Plan instruction                                                  | Reality                                                                                                         | Reason                                                                                                                                                                                       |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tasks 9 + 10 as two separate migrations                           | Merged into `0020_drive_connections_and_files.sql` (single Drizzle generate call)                               | Both tables have no shared data at migration time; combining them keeps the journal cleaner.                                                                                                 |
| Tasks 16 + 17 as two separate migrations                          | Merged into `0021_docusign_connections_and_envelopes.sql`                                                       | Same rationale as Tasks 9 + 10.                                                                                                                                                              |
| Slack Task 5: `postEphemeral` returns `ok` field, no throw needed | Added `if (!response.ok) throw new Error(...)` + cast cleanup                                                   | The Slack Web API returns `ok: false` on soft errors; silently swallowing them hid failures in test mocks.                                                                                   |
| Slack Task 6: simple ON CONFLICT on `vendor_event_id`             | Added `subtype` guard (skip `message_deleted`, `message_changed`) + natural-key ON CONFLICT on `slack_messages` | `message_deleted` webhooks don't have a `text` field; the guard prevents partial upserts.                                                                                                    |
| Task 1 follow-up: add composite index after initial migration     | `0018a_slack_connections_org_status_idx.sql` added as a separate file to maintain numeric ordering              | Index was missed in the initial `0017` migration; a separate file avoids editing the already-committed migration.                                                                            |
| Task 21 `blobGet` → `signedDownloadUrl`                           | `@vercel/blob` does not export `blobGet`; used `head()` + `fetch(blobUrl)` instead                              | API surface mismatch; `head()` returns the signed URL, `fetch()` streams the bytes.                                                                                                          |
| Task 21 `getCurrentUserId()` → `getCurrentUser()` pattern         | `getCurrentUserId` not exported from `@cema/auth`; used `(await getCurrentUser()).id`                           | Codebase pattern uses the full user object; ID is accessed as a property.                                                                                                                    |
| Task 21 `documents.blobPathname` → `documents.blobUrl`            | Schema column is `blob_url` (full Vercel Blob URL), not a pathname                                              | The Drizzle schema used `blobUrl` from M1; the plan assumed a path-only column.                                                                                                              |
| DocuSign SDK has no TypeScript declarations                       | Locally-defined `DocusignModule` interface + `require('docusign-esign')` cast                                   | No `@types/docusign-esign` on npm; local interfaces provide the type contract.                                                                                                               |
| `import * as dsModule from 'docusign-esign'` (static import)      | Changed to lazy `require('docusign-esign')` inside each function                                                | Turbopack cannot parse the AMD `define()` fallback in `docusign-esign`; lazy require defers to Node.js runtime. Also added `serverExternalPackages: ['docusign-esign']` in `next.config.ts`. |

---

## Carry-overs to M5 (or Phase 1)

1. **Teams messaging (Task A):** Requires Azure app registration. Mirrors Slack tasks.
2. **OneDrive / Box / Dropbox / Egnyte / NetDocs / iManage (Tasks B–G):** All require vendor accounts. File integration breadth is Phase 1.
3. **Adobe Sign / PandaDoc / Snapdocs / Pavaso / Stavvy (Tasks H–K):** Secondary eSign + RON vendors. Primary (DocuSign) shipped.
4. **Reducto IDP (Task L):** Turns Drive file blobs and email attachments into classified `documents` rows. Phase 1.
5. **ClamAV (Task M):** Malware scan on uploaded files. Phase 1 security hardening.
6. **CRM Merge.dev pulls (Task N) + Clay/Apollo/ZoomInfo (Task O):** Contact enrichment from external sources. Phase 1.
7. **ML similarity for contact dedup (Task P):** pgvector + Apache AGE name/address dedup. Phase 1 per spec §9.1.
8. **Apache AGE contact knowledge graph (Task Q):** Full graph linking contacts ↔ parties ↔ deals. M5.
9. **WDK consumers (Task R):** Phase 1 durable workflows for Slack AI summary, Drive IDP, DocuSign status saga.
10. **Settings UI for Slack / Drive / DocuSign OAuth (Tasks S–U):** Depends on Nango provider configs and vendor app registrations.
11. **Vercel env var provisioning + production smoke test (Tasks V–W):** After API keys are provisioned.
12. **Drive push notification replay protection:** Upstash SETNX on `channelId:resourceId:state` (Phase 1 security hardening).
13. **`contact_identities` org integrity constraint:** Database trigger or CHECK enforcing `organization_id` consistency with parent `contacts` row. Phase 1.
14. **Drive Blob retention policy:** Delete Blob copies older than N days if not linked to IDP output. Phase 1.
15. **Communication ↔ Party resolution:** `from_party_id` / `to_party_ids` still nullable on Slack/Drive rows. Apache AGE entity resolution is M5+.
16. **M2–M3 carry-overs (all still pending):** Nango + RingCentral / Dialpad / Zoom Phone; WDK telephony workflow; Upstash telephony idempotency; Nylas OAuth app + Nango config; Cal.com; NeverBounce; recording retention cron.

---

## References

- Plan: `docs/superpowers/plans/2026-05-22-phase-0-month-4-messaging-files-esign-contacts.md` (not yet written at session start; plan was oral / embedded in task instructions)
- Predecessor ADRs: `docs/adr/0001-phase-0-month-1-architecture.md`, `docs/adr/0002-phase-0-month-2-telephony.md`, `docs/adr/0003-phase-0-month-3-email-calendar.md`
- Spec anchors: §8.2 (Slack / internal messaging), §8.4 (Drive / file management), §11.1 (eSignature), §9.1 (Contacts / entity resolution), §16.D (Slack catalog), §16.E (Drive catalog), §16.F (DocuSign catalog).
- Final SHA on `feat/m4-messaging-files-esign-contacts` before Task 32: `add1997`; Task 32 SHA: `f39d3cc`.
