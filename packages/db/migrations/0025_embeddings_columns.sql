ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "embedding" vector(3072);--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "embedding_generated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "communications" ADD COLUMN IF NOT EXISTS "embedding" vector(3072);--> statement-breakpoint
ALTER TABLE "communications" ADD COLUMN IF NOT EXISTS "embedding_generated_at" timestamp with time zone;

-- hnsw indexes for cosine similarity on high-dimensional vectors.
-- pgvector's hnsw (and ivfflat) limit vector_cosine_ops to ≤ 2000 dims.
-- OpenAI text-embedding-3-large emits 3072-dim vectors. The pgvector 0.7+
-- workaround is to cast the column to halfvec(3072) at index-build time
-- and use halfvec_cosine_ops — this lowers precision slightly but keeps
-- the full 3072-dim vector stored in the column for exact reranking.
-- m=16, ef_construction=64 are the recommended defaults.
CREATE INDEX IF NOT EXISTS communications_embedding_hnsw_idx
  ON communications USING hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS documents_embedding_hnsw_idx
  ON documents USING hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops)
  WITH (m = 16, ef_construction = 64);