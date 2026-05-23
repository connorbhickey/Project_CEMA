import { sql } from 'drizzle-orm';
import {
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const vector3072 = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return 'vector(3072)';
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: string): number[] {
    return value
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map(Number);
  },
});

import { deals } from './deals';
import {
  communicationDirectionEnum,
  communicationKindEnum,
  communicationMediumEnum,
  communicationStatusEnum,
  telephonyProviderEnum,
} from './enums';
import { parties } from './parties';
import { organizations } from './tenants';

// ---------------------------------------------------------------------------
// communications — the queryable layer for every call/email/SMS/IM/meeting
// that touches a Deal. Spec §6.5. Lean by design: bulky storage references
// (recording audio, transcript JSON) live in the separate `recordings` table
// so this table stays index-friendly for timeline queries.
//
// Lifecycle: webhook handler upserts a row with status='pending' →
// telephony.call.ingest workflow flips to 'ingested' after blob upload →
// 'transcribing' after Deepgram submit → 'ready' after callback persists
// transcript JSON. 'failed' is the terminal state set on unrecoverable
// errors.
// ---------------------------------------------------------------------------
export const communications = pgTable(
  'communications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // onDelete: 'restrict' — organizations use soft-delete (deleted_at),
    // never hard-delete. Cascade would silently delete comms history.
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    // Nullable per spec §6.5 — some comms aren't deal-linked yet
    // (e.g. an inbound borrower call before intake creates the Deal).
    dealId: uuid('deal_id').references(() => deals.id),
    kind: communicationKindEnum('kind').notNull(),
    direction: communicationDirectionEnum('direction').notNull(),
    medium: communicationMediumEnum('medium').notNull(),
    // Nullable for non-call kinds (email/IM/letter/fax don't have a PBX).
    provider: telephonyProviderEnum('provider'),
    // The vendor's call ID — used for cross-platform dedupe along with
    // `provider` (unique together). Nullable for pre-created outbound rows
    // (Twilio click-to-call pre-creates with NULL, fills on status callback).
    vendorCallId: varchar('vendor_call_id', { length: 128 }),
    // The vendor's webhook event ID — used as the idempotency key on the
    // inbound webhook handler. The Upstash Redis SETNX cache is the first
    // line of defense; this UNIQUE column is the second-line guarantee at
    // the DB level. Nullable for outbound rows pre-created before any
    // vendor event has arrived.
    vendorEventId: varchar('vendor_event_id', { length: 128 }),
    // Nullable: party resolution lags webhook arrival. The from_e164 /
    // to_e164 raw numbers are set on insert; party FKs get filled later
    // by an entity-resolution step (M3+ via Apache AGE knowledge graph
    // per spec §6.7 / per plan §9 open question 5).
    fromPartyId: uuid('from_party_id').references(() => parties.id),
    // Postgres uuid[] for multi-recipient calls / conference legs.
    // No FK enforcement on array elements — app layer validates.
    toPartyIds: uuid('to_party_ids').array(),
    fromE164: varchar('from_e164', { length: 20 }),
    toE164: varchar('to_e164', { length: 20 }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    durationSeconds: integer('duration_seconds'),
    // Vendor's thread / conversation id (e.g. a Slack thread ts, an email
    // Message-ID + In-Reply-To chain). Lets us group related comms.
    sourceThreadId: varchar('source_thread_id', { length: 128 }),
    status: communicationStatusEnum('status').notNull().default('pending'),
    // AI fields are populated by Phase 1 agent passes; M2 leaves them empty
    // so the schema is stable when those agents come online.
    aiSummary: text('ai_summary'),
    aiActionItems: jsonb('ai_action_items').$type<unknown[]>().default([]).notNull(),
    aiSentiment: varchar('ai_sentiment', { length: 16 }),
    embedding: vector3072('embedding'),
    embeddingGeneratedAt: timestamp('embedding_generated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [
    // Idempotency: the webhook handler dedupes on vendor_event_id; this is
    // the DB-side guarantee that two concurrent webhook deliveries for the
    // same event can't both insert.
    uniqueIndex('communications_vendor_event_id_uidx').on(t.vendorEventId),
    // Per-vendor call dedupe: (provider, vendor_call_id) is the natural
    // key for a call across the ingest pipeline. Workflow upsert uses
    // ON CONFLICT (provider, vendor_call_id) DO UPDATE.
    uniqueIndex('communications_provider_vendor_call_id_uidx').on(t.provider, t.vendorCallId),
    // Primary timeline queries: org-scoped reverse-chronological feed
    // (the Communications inbox per spec §8.9). Deal-page timeline is a
    // narrower filter on the same shape.
    index('communications_org_started_at_idx').on(t.organizationId, t.startedAt),
    index('communications_deal_started_at_idx').on(t.dealId, t.startedAt),
    // FK indexes — Postgres does NOT auto-create.
    index('communications_organization_id_idx').on(t.organizationId),
    index('communications_deal_id_idx').on(t.dealId),
    index('communications_from_party_id_idx').on(t.fromPartyId),
    // A call always has a provider; non-call kinds (email/IM) may have
    // provider=NULL. Enforces the kind↔provider invariant at insert.
    check(
      'communications_call_requires_provider',
      sql`${t.kind} <> 'call' OR ${t.provider} IS NOT NULL`,
    ),
    // Duration in seconds: NULL allowed (pre-completion or non-call),
    // but never negative.
    check(
      'communications_duration_nonneg',
      sql`${t.durationSeconds} IS NULL OR ${t.durationSeconds} >= 0`,
    ),
  ],
);
