-- One shared research-model budget. Every environment binds MODEL_LEDGER to this same database.
CREATE TABLE IF NOT EXISTS model_budget_openings (
 authorization_id TEXT PRIMARY KEY, manifest_hash TEXT NOT NULL, manifest_json TEXT NOT NULL,
 created_at INTEGER NOT NULL, total_micros INTEGER CHECK(total_micros >= 0), confirmation_json TEXT,
 CHECK((total_micros IS NULL) = (confirmation_json IS NULL))
);
CREATE TABLE IF NOT EXISTS model_budget_reservations (
 id TEXT PRIMARY KEY, authorization_id TEXT NOT NULL REFERENCES model_budget_openings(authorization_id),
 origin TEXT NOT NULL, operation_id TEXT NOT NULL, call_id TEXT NOT NULL, request_hash TEXT NOT NULL,
 reserved_micros INTEGER NOT NULL CHECK(reserved_micros >= 0), catalog_version TEXT NOT NULL,
 created_at INTEGER NOT NULL, dispatched_at INTEGER, UNIQUE(authorization_id,origin,call_id)
);
CREATE TABLE IF NOT EXISTS model_budget_settlements (
 reservation_id TEXT PRIMARY KEY REFERENCES model_budget_reservations(id),
 actual_micros INTEGER NOT NULL CHECK(actual_micros >= 0), receipt_json TEXT NOT NULL, settled_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS model_budget_authorization ON model_budget_reservations(authorization_id);
