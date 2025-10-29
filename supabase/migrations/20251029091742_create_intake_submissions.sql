-- Intake submissions audit log (raw + parsed)
create table if not exists public.intake_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal text,
  bedtime_window text,
  routine_text text,         -- raw user text
  parsed boolean default false,
  response jsonb,            -- parsed response (timeline_json + seed_rituals)
  created_at timestamptz default now()
);

alter table public.intake_submissions enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='intake_submissions'
      and policyname='owner can CRUD own intake submissions'
  ) then
    create policy "owner can CRUD own intake submissions"
      on public.intake_submissions
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end$$;

-- Helpful index for analytics
create index if not exists intake_submissions_user_created_idx
  on public.intake_submissions (user_id, created_at desc);
