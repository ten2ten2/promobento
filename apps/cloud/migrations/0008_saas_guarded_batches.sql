-- Shared infrastructure only. Customer balances, projects and payments are
-- added with their business modules; existing S1 records are untouched.
CREATE TABLE saas_batch_assertions (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  passed INTEGER NOT NULL CONSTRAINT saas_batch_precondition CHECK (passed = 1)
);

CREATE TABLE saas_request_results (
  idempotency_key TEXT PRIMARY KEY NOT NULL
    CHECK (length(idempotency_key) = 64 AND idempotency_key NOT GLOB '*[^0-9a-f]*'),
  workspace_id TEXT NOT NULL,
  project_id TEXT,
  actor_id TEXT NOT NULL,
  route_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  request_hash TEXT NOT NULL
    CHECK (length(request_hash) = 64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  result_json TEXT NOT NULL CHECK (json_valid(result_json)),
  created_at INTEGER NOT NULL CHECK (created_at >= 0)
) WITHOUT ROWID;
