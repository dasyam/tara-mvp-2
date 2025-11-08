-- Ensure UUID generator exists
create extension if not exists pgcrypto;

-- EVENING PLANS (matches your earlier columns)
create table if not exists public.evening_plans(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  trigger_time_anchor text,
  trigger_place text,
  trigger_mood text,
  shield_type text,
  shield_time time,
  divert_ritual text,
  armed_at timestamptz,
  started_now boolean default false,
  completed_evening text check (completed_evening in ('done','partly','skipped')),
  skip_reason text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, date)
);

alter table public.evening_plans enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='evening_plans' and policyname='owner_plans_select'
  ) then
    create policy owner_plans_select on public.evening_plans
      for select using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='evening_plans' and policyname='owner_plans_insert'
  ) then
    create policy owner_plans_insert on public.evening_plans
      for insert with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='evening_plans' and policyname='owner_plans_update'
  ) then
    create policy owner_plans_update on public.evening_plans
      for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='evening_plans' and policyname='owner_plans_delete'
  ) then
    create policy owner_plans_delete on public.evening_plans
      for delete using (auth.uid() = user_id);
  end if;
end $$;

-- keep updated_at fresh
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname='trg_evening_plans_updated_at') then
    create trigger trg_evening_plans_updated_at
    before update on public.evening_plans
    for each row execute function public.set_updated_at();
  end if;
end $$;

-- DAILY SLEEP CHECKINS (optional table you mentioned)
create table if not exists public.daily_sleep_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  mood int2,
  notes text,
  created_at timestamptz not null default now(),
  unique (user_id, date)
);

alter table public.daily_sleep_checkins enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='daily_sleep_checkins' and policyname='sleep sel own'
  ) then
    create policy "sleep sel own"
      on public.daily_sleep_checkins for select
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='daily_sleep_checkins' and policyname='sleep ins own'
  ) then
    create policy "sleep ins own"
      on public.daily_sleep_checkins for insert
      with check (auth.uid() = user_id);
  end if;
end $$;

-- Ask PostgREST to reload schema cache
select pg_notify('pgrst','reload schema');
