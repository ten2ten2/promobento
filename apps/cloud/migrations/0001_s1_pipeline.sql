-- Internal S1 evaluation. These rows are not customer purchases or public launch eligibility.
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS pipeline_operations (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK(generation >= 0), purpose TEXT NOT NULL CHECK(purpose IN ('calibration','evaluation')),
  status TEXT NOT NULL CHECK(status IN ('active','awaiting_user','succeeded','failed','cancelled')),
  request_hash TEXT NOT NULL, max_micros INTEGER NOT NULL CHECK(max_micros > 0),
  created_at INTEGER NOT NULL, finished_at INTEGER, result_key TEXT
);
CREATE TABLE IF NOT EXISTS pipeline_rights (
  operation_id TEXT NOT NULL REFERENCES pipeline_operations(id), resource_id TEXT NOT NULL,
  sha256 TEXT NOT NULL, license_ref TEXT NOT NULL, evidence_key TEXT NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('internal_eval_only','commercial')), revoked_at INTEGER,
  PRIMARY KEY(operation_id,resource_id,sha256)
);
CREATE TABLE IF NOT EXISTS renderer_releases (
  id TEXT PRIMARY KEY, image_digest TEXT NOT NULL, runtime_version TEXT NOT NULL,
  environment_key TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('active','retired','revoked'))
);
CREATE TABLE IF NOT EXISTS pipeline_renders (
  id TEXT PRIMARY KEY, operation_id TEXT NOT NULL REFERENCES pipeline_operations(id), generation INTEGER NOT NULL,
  request_hash TEXT NOT NULL, job_key TEXT NOT NULL, status TEXT NOT NULL,
  created_at INTEGER NOT NULL, finished_at INTEGER, result_json TEXT,
  UNIQUE(operation_id,request_hash)
);
CREATE TABLE IF NOT EXISTS pipeline_attempts (
  id TEXT PRIMARY KEY, render_id TEXT NOT NULL REFERENCES pipeline_renders(id), operation_id TEXT NOT NULL REFERENCES pipeline_operations(id),
  generation INTEGER NOT NULL, mode TEXT NOT NULL, shard_index INTEGER, instance TEXT NOT NULL,
  status TEXT NOT NULL, started_at INTEGER, stopped_at INTEGER, result_json TEXT
);
CREATE TABLE IF NOT EXISTS cost_reservations (
  id TEXT PRIMARY KEY, operation_id TEXT NOT NULL REFERENCES pipeline_operations(id), request_hash TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('model','compute')), stage TEXT NOT NULL,
  reserved_micros INTEGER NOT NULL CHECK(reserved_micros >= 0), catalog_version TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cost_settlements (
  reservation_id TEXT PRIMARY KEY REFERENCES cost_reservations(id), actual_micros INTEGER NOT NULL CHECK(actual_micros >= 0),
  usage_json TEXT NOT NULL, settled_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS model_responses (
  cache_key TEXT PRIMARY KEY, model TEXT NOT NULL, response_key TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pipeline_outbox (
  id TEXT PRIMARY KEY, operation_id TEXT NOT NULL REFERENCES pipeline_operations(id), kind TEXT NOT NULL,
  payload_json TEXT NOT NULL, delivered_at INTEGER
);
CREATE INDEX IF NOT EXISTS pipeline_attempt_operation ON pipeline_attempts(operation_id,status);
CREATE INDEX IF NOT EXISTS pipeline_cost_operation ON cost_reservations(operation_id,kind);

CREATE TABLE IF NOT EXISTS pipeline_contexts (
  operation_id TEXT PRIMARY KEY REFERENCES pipeline_operations(id), request_key TEXT NOT NULL,
  directions_key TEXT, directions_hash TEXT, previews_key TEXT, choice TEXT, choice_hash TEXT
);
