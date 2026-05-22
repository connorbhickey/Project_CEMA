import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { communications } from './communications';

// ---------------------------------------------------------------------------
// recordings — audio + transcript metadata for a Communication of kind=call.
// One-to-one with communications today (a call has at most one recording);
// the FK is per-row rather than a column on communications because future
// work may attach multiple media artifacts per comm (e.g., screen-share
// video in Phase 3) without a schema migration.
//
// Storage: actual audio bytes and transcript JSON live in Vercel Blob;
// this row holds the URLs + pathnames + retention controls. CLAUDE.md
// hard rule #5 (recording disclosure) is tracked via
// consent_disclosure_emitted_at. 7-year mortgage-industry retention per
// spec §8.2 + §10.3 is encoded in retention_until.
// ---------------------------------------------------------------------------
export const recordings = pgTable(
  'recordings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // Cascade: a recording is part of a communication. If the comm row is
    // hard-deleted (rare; soft-delete is the norm), the recording follows.
    communicationId: uuid('communication_id')
      .notNull()
      .references(() => communications.id, { onDelete: 'cascade' }),
    // Vercel Blob URL — the long-lived blob URL, not a signed download URL.
    // Application code generates short-lived signed URLs on each download
    // via packages/blob (M2 Task 7).
    recordingBlobUrl: text('recording_blob_url').notNull(),
    recordingBlobPathname: text('recording_blob_pathname').notNull(),
    recordingBytes: bigint('recording_bytes', { mode: 'number' }),
    recordingDurationSeconds: integer('recording_duration_seconds'),
    // e.g. 'audio/wav', 'audio/mpeg', 'audio/mp4'
    mimeType: varchar('mime_type', { length: 64 }),
    // Transcript fields are populated by the Deepgram callback (M2 Task 19).
    // Nullable until transcription completes.
    transcriptBlobUrl: text('transcript_blob_url'),
    transcriptBlobPathname: text('transcript_blob_pathname'),
    transcriptWordsCount: integer('transcript_words_count'),
    // e.g. 'en-US', 'es-419' — short BCP-47 language tags
    transcriptLanguage: varchar('transcript_language', { length: 8 }),
    // e.g. 'deepgram-nova-3', 'whisper-large-v3' — identifies the model
    // that produced the transcript. Lets us re-run when models update.
    transcriptProvider: varchar('transcript_provider', { length: 32 }),
    // Hard rule #5: per-recording timestamp of when the two-party
    // disclosure was emitted to the callee. Mirrors
    // parties.recording_disclosure_confirmed_at but at the recording
    // grain (a single party can be on many calls).
    consentDisclosureEmittedAt: timestamp('consent_disclosure_emitted_at', {
      withTimezone: true,
    }),
    // Legal-hold flag suspends the soft-delete path (and Phase 1 retention
    // cron). Set by ops or attorney via an admin UI when a deal is under
    // active litigation hold.
    legalHold: boolean('legal_hold').notNull().default(false),
    // Set at creation to now() + 7 years per spec §8.2 + §10.3. The
    // retention cron (Phase 1) scans `retention_until < now() AND
    // legal_hold = false` and soft-deletes matching rows. CHECK below
    // ensures the value is always future-dated relative to creation.
    retentionUntil: timestamp('retention_until', { withTimezone: true }).notNull(),
    // Soft-delete: clears the blob URL paths and Phase 1 cron purges the
    // actual blobs after a grace period. Hard delete is never done by the
    // application; ops-level Blob deletion would bypass this and is the
    // out-of-scope risk noted in M2 plan §8 risk 7.
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [
    // FK index + 1:1 invariant: today a communication has at most one
    // recording. Enforcing UNIQUE here makes the 1:1 a DB-level guarantee
    // rather than an application convention; the workflow's upsert keyed
    // on communication_id stays correct, and future relaxation (multiple
    // media artifacts per comm in Phase 3) would be an explicit schema
    // change rather than silent data sprawl.
    uniqueIndex('recordings_communication_id_uidx').on(t.communicationId),
    // Lifecycle cron's primary filter column (Phase 1).
    index('recordings_retention_until_idx').on(t.retentionUntil),
    // Retention must be in the future of the creation moment. Defense
    // against application bugs that compute a bad retention_until.
    check('recordings_retention_future', sql`${t.retentionUntil} > ${t.createdAt}`),
    // Hard rule #6 (CLAUDE.md): legal hold must block deletion. A row
    // can be soft-deleted only when not under hold. Lifting a hold is a
    // separate operation; deletion-then-hold cannot be reordered.
    check(
      'recordings_no_delete_under_legal_hold',
      sql`${t.deletedAt} IS NULL OR ${t.legalHold} = false`,
    ),
    // Numeric metric invariants — mirror the communications_duration_nonneg
    // guard. All three columns are nullable (pre-Deepgram for transcript
    // fields; pre-ingest-finalization for bytes/duration) so the NULL
    // case is allowed, but a negative populated value is always a bug.
    check(
      'recordings_recording_bytes_nonneg',
      sql`${t.recordingBytes} IS NULL OR ${t.recordingBytes} >= 0`,
    ),
    check(
      'recordings_recording_duration_nonneg',
      sql`${t.recordingDurationSeconds} IS NULL OR ${t.recordingDurationSeconds} >= 0`,
    ),
    check(
      'recordings_transcript_words_nonneg',
      sql`${t.transcriptWordsCount} IS NULL OR ${t.transcriptWordsCount} >= 0`,
    ),
  ],
);
