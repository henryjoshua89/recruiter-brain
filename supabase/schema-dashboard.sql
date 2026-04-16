-- Phase 3: Pipeline Dashboard
-- Run this in Supabase SQL editor

-- Source tracking on candidates (inbound = applied, outbound = sourced by recruiter)
ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'inbound'
    CHECK (source IN ('inbound', 'outbound'));

-- Strategy timeline for a role (recruiter notes, decisions, pivots)
CREATE TABLE IF NOT EXISTS public.role_strategy_log (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id     uuid        NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  entry_type  text        NOT NULL DEFAULT 'note'
                CHECK (entry_type IN ('note', 'decision', 'pivot', 'milestone')),
  body        text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS role_strategy_log_role_id_idx
  ON public.role_strategy_log(role_id);

ALTER TABLE public.role_strategy_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anon all on role_strategy_log" ON public.role_strategy_log;
CREATE POLICY "Allow anon all on role_strategy_log"
  ON public.role_strategy_log
  FOR ALL TO anon
  USING (true)
  WITH CHECK (true);
