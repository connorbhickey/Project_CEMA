CREATE TYPE "public"."chain_break_review_state" AS ENUM('pending', 'claimed', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TABLE "chain_break_review_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"break_hash" text NOT NULL,
	"break_kind" text NOT NULL,
	"document_id" uuid,
	"reason" text NOT NULL,
	"state" "chain_break_review_state" DEFAULT 'pending' NOT NULL,
	"submitted_by_id" uuid NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewer_id" uuid,
	"claimed_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chain_break_review_queue_decided_at_requires_terminal" CHECK (("chain_break_review_queue"."decided_at" IS NULL) OR ("chain_break_review_queue"."state" IN ('resolved', 'dismissed'))),
	CONSTRAINT "chain_break_review_queue_resolution_note_requires_terminal" CHECK (("chain_break_review_queue"."resolution_note" IS NULL) OR ("chain_break_review_queue"."state" IN ('resolved', 'dismissed'))),
	CONSTRAINT "chain_break_review_queue_break_kind_is_attorney_routed" CHECK ("chain_break_review_queue"."break_kind" IN ('lost_note', 'ambiguous_assignment', 'unrecorded_instrument'))
);
--> statement-breakpoint
ALTER TABLE "chain_break_review_queue" ADD CONSTRAINT "chain_break_review_queue_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chain_break_review_queue" ADD CONSTRAINT "chain_break_review_queue_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chain_break_review_queue" ADD CONSTRAINT "chain_break_review_queue_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chain_break_review_queue" ADD CONSTRAINT "chain_break_review_queue_submitted_by_id_users_id_fk" FOREIGN KEY ("submitted_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chain_break_review_queue" ADD CONSTRAINT "chain_break_review_queue_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chain_break_review_queue_deal_break_uidx" ON "chain_break_review_queue" USING btree ("deal_id","break_hash");--> statement-breakpoint
CREATE INDEX "chain_break_review_queue_org_state_idx" ON "chain_break_review_queue" USING btree ("organization_id","state");--> statement-breakpoint
CREATE INDEX "chain_break_review_queue_reviewer_idx" ON "chain_break_review_queue" USING btree ("reviewer_id");--> statement-breakpoint
-- RLS: hand-written (Drizzle's policy generator doesn't support our dynamic
-- current_setting('app.current_organization_id') pattern). Mirrors 0028_rls_m5.sql.
ALTER TABLE "chain_break_review_queue" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "chain_break_review_queue_org_isolation" ON "chain_break_review_queue"
  USING ("organization_id"::text = current_setting('app.current_organization_id', true));