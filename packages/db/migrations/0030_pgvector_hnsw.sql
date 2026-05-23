-- HNSW indexes for fast approximate nearest-neighbor search on embedding columns.
-- m=16 / ef_construction=64 are standard starting points for cosine search;
-- raise ef_construction to 128 when >1M rows per org for higher recall.
-- Note: CONCURRENTLY cannot run inside a transaction — use raw psql to rebuild
-- in production if the table has significant live data.
CREATE INDEX IF NOT EXISTS communications_embedding_hnsw_idx
  ON communications USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS documents_embedding_hnsw_idx
  ON documents USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
