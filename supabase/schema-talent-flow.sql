-- Add talent flow tracking columns to roles table

-- talent_flow_data: live per-company pipeline stats, updated on every
-- candidate upload and feedback signal
ALTER TABLE roles ADD COLUMN IF NOT EXISTS talent_flow_data jsonb;

-- talent_flow_insights: Claude-generated insights, persisted so they
-- survive navigation and are specific to each role
ALTER TABLE roles ADD COLUMN IF NOT EXISTS talent_flow_insights jsonb;

CREATE INDEX IF NOT EXISTS roles_talent_flow_data_exists
  ON roles ((talent_flow_data IS NOT NULL));
