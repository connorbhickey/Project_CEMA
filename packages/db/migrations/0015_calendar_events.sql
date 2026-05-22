CREATE TABLE "calendar_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"communication_id" uuid NOT NULL,
	"nylas_event_id" varchar(256) NOT NULL,
	"nylas_calendar_id" varchar(256) NOT NULL,
	"nylas_grant_id" varchar(128) NOT NULL,
	"title" text,
	"description" text,
	"location" text,
	"event_status" varchar(32) DEFAULT 'confirmed' NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"is_all_day" boolean DEFAULT false NOT NULL,
	"organizer_email" varchar(256),
	"organizer_name" varchar(256),
	"attendees" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_events_status_valid" CHECK ("calendar_events"."event_status" IN ('confirmed', 'tentative', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_communication_id_communications_id_fk" FOREIGN KEY ("communication_id") REFERENCES "public"."communications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_events_communication_id_uidx" ON "calendar_events" USING btree ("communication_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_events_nylas_event_grant_uidx" ON "calendar_events" USING btree ("nylas_event_id","nylas_grant_id");--> statement-breakpoint
CREATE INDEX "calendar_events_nylas_grant_id_idx" ON "calendar_events" USING btree ("nylas_grant_id");