ALTER TABLE roles ADD COLUMN IF NOT EXISTS annotation_patterns text;

CREATE TABLE IF NOT EXISTS candidate_annotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid REFERENCES candidates(id) ON DELETE CASCADE,
  role_id uuid REFERENCES roles(id) ON DELETE CASCADE,
  transcript text NOT NULL,
  sentiment text,
  observations jsonb DEFAULT '[]',
  concerns jsonb DEFAULT '[]',
  strengths jsonb DEFAULT '[]',
  suggested_feedback text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE candidate_annotations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow anon all on candidate_annotations" ON candidate_annotations FOR ALL TO anon USING (true) WITH CHECK (true);
