-- Admission requests are not physical attempts. Do not alter historical rows or ledgers.
ALTER TABLE pipeline_renders ADD COLUMN queue_deadline_at INTEGER;
ALTER TABLE pipeline_renders ADD COLUMN operation_deadline_at INTEGER;
ALTER TABLE pipeline_renders ADD COLUMN mode TEXT;

-- Queue acceptance does not prove the Director Workflow received its wake-up event.
ALTER TABLE pipeline_outbox ADD COLUMN director_event_done_at INTEGER;
ALTER TABLE pipeline_outbox ADD COLUMN director_event_retry_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pipeline_outbox ADD COLUMN director_event_failures INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS pipeline_outbox_director_event ON pipeline_outbox(kind,director_event_done_at,director_event_retry_at);

CREATE TABLE IF NOT EXISTS pipeline_render_admissions (
  id TEXT PRIMARY KEY,
  render_id TEXT NOT NULL REFERENCES pipeline_renders(id),
  operation_id TEXT NOT NULL REFERENCES pipeline_operations(id),
  generation INTEGER NOT NULL,
  workspace_id TEXT NOT NULL,
  attempt_index INTEGER NOT NULL CHECK(attempt_index BETWEEN 0 AND 1),
  status TEXT NOT NULL CHECK(status IN ('queued','admitted','running','released','expired','cancelled')),
  requested_at INTEGER NOT NULL,
  queue_deadline_at INTEGER NOT NULL,
  lease_token TEXT,
  admitted_at INTEGER,
  attempt_deadline_at INTEGER,
  notification_sent_at INTEGER,
  notification_retry_at INTEGER NOT NULL DEFAULT 0,
  notification_failures INTEGER NOT NULL DEFAULT 0,
  UNIQUE(render_id,attempt_index)
);
CREATE INDEX IF NOT EXISTS pipeline_admissions_ready ON pipeline_render_admissions(status,requested_at,render_id);
CREATE INDEX IF NOT EXISTS pipeline_admissions_render ON pipeline_render_admissions(render_id,status);
CREATE INDEX IF NOT EXISTS pipeline_admissions_workspace ON pipeline_render_admissions(status,workspace_id,requested_at);
