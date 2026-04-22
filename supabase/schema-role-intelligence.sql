-- Role Intelligence Journal
-- Recruiter-authored notes injected into resume analysis and briefing prompts

CREATE TABLE IF NOT EXISTS role_intelligence (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id     uuid        NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  entry       text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS role_intelligence_role_id_idx
  ON role_intelligence (role_id, created_at DESC);

ALTER TABLE role_intelligence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon all on role_intelligence"
  ON role_intelligence
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);
