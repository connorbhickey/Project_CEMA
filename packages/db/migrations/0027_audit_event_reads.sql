CREATE TYPE "public"."audit_read_entity_type" AS ENUM('communication', 'document', 'recording', 'pii_field', 'contact', 'deal', 'envelope');--> statement-breakpoint
CREATE TYPE "public"."audit_read_purpose" AS ENUM('view_detail', 'list', 'export', 'agent', 'admin');--> statement-breakpoint
CREATE TABLE "audit_event_reads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"entity_type" "audit_read_entity_type" NOT NULL,
	"entity_id" uuid NOT NULL,
	"purpose" "audit_read_purpose" NOT NULL,
	"actor_ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_event_reads" ADD CONSTRAINT "audit_event_reads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event_reads" ADD CONSTRAINT "audit_event_reads_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_event_reads_org_created_idx" ON "audit_event_reads" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_event_reads_entity_idx" ON "audit_event_reads" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_event_reads_actor_idx" ON "audit_event_reads" USING btree ("actor_user_id","created_at");

-- audit_event_reads is immutable. Identical pattern to migration 0003.
-- Reuses the shared reject_mutation_on_immutable_table() function already
-- installed by 0003 rather than duplicating function bodies.
CREATE TRIGGER audit_event_reads_no_update
  BEFORE UPDATE ON audit_event_reads
  FOR EACH ROW EXECUTE FUNCTION reject_mutation_on_immutable_table();

CREATE TRIGGER audit_event_reads_no_delete
  BEFORE DELETE ON audit_event_reads
  FOR EACH ROW EXECUTE FUNCTION reject_mutation_on_immutable_table();
