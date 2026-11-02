-- Keep recovery and admission scans proportional to live rows. Historical
-- receipts and terminal rows remain intact; no migration of existing data.
CREATE INDEX IF NOT EXISTS pipeline_workflow_native_pending
  ON pipeline_workflows(last_checked_at,registered_at,operation_id)
  WHERE engine='huashu' AND reconciled_at IS NULL;
CREATE INDEX IF NOT EXISTS pipeline_attempt_unstopped
  ON pipeline_attempts(operation_id,id) WHERE stopped_at IS NULL;
CREATE INDEX IF NOT EXISTS pipeline_render_unpassed
  ON pipeline_renders(operation_id,id) WHERE status<>'passed';
CREATE INDEX IF NOT EXISTS pipeline_cost_unsettled_join
  ON cost_reservations(operation_id,id,kind);
CREATE INDEX IF NOT EXISTS pipeline_outbox_unsent
  ON pipeline_outbox(delivered_at);
