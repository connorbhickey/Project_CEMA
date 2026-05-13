CREATE TYPE "public"."cema_type" AS ENUM('refi_cema', 'purchase_cema');--> statement-breakpoint
CREATE TYPE "public"."deal_status" AS ENUM('intake', 'eligibility', 'authorization', 'collateral_chase', 'title_work', 'doc_prep', 'attorney_review', 'closing', 'recording', 'completed', 'exception', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."document_kind" AS ENUM('note', 'mortgage', 'aom', 'allonge', 'cema_3172', 'exhibit_a', 'exhibit_b', 'exhibit_c', 'exhibit_d', 'consolidated_note', 'gap_note', 'gap_mortgage', 'aff_255', 'aff_275', 'mt_15', 'nyc_rpt', 'tp_584', 'acris_cover_pages', 'county_cover_sheet', 'payoff_letter', 'authorization', 'title_commitment', 'title_policy', 'endorsement_111', 'other');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('draft', 'attorney_review', 'approved', 'executed', 'recorded', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."lender_subtype" AS ENUM('imb', 'regional_bank', 'community_bank_cu', 'wholesale_broker');--> statement-breakpoint
CREATE TYPE "public"."loan_program" AS ENUM('conventional_fannie', 'conventional_freddie', 'conventional_private', 'jumbo');--> statement-breakpoint
CREATE TYPE "public"."party_role" AS ENUM('borrower', 'co_borrower', 'seller', 'loan_officer', 'processor', 'closing_attorney', 'title_agent', 'seller_attorney', 'doc_custodian');--> statement-breakpoint
CREATE TYPE "public"."property_type" AS ENUM('one_family', 'two_family', 'three_family', 'condo', 'pud');--> statement-breakpoint
CREATE TYPE "public"."submission_method" AS ENUM('email', 'portal', 'fax_only', 'usps');--> statement-breakpoint
CREATE TYPE "public"."org_role" AS ENUM('owner', 'admin', 'member');--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "org_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_org_id" varchar(64) NOT NULL,
	"name" text NOT NULL,
	"slug" varchar(64) NOT NULL,
	"lender_subtype" "lender_subtype",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" varchar(64) NOT NULL,
	"email" varchar(255) NOT NULL,
	"full_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "servicer_cema_departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"servicer_id" uuid NOT NULL,
	"phone" varchar(32),
	"fax" varchar(32),
	"email" varchar(255),
	"portal_url" text,
	"accepted_submission_methods" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"typical_sla_business_days" integer,
	"escalation_path" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"common_rejection_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "servicer_cema_departments_sla_nonneg" CHECK ("servicer_cema_departments"."typical_sla_business_days" IS NULL OR "servicer_cema_departments"."typical_sla_business_days" >= 0)
);
--> statement-breakpoint
CREATE TABLE "servicers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legal_name" text NOT NULL,
	"dba_names" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"nmls_id" varchar(32),
	"mers_org_id" varchar(32),
	"parent_servicer_id" uuid,
	"collateral_custodian" text,
	"playbook_version" integer DEFAULT 1 NOT NULL,
	"notes" text,
	"last_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "servicers_playbook_version_positive" CHECK ("servicers"."playbook_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"cema_type" "cema_type" NOT NULL,
	"status" "deal_status" DEFAULT 'intake' NOT NULL,
	"property_id" uuid,
	"new_loan_id" uuid,
	"created_by_id" uuid NOT NULL,
	"notes" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"target_close_at" timestamp with time zone,
	"sla_breach_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deals_completed_at_required" CHECK ("deals"."status" <> 'completed' OR "deals"."completed_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "existing_loans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"upb" numeric(12, 2) NOT NULL,
	"original_principal" numeric(12, 2),
	"note_date" date,
	"maturity_date" date,
	"current_servicer_id" uuid,
	"investor" varchar(64),
	"recorded_reel_page" varchar(64),
	"recorded_crfn" varchar(64),
	"chain_position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "existing_loans_upb_nonneg" CHECK ("existing_loans"."upb" >= 0),
	CONSTRAINT "existing_loans_chain_position_nonneg" CHECK ("existing_loans"."chain_position" >= 0),
	CONSTRAINT "existing_loans_original_principal_positive" CHECK ("existing_loans"."original_principal" IS NULL OR "existing_loans"."original_principal" > 0),
	CONSTRAINT "existing_loans_recording_xor" CHECK (NOT ("existing_loans"."recorded_reel_page" IS NOT NULL AND "existing_loans"."recorded_crfn" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "new_loans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"principal" numeric(12, 2) NOT NULL,
	"rate" numeric(6, 4),
	"term_months" integer,
	"program" "loan_program" NOT NULL,
	"target_funding_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "new_loans_principal_positive" CHECK ("new_loans"."principal" > 0),
	CONSTRAINT "new_loans_term_months_positive" CHECK ("new_loans"."term_months" IS NULL OR "new_loans"."term_months" > 0),
	CONSTRAINT "new_loans_rate_nonneg" CHECK ("new_loans"."rate" IS NULL OR "new_loans"."rate" >= 0)
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"street_address" text NOT NULL,
	"unit" varchar(32),
	"city" text NOT NULL,
	"county" text NOT NULL,
	"zip_code" varchar(16) NOT NULL,
	"property_type" "property_type" NOT NULL,
	"block" varchar(32),
	"lot" varchar(32),
	"tax_map_id" varchar(64),
	"acris_bbl" varchar(32),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "properties_acris_bbl_format" CHECK ("properties"."acris_bbl" IS NULL OR "properties"."acris_bbl" ~ '^[1-5]-[0-9]{1,5}-[0-9]{1,4}$')
);
--> statement-breakpoint
CREATE TABLE "parties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"role" "party_role" NOT NULL,
	"full_name" text,
	"email" varchar(255),
	"phone" varchar(32),
	"ssn_encrypted" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parties_ssn_encrypted_not_plaintext" CHECK ("parties"."ssn_encrypted" IS NULL OR NOT ("parties"."ssn_encrypted" ~ '^\d{3}-?\d{2}-?\d{4}$'))
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"kind" "document_kind" NOT NULL,
	"status" "document_status" DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"attorney_review_required" boolean DEFAULT false NOT NULL,
	"blob_url" text,
	"checksum" varchar(128),
	"page_count" integer,
	"extracted_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"recorded_reel_page" varchar(64),
	"recorded_crfn" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_version_positive" CHECK ("documents"."version" >= 1),
	CONSTRAINT "documents_page_count_positive" CHECK ("documents"."page_count" IS NULL OR "documents"."page_count" > 0),
	CONSTRAINT "documents_recording_xor" CHECK (NOT ("documents"."recorded_reel_page" IS NOT NULL AND "documents"."recorded_crfn" IS NOT NULL)),
	CONSTRAINT "documents_attorney_gate_required" CHECK ("documents"."kind" NOT IN ('cema_3172','exhibit_a','exhibit_b','exhibit_c','exhibit_d','gap_note','gap_mortgage','consolidated_note','aom','allonge','aff_255','aff_275','mt_15','county_cover_sheet') OR "documents"."attorney_review_required" = true)
);
--> statement-breakpoint
CREATE TABLE "attorney_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"document_version" integer NOT NULL,
	"approved_by_id" uuid NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"nmls_id" varchar(32),
	"notes" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"action" varchar(128) NOT NULL,
	"entity_type" varchar(64) NOT NULL,
	"entity_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip_address" varchar(64),
	"user_agent" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "servicer_cema_departments" ADD CONSTRAINT "servicer_cema_departments_servicer_id_servicers_id_fk" FOREIGN KEY ("servicer_id") REFERENCES "public"."servicers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "servicers" ADD CONSTRAINT "servicers_parent_servicer_id_servicers_id_fk" FOREIGN KEY ("parent_servicer_id") REFERENCES "public"."servicers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_new_loan_id_new_loans_id_fk" FOREIGN KEY ("new_loan_id") REFERENCES "public"."new_loans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "existing_loans" ADD CONSTRAINT "existing_loans_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "existing_loans" ADD CONSTRAINT "existing_loans_current_servicer_id_servicers_id_fk" FOREIGN KEY ("current_servicer_id") REFERENCES "public"."servicers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "new_loans" ADD CONSTRAINT "new_loans_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attorney_approvals" ADD CONSTRAINT "attorney_approvals_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attorney_approvals" ADD CONSTRAINT "attorney_approvals_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_org_user_idx" ON "memberships" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_clerk_org_idx" ON "organizations" USING btree ("clerk_org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_idx" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "users_clerk_user_idx" ON "users" USING btree ("clerk_user_id");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "servicer_cema_departments_servicer_id_idx" ON "servicer_cema_departments" USING btree ("servicer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "servicers_legal_name_idx" ON "servicers" USING btree ("legal_name");--> statement-breakpoint
CREATE INDEX "servicers_nmls_id_idx" ON "servicers" USING btree ("nmls_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deals_org_id_id_idx" ON "deals" USING btree ("organization_id","id");--> statement-breakpoint
CREATE INDEX "deals_organization_id_idx" ON "deals" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "deals_property_id_idx" ON "deals" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "deals_new_loan_id_idx" ON "deals" USING btree ("new_loan_id");--> statement-breakpoint
CREATE INDEX "deals_created_by_id_idx" ON "deals" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "deals_status_idx" ON "deals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "deals_target_close_at_idx" ON "deals" USING btree ("target_close_at");--> statement-breakpoint
CREATE INDEX "deals_sla_breach_at_idx" ON "deals" USING btree ("sla_breach_at");--> statement-breakpoint
CREATE INDEX "existing_loans_deal_id_idx" ON "existing_loans" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "existing_loans_current_servicer_id_idx" ON "existing_loans" USING btree ("current_servicer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "existing_loans_deal_chain_pos_idx" ON "existing_loans" USING btree ("deal_id","chain_position");--> statement-breakpoint
CREATE INDEX "new_loans_organization_id_idx" ON "new_loans" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "properties_county_idx" ON "properties" USING btree ("county");--> statement-breakpoint
CREATE INDEX "properties_acris_bbl_idx" ON "properties" USING btree ("acris_bbl");--> statement-breakpoint
CREATE INDEX "parties_deal_id_idx" ON "parties" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "parties_email_idx" ON "parties" USING btree ("email");--> statement-breakpoint
CREATE INDEX "documents_deal_id_idx" ON "documents" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "documents_kind_idx" ON "documents" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "documents_status_idx" ON "documents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "attorney_approvals_document_id_idx" ON "attorney_approvals" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "attorney_approvals_approved_by_id_idx" ON "attorney_approvals" USING btree ("approved_by_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attorney_approvals_doc_version_uidx" ON "attorney_approvals" USING btree ("document_id","document_version");--> statement-breakpoint
CREATE INDEX "audit_events_org_occurred_idx" ON "audit_events" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_events_actor_user_id_idx" ON "audit_events" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "audit_events_action_idx" ON "audit_events" USING btree ("action");