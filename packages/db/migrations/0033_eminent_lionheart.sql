-- pgvector embedding columns on contacts for FUZZY (name/employer/email) dedup
-- (spec §9.1). Nullable + backfilled lazily — exact email/phone dedup is unchanged.
-- No vector index: pgvector cannot index > 2000 dims, and dedup scans one org's
-- (small) contact set, so a brute-force cosine scan scoped by organization_id is fine.
ALTER TABLE "contacts" ADD COLUMN "embedding" vector(3072);--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "embedding_generated_at" timestamp with time zone;