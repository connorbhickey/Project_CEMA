ALTER TABLE "parties" ADD COLUMN "tcpa_opt_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "tcpa_opt_in_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "tcpa_opt_in_source" varchar(64);--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "recording_disclosure_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_tcpa_opt_in_requires_timestamp" CHECK ("parties"."tcpa_opt_in" = false OR "parties"."tcpa_opt_in_at" IS NOT NULL);