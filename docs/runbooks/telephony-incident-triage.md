# Telephony Incident Triage Runbook

**Last updated:** 2026-05-22
**Owners:** Engineering
**Related ADR:** `docs/adr/0002-phase-0-month-2-telephony.md`
**Related spec:** `docs/superpowers/specs/2026-05-12-cema-ai-processor-design.md` §8.2, §11.1

---

## Quick-reference: symptom → section

| Symptom                                               | Section                                                                            |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Twilio webhook returning 500 / HMAC error             | [§1 Twilio webhook failing](#1-twilio-webhook-failing)                             |
| Deepgram webhook returning 500 / HMAC error           | [§2 Deepgram webhook failing](#2-deepgram-webhook-failing)                         |
| Call initiated but no `communications` row created    | [§3 Communication row missing after dial](#3-communication-row-missing-after-dial) |
| Recording available in Twilio but no blob / no DB row | [§4 Recording not ingested](#4-recording-not-ingested)                             |
| Recording ingested but transcript never appears       | [§5 Transcript missing or stuck](#5-transcript-missing-or-stuck)                   |
| Click-to-call fails before Twilio is reached          | [§6 Outbound call fails at server action](#6-outbound-call-fails-at-server-action) |

---

## Architecture recap

```
Processor clicks "Call" in UI
    ↓  initiateOutboundCall() server action
    ↓  tcpaGuard() → Twilio REST API → pre-creates communications row
    ↓
Twilio dials → two-party disclosure TwiML plays → call connects
    ↓ (after call ends)
Twilio POSTs /api/webhooks/twilio (recording-status callback)
    ↓  HMAC-SHA1 verification → publish to Vercel Queue
    ↓  (queue consumer — NOT YET IMPLEMENTED, see ADR §carry-overs)
    ↓  TODO M3: Vercel WDK workflow: download recording → Blob → Deepgram submit
    ↓
Deepgram POSTs /api/webhooks/deepgram
    ↓  HMAC-SHA256 verification → parse transcript → Blob → DB update
```

**Current M2 gap (no WDK workflow yet):** The queue consumer that bridges the Twilio recording-status callback to Deepgram submission is not yet implemented. After receiving the Twilio callback, the system publishes to the queue but nothing consumes it. Transcription is not yet end-to-end wired. See ADR carry-overs.

---

## 1. Twilio webhook failing

**Symptoms:** Twilio dashboard shows recording-status callback delivery failure (HTTP 4xx / 5xx). Vercel logs show `403 Forbidden` or unhandled exception on `POST /api/webhooks/twilio`.

### Step 1 — Verify HMAC-SHA1 signature

The webhook route (`apps/web/app/api/webhooks/twilio/route.ts`) calls `verifyTwilioSignature()` from `@cema/integrations-twilio` before any processing.

Check that `TWILIO_AUTH_TOKEN` is set in the Vercel environment:

```bash
vercel env ls --environment production | grep TWILIO_AUTH_TOKEN
```

If missing, add it:

```bash
vercel env add TWILIO_AUTH_TOKEN production
```

Check the request URL Twilio signed against. Twilio uses the full canonical URL (including `https://` and query string) in the HMAC. If you changed the domain or the route path, Twilio's stored callback URL is stale.

**Update callback URL in Twilio Console:** Voice → Phone Numbers → your number → Recording Status Callback URL.

### Step 2 — Check Vercel function logs

```bash
vercel logs --filter "webhooks/twilio" --since 1h
```

Look for:

- `TwilioSignatureInvalid` → env var or URL mismatch (see Step 1)
- `QueuePublishError` → Vercel Queue issue (check Vercel dashboard → Queues)
- Unhandled exception stack → open a bug with the full trace

### Step 3 — Verify Twilio is actually calling the right URL

In Twilio Console → Monitor → Logs → Errors, find the recording-status callback attempt. Confirm the "To URL" matches `https://<your-domain>/api/webhooks/twilio`.

### Step 4 — Force-replay from Twilio

Twilio retries recording-status callbacks automatically for up to 24 hours with exponential backoff. If the issue is resolved (env var fixed), the retry should arrive without manual action. If the 24h window has passed, the callback is lost — you must manually re-trigger from the Twilio Console (Monitor → Logs → find the specific SID → "Replay").

---

## 2. Deepgram webhook failing

**Symptoms:** Transcript never appears. Deepgram dashboard shows callback delivery failure. Vercel logs show error on `POST /api/webhooks/deepgram`.

### Step 1 — Verify HMAC-SHA256 signature

The webhook route calls `verifyDeepgramSignature()` from `@cema/integrations-deepgram`.

```bash
vercel env ls --environment production | grep DEEPGRAM_WEBHOOK_SECRET
```

If missing or rotated, update via Vercel env and rotate in the Deepgram Console → API Keys.

### Step 2 — Find the Deepgram request_id

Every Deepgram batch submission stores its `request_id` in `recordings.vendor_request_id`. Query (Drizzle Studio or psql):

```sql
SELECT id, vendor_request_id, transcript_status, transcript_blob_url
FROM recordings
WHERE communication_id = '<comm-id>';
```

If `vendor_request_id` is NULL: the recording was never submitted to Deepgram (upstream gap — see §5).

If `vendor_request_id` is set: use it to check Deepgram's job status via their REST API:

```bash
curl -H "Authorization: Token $DEEPGRAM_API_KEY" \
  "https://api.deepgram.com/v1/listen/$VENDOR_REQUEST_ID"
```

### Step 3 — Manual transcript retry

If the Deepgram job succeeded but the webhook delivery failed:

1. Download the transcript JSON from Deepgram (use `request_id` from Step 2).
2. Parse it through `parseTranscriptResponse()` in `@cema/integrations-deepgram`.
3. Upload the result to Vercel Blob at `org/<org-id>/communications/<comm-id>/transcript.json`.
4. Update the `recordings` row directly:

```sql
UPDATE recordings
SET transcript_blob_url = '<blob-url>',
    transcript_status   = 'ready',
    updated_at          = NOW()
WHERE id = '<rec-id>';
```

### Step 4 — Check Vercel function logs

```bash
vercel logs --filter "webhooks/deepgram" --since 1h
```

Look for:

- `DeepgramSignatureInvalid` → env var / secret mismatch
- `BlobPutError` → Vercel Blob quota or permissions issue
- DB update error → check Neon connection / RLS context (webhook uses `neondb_owner`, not `cema_app_user`)

---

## 3. Communication row missing after dial

**Symptom:** Processor clicked "Call" and Twilio confirmed the call was initiated, but `communications` table has no row.

### Step 1 — Check the server action error

The `initiateOutboundCall()` server action pre-creates a `communications` row with `status='pending'` before dialing. If the Twilio REST call itself failed (e.g., bad credentials), the row was still created. If the DB insert failed, Twilio was never called.

Check Vercel function logs for the server action:

```bash
vercel logs --filter "initiate-outbound-call" --since 2h
```

### Step 2 — Check TCPA guard

`tcpaGuard(party)` throws `TcpaConsentMissingError` for borrower-type parties without `tcpa_opt_in = true`. The UI's click-to-call modal should catch this and show an error message.

Verify the party's TCPA status:

```sql
SELECT id, party_type, tcpa_opt_in, tcpa_opt_in_at
FROM parties
WHERE id = '<party-id>';
```

If `tcpa_opt_in = false`: the call was correctly blocked. The processor must obtain consent before calling this party (out-of-band process). See spec §12.2 and hard rule #4 in CLAUDE.md.

### Step 3 — Check for DB constraint violations

Likely candidates:

- `communications_provider_vendor_call_id_uidx`: unique on `(provider, vendor_call_id)` for non-null values. Multiple pre-created rows with `vendor_call_id = NULL` are allowed (Postgres NULL semantics), so this should not trigger.
- `CHECK (kind = 'call' AND provider IS NOT NULL)`: server action always sets provider before inserting, so this should not trigger unless the party's telephony provider is unresolvable.

---

## 4. Recording not ingested

**Symptom:** Call completed, but the `recordings` table has no row and/or no blob at `org/<org-id>/communications/<comm-id>/recording.wav`.

**Current M2 context:** The full ingest pipeline (Twilio callback → queue → WDK workflow → blob upload → Deepgram submit) is not yet implemented. The Twilio webhook publishes to the queue, but the consumer is a M3 carry-over. This symptom is expected behavior in M2.

### Step 1 — Confirm Twilio delivered the callback

In Twilio Console → Monitor → Logs → Recording Status Callbacks:

- Did Twilio attempt delivery? If not, check that the recording is enabled on the call (verify `buildOutboundTwiml()` includes the `<Record>` verb with the correct `recordingStatusCallback` URL).
- Did delivery succeed (HTTP 200)? If not, follow §1.

### Step 2 — Confirm queue publish succeeded

Vercel Queues dashboard → find the topic → inspect pending / dead-letter messages.

If the message is in dead-letter: the queue consumer errored. Since the consumer is not yet implemented (M3), this is expected.

### Step 3 — Manual recording ingest (emergency path)

Until the WDK workflow ships in M3, use this manual path:

1. Download the recording from Twilio:

```bash
curl -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" \
  "https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID/Recordings/<recording-sid>.wav" \
  -o recording.wav
```

2. Upload to Vercel Blob (use `put()` from `@cema/blob`):

```bash
# Or via a one-off script using @cema/blob put()
# Target path: org/<org-id>/communications/<comm-id>/recording.wav
```

3. Create / update the `recordings` row:

```sql
INSERT INTO recordings (
  communication_id, recording_blob_url, recording_blob_pathname,
  retention_until, legal_hold, consent_disclosure_emitted_at
)
VALUES (
  '<comm-id>',
  'https://<vercel-blob-url>/org/<org-id>/communications/<comm-id>/recording.wav',
  'org/<org-id>/communications/<comm-id>/recording.wav',
  NOW() + INTERVAL '7 years',
  false,
  NOW()  -- confirm disclosure was emitted by TwiML
)
ON CONFLICT (communication_id) DO UPDATE
  SET recording_blob_url = EXCLUDED.recording_blob_url,
      recording_blob_pathname = EXCLUDED.recording_blob_pathname;
```

4. Update `communications.status` to `'ready'`:

```sql
UPDATE communications SET status = 'ready' WHERE id = '<comm-id>';
```

---

## 5. Transcript missing or stuck

**Symptom:** Recording is visible in the audio player, but the transcript section shows "Transcript not yet available." The `recordings.transcript_status` is `'pending'` or `NULL`.

**Current M2 context:** Deepgram submission is triggered by the WDK workflow (M3 carry-over). In M2, transcription is not automatically triggered after recording ingest.

### Step 1 — Check transcript_status

```sql
SELECT id, vendor_request_id, transcript_status, transcript_blob_url, updated_at
FROM recordings
WHERE communication_id = '<comm-id>';
```

| `transcript_status` | Meaning                         |
| ------------------- | ------------------------------- |
| `NULL` / `pending`  | Not yet submitted to Deepgram   |
| `processing`        | Submitted, waiting for callback |
| `ready`             | Transcript available in blob    |
| `failed`            | Deepgram returned an error      |

### Step 2 — Manual Deepgram submission (emergency path)

If `vendor_request_id` is NULL, the recording was never submitted. Submit manually:

```typescript
import { submitBatch } from '@cema/integrations-deepgram';

const { requestId } = await submitBatch({
  audioUrl: recording.recordingBlobUrl,
  callbackUrl: `https://<your-domain>/api/webhooks/deepgram`,
});

// Update vendor_request_id on the recordings row
await db
  .update(recordings)
  .set({ vendorRequestId: requestId, transcriptStatus: 'processing' })
  .where(eq(recordings.id, recId));
```

### Step 3 — If `transcript_status = 'failed'`

Check Deepgram's error via the API:

```bash
curl -H "Authorization: Token $DEEPGRAM_API_KEY" \
  "https://api.deepgram.com/v1/listen/$VENDOR_REQUEST_ID"
```

Common Deepgram errors:

- `400 Bad Request`: audio format unsupported. Confirm `.wav` or `.mp3`.
- `402 Payment Required`: Deepgram account quota exhausted. Check Deepgram Console → Usage.
- `422 Unprocessable`: audio is silent / corrupt. Verify the blob download works.

Re-submit with `submitBatch()` after fixing the root cause. Reset `transcript_status = 'pending'` on the recordings row first so the UI doesn't show a stale error.

### Step 4 — Verify callback URL reachability

Deepgram must reach `https://<your-domain>/api/webhooks/deepgram`. If the domain changed or the route is behind auth middleware, callbacks will fail silently.

Test reachability:

```bash
curl -X POST https://<your-domain>/api/webhooks/deepgram \
  -H "Content-Type: application/json" \
  -d '{"intentionally": "invalid"}'
# Expected: 401 Unauthorized (HMAC check fails) — not a 404 or 502
```

---

## 6. Outbound call fails at server action

**Symptom:** Processor sees an error toast after clicking "Call". No Twilio call was initiated.

### Step 1 — Check error type

The `initiateOutboundCall()` action can throw:

| Error                     | Meaning                                           | Fix                                                       |
| ------------------------- | ------------------------------------------------- | --------------------------------------------------------- |
| `TcpaConsentMissingError` | Party has no TCPA opt-in                          | Obtain consent; do not bypass                             |
| `DncCheckError`           | DNC guard (Phase 3 stub, currently always passes) | Should not fire in M2                                     |
| Twilio REST error         | Bad credentials or account suspended              | Check `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` env vars |
| DB insert error           | Schema constraint violated                        | See §3 Step 3                                             |

### Step 2 — Verify Twilio env vars

```bash
vercel env ls --environment production | grep -E "TWILIO_ACCOUNT_SID|TWILIO_AUTH_TOKEN|TWILIO_FROM_NUMBER"
```

All three must be set. `TWILIO_FROM_NUMBER` must be an E.164 number owned by your Twilio account and capable of outbound voice.

### Step 3 — Test Twilio credentials independently

```bash
curl -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" \
  "https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID.json"
# Expected: 200 with account JSON
```

---

## Environment variables checklist

| Var                       | Where used                            | Required for                        |
| ------------------------- | ------------------------------------- | ----------------------------------- |
| `TWILIO_ACCOUNT_SID`      | `initiateOutboundCall`, Twilio client | Outbound dial                       |
| `TWILIO_AUTH_TOKEN`       | HMAC-SHA1 verification, Twilio client | Webhook auth + dial                 |
| `TWILIO_FROM_NUMBER`      | `initiateOutboundCall`                | Caller-ID on outbound calls         |
| `TWILIO_TWIML_APP_SID`    | (future)                              | Not used in M2                      |
| `DEEPGRAM_API_KEY`        | `submitBatch()`                       | Transcription submission            |
| `DEEPGRAM_WEBHOOK_SECRET` | HMAC-SHA256 verification              | Webhook auth                        |
| `NANGO_SECRET_KEY`        | Nango SDK client                      | OAuth integration management        |
| `BLOB_READ_WRITE_TOKEN`   | `@cema/blob`                          | Recording + transcript blob storage |

All vars must exist in the `production` Vercel environment. Preview environments inherit from Vercel's preview env layer — verify independently with `vercel env ls --environment preview`.

---

## On-call escalation

1. **P1 (TCPA / recording compliance):** Any incident where a call was placed or recorded without disclosure or consent → page Connor immediately. Do not attempt to "quietly fix" compliance violations.
2. **P2 (data loss):** Recording blob or transcript blob cannot be retrieved → stop using the affected Blob path, open a Vercel support ticket.
3. **P3 (webhook failures):** Follow the triage steps above. If unresolvable within 2 hours, manually ingest using the emergency paths in §4 / §5.
