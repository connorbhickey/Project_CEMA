CREATE TABLE "communications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"deal_id" uuid,
	"kind" "communication_kind" NOT NULL,
	"direction" "communication_direction" NOT NULL,
	"medium" "communication_medium" NOT NULL,
	"provider" "telephony_provider",
	"vendor_call_id" varchar(128),
	"vendor_event_id" varchar(128),
	"from_party_id" uuid,
	"to_party_ids" uuid[],
	"from_e164" varchar(20),
	"to_e164" varchar(20),
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"duration_seconds" integer,
	"source_thread_id" varchar(128),
	"status" "communication_status" DEFAULT 'pending' NOT NULL,
	"ai_summary" text,
	"ai_action_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ai_sentiment" varchar(16),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "communications_call_requires_provider" CHECK ("communications"."kind" <> 'call' OR "communications"."provider" IS NOT NULL),
	CONSTRAINT "communications_duration_nonneg" CHECK ("communications"."duration_seconds" IS NULL OR "communications"."duration_seconds" >= 0)
);
--> statement-breakpoint
CREATE TABLE "recordings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"communication_id" uuid NOT NULL,
	"recording_blob_url" text NOT NULL,
	"recording_blob_pathname" text NOT NULL,
	"recording_bytes" bigint,
	"recording_duration_seconds" integer,
	"mime_type" varchar(64),
	"transcript_blob_url" text,
	"transcript_blob_pathname" text,
	"transcript_words_count" integer,
	"transcript_language" varchar(8),
	"transcript_provider" varchar(32),
	"consent_disclosure_emitted_at" timestamp with time zone,
	"legal_hold" boolean DEFAULT false NOT NULL,
	"retention_until" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recordings_retention_future" CHECK ("recordings"."retention_until" > "recordings"."created_at"),
	CONSTRAINT "recordings_no_delete_under_legal_hold" CHECK ("recordings"."deleted_at" IS NULL OR "recordings"."legal_hold" = false)
);
--> statement-breakpoint
ALTER TABLE "communications" ADD CONSTRAINT "communications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communications" ADD CONSTRAINT "communications_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communications" ADD CONSTRAINT "communications_from_party_id_parties_id_fk" FOREIGN KEY ("from_party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_communication_id_communications_id_fk" FOREIGN KEY ("communication_id") REFERENCES "public"."communications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "communications_vendor_event_id_uidx" ON "communications" USING btree ("vendor_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "communications_provider_vendor_call_id_uidx" ON "communications" USING btree ("provider","vendor_call_id");--> statement-breakpoint
CREATE INDEX "communications_org_started_at_idx" ON "communications" USING btree ("organization_id","started_at");--> statement-breakpoint
CREATE INDEX "communications_deal_started_at_idx" ON "communications" USING btree ("deal_id","started_at");--> statement-breakpoint
CREATE INDEX "communications_organization_id_idx" ON "communications" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "communications_deal_id_idx" ON "communications" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "communications_from_party_id_idx" ON "communications" USING btree ("from_party_id");--> statement-breakpoint
CREATE INDEX "recordings_communication_id_idx" ON "recordings" USING btree ("communication_id");--> statement-breakpoint
CREATE INDEX "recordings_retention_until_idx" ON "recordings" USING btree ("retention_until");