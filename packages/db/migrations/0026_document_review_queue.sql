CREATE TYPE "public"."document_review_state" AS ENUM('pending', 'claimed', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "document_review_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"document_version" integer NOT NULL,
	"submitted_by_id" uuid NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"state" "document_review_state" DEFAULT 'pending' NOT NULL,
	"reviewer_id" uuid,
	"claimed_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_review_queue_decided_at_requires_terminal_state" CHECK (("document_review_queue"."decided_at" IS NULL) OR ("document_review_queue"."state" IN ('approved', 'rejected'))),
	CONSTRAINT "document_review_queue_rejection_reason_requires_reject" CHECK (("document_review_queue"."rejection_reason" IS NULL) OR ("document_review_queue"."state" = 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "document_review_queue" ADD CONSTRAINT "document_review_queue_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_review_queue" ADD CONSTRAINT "document_review_queue_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_review_queue" ADD CONSTRAINT "document_review_queue_submitted_by_id_users_id_fk" FOREIGN KEY ("submitted_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_review_queue" ADD CONSTRAINT "document_review_queue_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_review_queue_doc_version_uidx" ON "document_review_queue" USING btree ("document_id","document_version");--> statement-breakpoint
CREATE INDEX "document_review_queue_org_state_idx" ON "document_review_queue" USING btree ("organization_id","state");--> statement-breakpoint
CREATE INDEX "document_review_queue_reviewer_idx" ON "document_review_queue" USING btree ("reviewer_id");