CREATE TYPE "public"."envelope_status" AS ENUM('created', 'sent', 'delivered', 'signed', 'completed', 'declined', 'voided');--> statement-breakpoint
CREATE TABLE "org_docusign_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"docusign_account_id" varchar(64) NOT NULL,
	"docusign_base_url" varchar(256) NOT NULL,
	"docusign_user_id" varchar(64),
	"integration_key" varchar(128) NOT NULL,
	"rsa_private_key" text NOT NULL,
	"connect_secret" text NOT NULL,
	"connection_status" varchar(32) DEFAULT 'active' NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_docusign_connections_status_valid" CHECK ("org_docusign_connections"."connection_status" IN ('active', 'error', 'revoked')),
	CONSTRAINT "org_docusign_connections_revoked_at_required" CHECK (("org_docusign_connections"."connection_status" = 'revoked' AND "org_docusign_connections"."revoked_at" IS NOT NULL) OR ("org_docusign_connections"."connection_status" <> 'revoked' AND "org_docusign_connections"."revoked_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "docusign_envelopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"docusign_connection_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"docusign_envelope_id" varchar(128) NOT NULL,
	"status" "envelope_status" DEFAULT 'created' NOT NULL,
	"subject" text,
	"recipients" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sent_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"voided_reason" text,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "docusign_envelopes_completed_at_requires_status" CHECK ("docusign_envelopes"."completed_at" IS NULL OR "docusign_envelopes"."status" IN ('completed', 'signed', 'voided', 'declined'))
);
--> statement-breakpoint
ALTER TABLE "org_docusign_connections" ADD CONSTRAINT "org_docusign_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_docusign_connections" ADD CONSTRAINT "org_docusign_connections_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docusign_envelopes" ADD CONSTRAINT "docusign_envelopes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docusign_envelopes" ADD CONSTRAINT "docusign_envelopes_docusign_connection_id_org_docusign_connections_id_fk" FOREIGN KEY ("docusign_connection_id") REFERENCES "public"."org_docusign_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docusign_envelopes" ADD CONSTRAINT "docusign_envelopes_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docusign_envelopes" ADD CONSTRAINT "docusign_envelopes_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "org_docusign_connections_account_uidx" ON "org_docusign_connections" USING btree ("docusign_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_docusign_connections_org_account_uidx" ON "org_docusign_connections" USING btree ("organization_id","docusign_account_id");--> statement-breakpoint
CREATE INDEX "org_docusign_connections_org_id_idx" ON "org_docusign_connections" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "org_docusign_connections_org_status_idx" ON "org_docusign_connections" USING btree ("organization_id","connection_status");--> statement-breakpoint
CREATE UNIQUE INDEX "docusign_envelopes_docusign_envelope_id_uidx" ON "docusign_envelopes" USING btree ("docusign_connection_id","docusign_envelope_id");--> statement-breakpoint
CREATE INDEX "docusign_envelopes_organization_id_idx" ON "docusign_envelopes" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "docusign_envelopes_document_id_idx" ON "docusign_envelopes" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "docusign_envelopes_org_status_idx" ON "docusign_envelopes" USING btree ("organization_id","status");