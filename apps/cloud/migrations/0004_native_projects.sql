-- Native HTML project revisions coexist with immutable historical renders and ledgers.
-- This migration never rewrites old jobs, reservations, settlements or source objects.
CREATE TABLE IF NOT EXISTS pipeline_native_projects (
  operation_id TEXT NOT NULL REFERENCES pipeline_operations(id),
  revision_id TEXT NOT NULL,
  parent_revision TEXT,
  manifest_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(operation_id,revision_id)
);
CREATE INDEX IF NOT EXISTS pipeline_native_revision ON pipeline_native_projects(revision_id);
-- Legacy workflow rows remain inspectable/cancellable but never restart on the native renderer.
ALTER TABLE pipeline_workflows ADD COLUMN engine TEXT NOT NULL DEFAULT 'legacy' CHECK(engine IN ('legacy','huashu'));
ALTER TABLE pipeline_contexts ADD COLUMN engine TEXT NOT NULL DEFAULT 'legacy' CHECK(engine IN ('legacy','huashu'));
