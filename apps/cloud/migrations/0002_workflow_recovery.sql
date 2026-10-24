-- Registry is separate from queue delivery: a sent outbox item does not prove native creation or stop.
CREATE TABLE IF NOT EXISTS pipeline_workflows (
 kind TEXT NOT NULL CHECK(kind IN ('operation','render')), id TEXT NOT NULL,
 operation_id TEXT NOT NULL REFERENCES pipeline_operations(id), generation INTEGER NOT NULL,
 registered_at INTEGER NOT NULL, native_created_at INTEGER, execution_claimed_at INTEGER, native_status TEXT,
 last_checked_at INTEGER, last_error TEXT, reconciled_at INTEGER,
 PRIMARY KEY(kind,id)
);
CREATE INDEX IF NOT EXISTS pipeline_workflow_pending ON pipeline_workflows(reconciled_at,last_checked_at);
CREATE INDEX IF NOT EXISTS pipeline_workflow_operation ON pipeline_workflows(operation_id);
-- Preserve unfinished pre-registry work. Missing native status stays unconfirmed, never assumed stopped.
INSERT OR IGNORE INTO pipeline_workflows(kind,id,operation_id,generation,registered_at)
 SELECT 'render',id,operation_id,generation,created_at FROM pipeline_renders WHERE status NOT IN ('passed','blocked','cancelled');
INSERT OR IGNORE INTO pipeline_workflows(kind,id,operation_id,generation,registered_at)
 SELECT 'operation',o.id,o.id,o.generation,o.created_at FROM pipeline_operations o
 JOIN pipeline_contexts c ON c.operation_id=o.id WHERE o.status IN ('active','awaiting_user');
