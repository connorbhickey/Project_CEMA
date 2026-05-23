CREATE TABLE "org_nylas_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider_type" varchar(32) NOT NULL,
	"nylas_grant_id" varchar(128) NOT NULL,
	"email_address" varchar(256) NOT NULL,
	"connection_status" varchar(32) DEFAULT 'pending' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"created_by_id" uuid NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_nylas_connections_status_valid" CHECK ("org_nylas_connections"."connection_status" IN ('pending', 'active', 'error', 'revoked')),
	CONSTRAINT "org_nylas_connections_provider_valid" CHECK ("org_nylas_connections"."provider_type" IN ('gmail', 'm365')),
	CONSTRAINT "org_nylas_connections_revoked_at_required" CHECK (("org_nylas_connections"."connection_status" = 'revoked' AND "org_nylas_connections"."revoked_at" IS NOT NULL) OR ("org_nylas_connections"."connection_status" <> 'revoked' AND "org_nylas_connections"."revoked_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "org_nylas_connections" ADD CONSTRAINT "org_nylas_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_nylas_connections" ADD CONSTRAINT "org_nylas_connections_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "org_nylas_connections_grant_id_uidx" ON "org_nylas_connections" USING btree ("nylas_grant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_nylas_connections_org_provider_email_uidx" ON "org_nylas_connections" USING btree ("organization_id","provider_type","email_address");--> statement-breakpoint
CREATE INDEX "org_nylas_connections_org_status_idx" ON "org_nylas_connections" USING btree ("organization_id","connection_status");--> statement-breakpoint
CREATE INDEX "org_nylas_connections_organization_id_idx" ON "org_nylas_connections" USING btree ("organization_id");