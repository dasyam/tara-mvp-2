-- supabase/migrations/20251102_create_engine_runs.sql
-- Create table
create table if not exists public.engine_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  timeline_id uuid references public.timelines(id) on delete set null,
  engine_version text not null,
  goal text,
  top3_json jsonb not null,
  opportunity_scores jsonb not null,
  created_at timestamptz default now()
);

-- Enable RLS (safe to run multiple times)
alter table public.engine_runs enable row level security;

-- Read policy (idempotent)
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'engine_runs'
      and policyname = 'owner can read own engine runs'
  ) then
    create policy "owner can read own engine runs"
      on public.engine_runs
      for select
      using (auth.uid() = user_id);
  end if;
end
$$;

-- Insert policy (idempotent)
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'engine_runs'
      and policyname = 'owner can insert engine runs'
  ) then
    create policy "owner can insert engine runs"
      on public.engine_runs
      for insert
      with check (auth.uid() = user_id);
  end if;
end
$$;
