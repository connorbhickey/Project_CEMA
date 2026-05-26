# ADR 0008: Phase 0 Month 8 — Telephony Entity Resolution

**Status:** Accepted (shipped 2026-05-23)
**Author:** Phase 0 Month 8 implementation (Claude Sonnet 4.6 + Connor Hickey)
**Supersedes:** None
**Superseded by:** None

---

## Context

Phase 0 Month 7 wired `comms.embed` publish from the Nylas and Slack webhook handlers, added `indexCommunication` and `indexDocument` Typesense sync in the embed consumers, and implemented communication→party entity resolution via `contact_identities` → `kg_edges` for email (`kind='email'`) and Slack (`kind='slack_user'`). One gap remained: telephony communications — Twilio recording-complete callbacks never published to `comms.embed`, and phone numbers had no representation in `contact_identities`. This meant phone calls were never embedded and party resolution never ran for them.

M8 closes this gap in three steps: (1) publishing `comms.embed` from the Twilio webhook, (2) seeding `contact_identities` with phone and email entries when a contact is linked to a party (the prerequisite data for resolution), and (3) extending `resolveCommParties` to look up `kind='phone'` identities using `comm.fromE164`/`toE164` from the communication row.

---

## What shipped

### Twilio webhook (1 file modified)

| File                                        | Change                                                                                        |
| ------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `apps/web/app/api/webhooks/twilio/route.ts` | Publishes `comms.embed` after `telephony.call.ingest` publish on recording-complete callbacks |

Both publishes are `await`-ed (synchronous with the webhook handler) to guarantee queue delivery before returning 200.

### `linkContactToParty` seeding (1 file modified)

| File                                            | Change                                                                                                                                                                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web/lib/actions/link-contact-to-party.ts` | After `addEdge` calls, fetches contact row; upserts `contact_identities` for `kind='email'` (via `normalizeEmail`) and `kind='phone'` (via `normalizePhone`) with `source='party'` and `onConflictDoNothing` |

Uses `normalizeEmail` / `normalizePhone` from `@cema/contacts` to match the canonical form used by `ensureContact` and all other write paths — prevents silent resolution failures from plus-aliased emails or non-E.164 phone numbers.

### Phone entity resolution in `resolveCommParties` (1 file modified)

| File                                                   | Change                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web/app/api/queues/embed-communication/route.ts` | Extended `resolveCommParties` with `lookupPhones` from `comm.fromE164`/`toE164`; added `kind='phone'` contactIdentities query; renamed `emailToContact` → `identityToContact`; `fromKey = emailFrom ?? slackUser ?? phoneFrom`; `toPartyIds = [...emailsTo, ...phoneTo]` |

### Unit tests (8 new assertions)

| File                                | New assertions                                                                                 |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| `twilio/route.test.ts`              | 1 (comms.embed published for completed recording)                                              |
| `link-contact-to-party.test.ts`     | 5 (email+phone seeding, email-only, phone-only, no-identity skip, addEdge error propagation)   |
| `embed-communication/route.test.ts` | 2 (fromE164 → fromPartyId, toE164 → toPartyIds) + payload assertions on all 3 resolution tests |

### Test count

240 tests across 55 test files at M8 close-out (up from 232 / 55 at M7 close). All green. Typecheck clean.

---

## Skipped tasks and rationale

| Task                                       | Reason skipped                                                                                                 |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Typesense Cloud provisioning               | Requires Typesense Cloud account + API key. Runbook exists at `docs/runbooks/m7-env-var-provisioning.md`.      |
| Mem0 live provisioning                     | Requires Mem0 API key. Same runbook.                                                                           |
| Vercel env var sync + smoke test           | Deferred until API keys provisioned.                                                                           |
| Deepgram transcript → `contact_identities` | Deepgram events don't carry caller phone — the Twilio CallSid lookup via `comm.fromE164`/`toE164` covers this. |

---

## Architectural decisions

### 1. Seed `contact_identities` at `linkContactToParty` rather than at contact create/update

**Decision:** `contact_identities` rows are seeded when `linkContactToParty` is called, not when a contact's `primaryEmail` / `primaryPhone` is first set.

**Rationale:** Entity resolution only matters for contacts that are parties to deals. A contact without a party link cannot be a `fromPartyId` / `toPartyIds` target, so seeding on contact upsert would populate rows that are never queried. YAGNI — seed only when the data becomes actionable. The `onConflictDoNothing` idempotency guard means calling `linkContactToParty` multiple times is safe.

**Trade-off accepted:** A contact whose email/phone changes after the party link is created will have a stale `contact_identities` row. A future task can add a contact-update trigger or re-seed on `updateContact`. At Phase 0 scale this is irrelevant.

### 2. Use `normalizeEmail` / `normalizePhone` from `@cema/contacts`, not ad-hoc normalization

**Decision:** Both seeding paths use the shared normalizers from `packages/contacts/src/normalize.ts` rather than `.toLowerCase()` (for email) or a pass-through (for phone).

**Rationale:** The embed consumer's `resolveCommParties` queries `contact_identities.normalizedValue` using values extracted from `emailThread.fromEmail` (lowercased) and `comm.fromE164` (E.164 from Twilio). If the seeded value doesn't match the query key exactly, resolution silently fails. `normalizeEmail` handles plus-alias stripping (`alice+cema@example.com` → `alice@example.com`) and whitespace trimming; `normalizePhone` converts any parseable US number to E.164. Both functions are already the standard across `ensureContact`, the Nylas/Slack webhook handlers, and `backfill.ts`.

**Trade-off accepted:** If `normalizeEmail` or `normalizePhone` returns null (invalid/unparseable value), the identity row is silently skipped. This is the correct behavior — an unresolvable address is not a useful lookup key.

### 3. `fromKey = emailFrom ?? slackUser ?? phoneFrom` priority order

**Decision:** When resolving `fromPartyId`, a single `fromKey` selects the first non-null identity in priority order: email → Slack → phone.

**Rationale:** A communication row typically has only one channel. The priority order reflects identity stability: email addresses are most stable and unique, Slack user IDs are organization-scoped and stable, phone numbers are least stable (ported, shared VoIP lines). In practice the chain almost always reaches the one non-null value without competition.

**Trade-off accepted:** A hypothetical comm with both `emailThread.fromEmail` and `comm.fromE164` set (unusual) resolves `fromPartyId` by email and ignores the phone identity. This is the correct behavior — email resolution is more reliable.

### 4. `toPartyIds = [...emailsTo, ...phoneTo]` — `phoneTo` is scalar-wrapped

**Decision:** `toE164` is a `varchar(20)` scalar on `communications`, not an array. It is wrapped as `comm.toE164 ? [comm.toE164] : []` before spreading into `toKeys`.

**Rationale:** Phone calls have exactly one destination number in this model (PSTN point-to-point). The wrap-in-array pattern makes the spread into `toKeys` consistent with how `emailsTo` (always an array) is handled. If the schema later gains a multi-party telephony model, this single line changes to an array column without touching the resolution logic.

---

## What changed against the plan

| Plan instruction                    | Reality                                | Reason                                                                                                                            |
| ----------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `6 tests` for Task 2                | 8 tests implemented                    | Spec compliance review found missing phone-only test + addEdge error propagation test; payload assertions added in quality review |
| `contact fetch before addEdge`      | Contact fetch moved to after addEdge   | Spec compliance review corrected ordering                                                                                         |
| `contact.primaryPhone` pass-through | `normalizePhone(contact.primaryPhone)` | Code quality review caught the dual-write-path normalization mismatch                                                             |

---

## Carry-overs to M9 (or Phase 1)

1. **Typesense Cloud provisioning:** `TYPESENSE_API_KEY`, `TYPESENSE_HOST` env vars needed in Vercel. Runbook at `docs/runbooks/m7-env-var-provisioning.md`.
2. **Mem0 live provisioning:** `MEM0_API_KEY` env var needed in Vercel. Same runbook.
3. **Vercel env var sync + production smoke test:** After Typesense + Mem0 API keys provisioned.
4. **All M2–M7 carry-overs still pending** (Nango + telephony vendors; WDK workflows; Nylas OAuth; Cal.com; NeverBounce; CRM enrichment; Drive Blob retention; Drive replay protection).

---

## References

- Plan: `docs/superpowers/plans/2026-05-23-phase-0-month-8-telephony-entity-resolution.md`
- Predecessor ADRs: `docs/adr/0001` through `docs/adr/0007`
- Runbook: `docs/runbooks/m7-env-var-provisioning.md`
- Spec anchors: §9.1 (Knowledge graph / entity resolution), §10 (Search + Memory), §16 (Integration catalog — Typesense, Mem0, embed pipeline).
- Final SHA on `feat/m8-telephony-entity-resolution`: d931f23
