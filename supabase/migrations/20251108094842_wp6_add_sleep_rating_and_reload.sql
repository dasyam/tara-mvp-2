-- 20251108_wp6_add_sleep_rating_and_reload.sql

-- Ensure table exists (no-op if already there)
create table if not exists public.daily_sleep_checkins(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  created_at timestamptz default now(),
  unique(user_id, date)
);

-- Add the target column if it doesn't exist
alter table public.daily_sleep_checkins
  add column if not exists sleep_rating_1_5 int check (sleep_rating_1_5 between 1 and 5);

-- (Optional) keep any other columns you want; add them idempotently
alter table public.daily_sleep_checkins
  add column if not exists bedtime time,
  add column if not exists wake_time time,
  add column if not exists device_usage_indicator int;

-- RLS + policies (idempotent)
alter table public.daily_sleep_checkins enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='daily_sleep_checkins' and policyname='owner_checks_select'
  ) then
    create policy owner_checks_select on public.daily_sleep_checkins
      for select using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='daily_sleep_checkins' and policyname='owner_checks_insert'
  ) then
    create policy owner_checks_insert on public.daily_sleep_checkins
      for insert with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='daily_sleep_checkins' and policyname='owner_checks_update'
  ) then
    create policy owner_checks_update on public.daily_sleep_checkins
      for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='daily_sleep_checkins' and policyname='owner_checks_delete'
  ) then
    create policy owner_checks_delete on public.daily_sleep_checkins
      for delete using (auth.uid() = user_id);
  end if;
end $$;

-- 🔄 Force PostgREST to reload its schema cache (fixes PGRST204)
select pg_notify('pgrst','reload schema');
