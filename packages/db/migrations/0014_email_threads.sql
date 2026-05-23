CREATE TABLE "email_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"communication_id" uuid NOT NULL,
	"nylas_thread_id" varchar(256) NOT NULL,
	"nylas_grant_id" varchar(128) NOT NULL,
	"subject" text,
	"snippet" text,
	"from_email" varchar(256),
	"from_name" varchar(256),
	"to_participants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cc_participants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"body_html" text,
	"body_plain" text,
	"message_count" integer DEFAULT 1 NOT NULL,
	"has_attachments" boolean DEFAULT false NOT NULL,
	"nylas_attachment_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"first_message_at" timestamp with time zone,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_threads_message_count_pos" CHECK ("email_threads"."message_count" >= 1)
);
--> statement-breakpoint
ALTER TABLE "email_threads" ADD CONSTRAINT "email_threads_communication_id_communications_id_fk" FOREIGN KEY ("communication_id") REFERENCES "public"."communications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_threads_communication_id_uidx" ON "email_threads" USING btree ("communication_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_threads_nylas_thread_id_grant_uidx" ON "email_threads" USING btree ("nylas_thread_id","nylas_grant_id");--> statement-breakpoint
CREATE INDEX "email_threads_nylas_grant_id_idx" ON "email_threads" USING btree ("nylas_grant_id");