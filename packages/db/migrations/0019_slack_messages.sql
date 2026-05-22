CREATE TABLE "slack_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"communication_id" uuid NOT NULL,
	"slack_team_id" varchar(32) NOT NULL,
	"slack_channel_id" varchar(32) NOT NULL,
	"slack_channel_name" varchar(128),
	"slack_message_ts" varchar(32) NOT NULL,
	"slack_thread_ts" varchar(32),
	"author_slack_user_id" varchar(32),
	"author_display_name" varchar(128),
	"text" text,
	"raw_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"has_attachments" boolean DEFAULT false NOT NULL,
	"message_type" varchar(32) DEFAULT 'message' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slack_messages_type_valid" CHECK ("slack_messages"."message_type" IN ('message', 'app_mention', 'thread_reply'))
);
--> statement-breakpoint
ALTER TABLE "slack_messages" ADD CONSTRAINT "slack_messages_communication_id_communications_id_fk" FOREIGN KEY ("communication_id") REFERENCES "public"."communications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "slack_messages_communication_id_uidx" ON "slack_messages" USING btree ("communication_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slack_messages_channel_ts_uidx" ON "slack_messages" USING btree ("slack_team_id","slack_channel_id","slack_message_ts");--> statement-breakpoint
CREATE INDEX "slack_messages_team_channel_idx" ON "slack_messages" USING btree ("slack_team_id","slack_channel_id");--> statement-breakpoint
CREATE INDEX "slack_messages_thread_idx" ON "slack_messages" USING btree ("slack_thread_ts");