CREATE TABLE "org_drive_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"google_account_email" varchar(256) NOT NULL,
	"google_account_id" varchar(128),
	"oauth_refresh_token" text NOT NULL,
	"drive_channel_id" varchar(128),
	"drive_channel_token" varchar(128),
	"drive_channel_expires_at" timestamp with time zone,
	"connection_status" varchar(32) DEFAULT 'active' NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_drive_connections_status_valid" CHECK ("org_drive_connections"."connection_status" IN ('active', 'error', 'revoked')),
	CONSTRAINT "org_drive_connections_revoked_at_required" CHECK (("org_drive_connections"."connection_status" = 'revoked' AND "org_drive_connections"."revoked_at" IS NOT NULL) OR ("org_drive_connections"."connection_status" <> 'revoked' AND "org_drive_connections"."revoked_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "drive_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"drive_connection_id" uuid NOT NULL,
	"deal_id" uuid,
	"drive_file_id" varchar(128) NOT NULL,
	"drive_folder_id" varchar(128),
	"file_name" text,
	"mime_type" varchar(128),
	"size_bytes" bigint,
	"blob_pathname" text,
	"blob_url" text,
	"sync_status" varchar(32) DEFAULT 'pending' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"trashed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drive_files_sync_status_valid" CHECK ("drive_files"."sync_status" IN ('pending', 'syncing', 'synced', 'error', 'trashed')),
	CONSTRAINT "drive_files_size_nonneg" CHECK ("drive_files"."size_bytes" IS NULL OR "drive_files"."size_bytes" >= 0)
);
--> statement-breakpoint
ALTER TABLE "org_drive_connections" ADD CONSTRAINT "org_drive_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_drive_connections" ADD CONSTRAINT "org_drive_connections_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_files" ADD CONSTRAINT "drive_files_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_files" ADD CONSTRAINT "drive_files_drive_connection_id_org_drive_connections_id_fk" FOREIGN KEY ("drive_connection_id") REFERENCES "public"."org_drive_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_files" ADD CONSTRAINT "drive_files_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "org_drive_connections_channel_id_uidx" ON "org_drive_connections" USING btree ("drive_channel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_drive_connections_org_email_uidx" ON "org_drive_connections" USING btree ("organization_id","google_account_email");--> statement-breakpoint
CREATE INDEX "org_drive_connections_org_id_idx" ON "org_drive_connections" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "org_drive_connections_org_status_idx" ON "org_drive_connections" USING btree ("organization_id","connection_status");--> statement-breakpoint
CREATE UNIQUE INDEX "drive_files_connection_drive_file_id_uidx" ON "drive_files" USING btree ("drive_connection_id","drive_file_id");--> statement-breakpoint
CREATE INDEX "drive_files_organization_id_idx" ON "drive_files" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "drive_files_deal_id_idx" ON "drive_files" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "drive_files_sync_status_idx" ON "drive_files" USING btree ("organization_id","sync_status");