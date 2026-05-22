CREATE TABLE "org_slack_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"slack_team_id" varchar(32) NOT NULL,
	"slack_team_name" varchar(256),
	"slack_bot_token" text NOT NULL,
	"slack_bot_user_id" varchar(32),
	"connection_status" varchar(32) DEFAULT 'active' NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_slack_connections_status_valid" CHECK ("org_slack_connections"."connection_status" IN ('active', 'error', 'revoked')),
	CONSTRAINT "org_slack_connections_revoked_at_required" CHECK (("org_slack_connections"."connection_status" = 'revoked' AND "org_slack_connections"."revoked_at" IS NOT NULL) OR ("org_slack_connections"."connection_status" <> 'revoked' AND "org_slack_connections"."revoked_at" IS NULL)),
	CONSTRAINT "org_slack_connections_bot_token_prefix" CHECK ("org_slack_connections"."slack_bot_token" LIKE 'xoxb-%')
);
--> statement-breakpoint
ALTER TABLE "org_slack_connections" ADD CONSTRAINT "org_slack_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_slack_connections" ADD CONSTRAINT "org_slack_connections_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "org_slack_connections_team_uidx" ON "org_slack_connections" USING btree ("slack_team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_slack_connections_org_team_uidx" ON "org_slack_connections" USING btree ("organization_id","slack_team_id");--> statement-breakpoint
CREATE INDEX "org_slack_connections_org_id_idx" ON "org_slack_connections" USING btree ("organization_id");