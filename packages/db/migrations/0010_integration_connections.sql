CREATE TABLE "org_integration_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" "telephony_provider" NOT NULL,
	"nango_connection_id" varchar(128) NOT NULL,
	"nango_provider_config_key" varchar(64) NOT NULL,
	"external_account_id" varchar(128),
	"external_account_label" text,
	"connection_status" varchar(32) DEFAULT 'pending' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"created_by_id" uuid NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_integration_connections_status_valid" CHECK ("org_integration_connections"."connection_status" IN ('pending', 'active', 'error', 'revoked')),
	CONSTRAINT "org_integration_connections_revoked_at_required" CHECK (("org_integration_connections"."connection_status" = 'revoked' AND "org_integration_connections"."revoked_at" IS NOT NULL) OR ("org_integration_connections"."connection_status" <> 'revoked' AND "org_integration_connections"."revoked_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "org_integration_connections" ADD CONSTRAINT "org_integration_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_integration_connections" ADD CONSTRAINT "org_integration_connections_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "org_integration_connections_nango_connection_id_uidx" ON "org_integration_connections" USING btree ("nango_connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_integration_connections_org_provider_external_uidx" ON "org_integration_connections" USING btree ("organization_id","provider","external_account_id");--> statement-breakpoint
CREATE INDEX "org_integration_connections_org_status_idx" ON "org_integration_connections" USING btree ("organization_id","connection_status");--> statement-breakpoint
CREATE INDEX "org_integration_connections_organization_id_idx" ON "org_integration_connections" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "org_integration_connections_created_by_id_idx" ON "org_integration_connections" USING btree ("created_by_id");