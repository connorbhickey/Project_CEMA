-- M6: Knowledge graph edges table (pure Postgres, replaces Apache AGE).

CREATE TABLE IF NOT EXISTS kg_edges (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  subject_id      UUID NOT NULL,
  subject_type    TEXT NOT NULL,
  predicate       TEXT NOT NULL,
  object_id       UUID NOT NULL,
  object_type     TEXT NOT NULL,
  metadata        TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dedup index — addEdge is idempotent via ON CONFLICT DO NOTHING.
CREATE UNIQUE INDEX kg_edges_uidx
  ON kg_edges (organization_id, subject_id, subject_type, predicate, object_id, object_type);

-- Traversal indexes.
CREATE INDEX kg_edges_subject_idx ON kg_edges (organization_id, subject_id, subject_type);
CREATE INDEX kg_edges_object_idx  ON kg_edges (organization_id, object_id, object_type);

-- RLS: each org sees only its own edges.
ALTER TABLE kg_edges ENABLE ROW LEVEL SECURITY;

CREATE POLICY kg_edges_org_isolation ON kg_edges
  USING (organization_id::text = current_setting('app.current_organization_id', true));
