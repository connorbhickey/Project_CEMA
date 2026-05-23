-- M5 Task 1: Enable pgvector for semantic similarity search.
-- Hand-written because drizzle-kit does not track Postgres extensions.

CREATE EXTENSION IF NOT EXISTS vector;
