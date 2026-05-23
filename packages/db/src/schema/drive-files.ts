import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { deals } from './deals';
import { orgDriveConnections } from './drive-connections';
import { organizations } from './tenants';

export const driveFiles = pgTable(
  'drive_files',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    driveConnectionId: uuid('drive_connection_id')
      .notNull()
      .references(() => orgDriveConnections.id, { onDelete: 'restrict' }),
    dealId: uuid('deal_id').references(() => deals.id, { onDelete: 'set null' }),
    driveFileId: varchar('drive_file_id', { length: 128 }).notNull(),
    driveFolderId: varchar('drive_folder_id', { length: 128 }),
    fileName: text('file_name'),
    mimeType: varchar('mime_type', { length: 128 }),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    blobPathname: text('blob_pathname'),
    blobUrl: text('blob_url'),
    syncStatus: varchar('sync_status', { length: 32 }).notNull().default('pending'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    lastError: text('last_error'),
    trashedAt: timestamp('trashed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [
    uniqueIndex('drive_files_connection_drive_file_id_uidx').on(t.driveConnectionId, t.driveFileId),
    index('drive_files_organization_id_idx').on(t.organizationId),
    index('drive_files_deal_id_idx').on(t.dealId),
    index('drive_files_sync_status_idx').on(t.organizationId, t.syncStatus),
    check(
      'drive_files_sync_status_valid',
      sql`${t.syncStatus} IN ('pending', 'syncing', 'synced', 'error', 'trashed')`,
    ),
    check('drive_files_size_nonneg', sql`${t.sizeBytes} IS NULL OR ${t.sizeBytes} >= 0`),
  ],
);
