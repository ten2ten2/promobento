-- A native Workflow's confirmed stop is not proof that all compute, leases,
-- fees and render terminal rows have been reconciled.
ALTER TABLE pipeline_workflows ADD COLUMN native_stop_confirmed_at INTEGER;
