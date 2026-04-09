create extension if not exists pgcrypto;

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  website_url text not null unique,
  public_context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  job_description text not null,
  internal_context jsonb not null default '{}'::jsonb,
  briefing jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists roles_company_id_idx on public.roles(company_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists companies_set_updated_at on public.companies;
create trigger companies_set_updated_at
before update on public.companies
for each row execute function public.set_updated_at();

drop trigger if exists roles_set_updated_at on public.roles;
create trigger roles_set_updated_at
before update on public.roles
for each row execute function public.set_updated_at();

alter table public.companies enable row level security;
alter table public.roles enable row level security;

drop policy if exists "Allow anon insert companies" on public.companies;
create policy "Allow anon insert companies"
on public.companies
for insert
to anon
with check (true);

drop policy if exists "Allow anon select companies" on public.companies;
create policy "Allow anon select companies"
on public.companies
for select
to anon
using (true);

drop policy if exists "Allow anon update companies" on public.companies;
create policy "Allow anon update companies"
on public.companies
for update
to anon
using (true)
with check (true);

drop policy if exists "Allow anon insert roles" on public.roles;
create policy "Allow anon insert roles"
on public.roles
for insert
to anon
with check (true);

drop policy if exists "Allow anon select roles" on public.roles;
create policy "Allow anon select roles"
on public.roles
for select
to anon
using (true);
