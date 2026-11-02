-- Keep recovery and admission scans proportional to live rows. Historical
-- receipts and terminal rows remain intact; no migration of existing data.
-- The old index only starts with reconciled_at; the recovery sweep filters
-- both engine and reconciled_at. Replace it rather than adding write overhead.
CREATE INDEX IF NOT EXISTS pipeline_workflow_native_pending
  ON pipeline_workflows(reconciled_at,engine,last_checked_at,registered_at);
DROP INDEX IF EXISTS pipeline_workflow_pending;
CREATE INDEX IF NOT EXISTS pipeline_attempt_unstopped
  ON pipeline_attempts(operation_id,id) WHERE stopped_at IS NULL;
CREATE INDEX IF NOT EXISTS pipeline_render_unpassed
  ON pipeline_renders(operation_id,id) WHERE status<>'passed';
CREATE INDEX IF NOT EXISTS pipeline_cost_operation_order
  ON cost_reservations(operation_id,id,kind);
CREATE INDEX IF NOT EXISTS pipeline_outbox_unsent
  ON pipeline_outbox(delivered_at) WHERE delivered_at IS NULL;
CREATE INDEX IF NOT EXISTS pipeline_operation_active_recovery
  ON pipeline_operations(status,id) WHERE status IN ('active','awaiting_user');
CREATE INDEX IF NOT EXISTS pipeline_render_queued_recovery
  ON pipeline_renders(status,id) WHERE status='queued';
