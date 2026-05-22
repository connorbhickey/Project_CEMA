CREATE TABLE "contact_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" varchar(32) NOT NULL,
	"normalized_value" varchar(256) NOT NULL,
	"raw_value" varchar(256),
	"source" varchar(32) NOT NULL,
	"source_id" uuid,
	"confidence" double precision DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_identities_kind_valid" CHECK ("contact_identities"."kind" IN ('email', 'phone', 'slack_user', 'crm_id')),
	CONSTRAINT "contact_identities_source_valid" CHECK ("contact_identities"."source" IN ('party', 'comm_from', 'comm_to', 'slack_message', 'manual')),
	CONSTRAINT "contact_identities_confidence_range" CHECK ("contact_identities"."confidence" >= 0 AND "contact_identities"."confidence" <= 1)
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"primary_name" text,
	"primary_email" varchar(256),
	"primary_phone" varchar(20),
	"employer" varchar(256),
	"role" varchar(64),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact_identities" ADD CONSTRAINT "contact_identities_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_identities" ADD CONSTRAINT "contact_identities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_identities_org_kind_value_uidx" ON "contact_identities" USING btree ("organization_id","kind","normalized_value");--> statement-breakpoint
CREATE INDEX "contact_identities_contact_id_idx" ON "contact_identities" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "contact_identities_organization_id_idx" ON "contact_identities" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "contacts_organization_id_idx" ON "contacts" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "contacts_primary_email_idx" ON "contacts" USING btree ("organization_id","primary_email");--> statement-breakpoint
CREATE INDEX "contacts_primary_phone_idx" ON "contacts" USING btree ("organization_id","primary_phone");