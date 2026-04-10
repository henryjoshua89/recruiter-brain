-- Phase 2: Resume Analysis Engine — run after schema.sql (or merge into one migration)

alter table public.roles
  add column if not exists scoring_calibration jsonb not null default '{}'::jsonb,
  add column if not exists scoring_calibration_at timestamptz,
  add column if not exists scoring_calibration_feedback_count integer default 0;

create table if not exists public.candidates (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references public.roles(id) on delete cascade,
  resume_text text not null,
  resume_filename text,
  analysis jsonb not null default '{}'::jsonb,
  jd_fit_score numeric(4,1) not null,
  role_fit_score numeric(4,1) not null,
  jd_fit_rationale text not null,
  role_fit_rationale text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists candidates_role_id_idx on public.candidates(role_id);

create table if not exists public.candidate_feedback (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  feedback_type text not null check (feedback_type in ('shortlist', 'reject', 'hold')),
  reject_reason text check (
    reject_reason is null
    or reject_reason in (
      'Overqualified',
      'Underqualified',
      'Wrong industry',
      'Poor stability',
      'Missing skills',
      'Other'
    )
  ),
  created_at timestamptz not null default now()
);

create index if not exists candidate_feedback_role_id_idx on public.candidate_feedback(role_id);
create index if not exists candidate_feedback_candidate_id_idx on public.candidate_feedback(candidate_id);

drop trigger if exists candidates_set_updated_at on public.candidates;
create trigger candidates_set_updated_at
before update on public.candidates
for each row execute function public.set_updated_at();

alter table public.candidates enable row level security;
alter table public.candidate_feedback enable row level security;

drop policy if exists "Allow anon insert candidates" on public.candidates;
create policy "Allow anon insert candidates"
on public.candidates for insert to anon with check (true);

drop policy if exists "Allow anon select candidates" on public.candidates;
create policy "Allow anon select candidates"
on public.candidates for select to anon using (true);

drop policy if exists "Allow anon update candidates" on public.candidates;
create policy "Allow anon update candidates"
on public.candidates for update to anon using (true) with check (true);

drop policy if exists "Allow anon delete candidates" on public.candidates;
create policy "Allow anon delete candidates"
on public.candidates for delete to anon using (true);

drop policy if exists "Allow anon insert candidate_feedback" on public.candidate_feedback;
create policy "Allow anon insert candidate_feedback"
on public.candidate_feedback for insert to anon with check (true);

drop policy if exists "Allow anon select candidate_feedback" on public.candidate_feedback;
create policy "Allow anon select candidate_feedback"
on public.candidate_feedback for select to anon using (true);

drop policy if exists "Allow anon update roles" on public.roles;
create policy "Allow anon update roles"
on public.roles for update to anon using (true) with check (true);
