-- Existing paid operations retain their original block-only prompts/checkpoints.
ALTER TABLE pipeline_contexts ADD COLUMN directing_method_key TEXT;
