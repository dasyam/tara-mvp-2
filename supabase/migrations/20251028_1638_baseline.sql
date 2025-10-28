-- =========================================================
-- Tara Sleep MVP: core schema (idempotent)
-- Safe to run multiple times in prod or preview projects
-- =========================================================

-- UUIDs
create extension if not exists pgcrypto;

-- ======================
-- TABLES
-- ======================

-- users profile (minimal; auth.users holds email)
create table if not exists public.user_profile (
  user_id uuid primary key references auth.users(id) on delete cascade,
  preferred_name text,
  bedtime_window text,
  goal text,                                  -- "sleep faster" | "wake fresh" | "consistency"
  created_at timestamptz default now()
);

-- daily system outcome rating
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  date date not null,                         -- UTC date of the rating
  metric text not null,                       -- e.g. "sleep_quality"
  value integer not null check (value between 1 and 5),  -- 1..5 mapping
  note text,
  created_at timestamptz default now(),
  unique(user_id, date, metric)
);

-- rituals to render glowing nodes on Home (seed 3 rows per user or global via NULL user_id)
create table if not exists public.rituals (
  ritual_id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,  -- nullable for global rituals
  name text not null,                   -- "Morning Calm"
  tagline text not null,                -- "10-min walk improves focus"
  color text not null,                  -- "purple" | "green" | "blue"
  category text check (category in ('Food','Movement','Mind','Sleep')),
  time_block text check (time_block in ('Morning','Day','Evening','Night')),
  active boolean not null default true,
  created_at timestamptz default now()
);

-- conversational intake → JSON timeline
create table if not exists public.timelines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  goal text,
  bedtime_window text,
  timeline_json jsonb not null,
  created_at timestamptz default now()
);

-- ======================
-- RLS
-- ======================

alter table public.user_profile enable row level security;
alter table public.feedback     enable row level security;
alter table public.rituals      enable row level security;
alter table public.timelines    enable row level security;

-- Policies must be created once. Use DO blocks to avoid duplicates.

-- user_profile policies
do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='user_profile' and policyname='owner can read own profile'
  ) then
    create policy "owner can read own profile"
      on public.user_profile for select
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='user_profile' and policyname='owner can upsert own profile'
  ) then
    create policy "owner can upsert own profile"
      on public.user_profile for insert
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='user_profile' and policyname='owner can update own profile'
  ) then
    create policy "owner can update own profile"
      on public.user_profile for update
      using (auth.uid() = user_id);
  end if;
end$$;

-- feedback policies
do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='feedback' and policyname='owner can CRUD own feedback'
  ) then
    create policy "owner can CRUD own feedback"
      on public.feedback for all
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end$$;

-- rituals policies
do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='rituals' and policyname='owner can CRUD own rituals'
  ) then
    create policy "owner can CRUD own rituals"
      on public.rituals for all
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;

  -- Optional read access to global rituals (user_id is NULL). Enable only if needed.
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='rituals' and policyname='anyone can read global rituals'
  ) then
    create policy "anyone can read global rituals"
      on public.rituals for select
      using (user_id is null and active = true);
  end if;
end$$;

-- timelines policies
do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='timelines' and policyname='owner can CRUD own timelines'
  ) then
    create policy "owner can CRUD own timelines"
      on public.timelines for all
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end$$;

-- ======================
-- INDEXES
-- ======================

-- Ensure idempotent upserts for user-scoped ritual seeds
create unique index if not exists rituals_user_cat_block_name_idx
  on public.rituals (user_id, category, time_block, name);

-- Helpful query paths
create index if not exists feedback_user_date_idx
  on public.feedback (user_id, date);

create index if not exists rituals_user_active_idx
  on public.rituals (user_id, active);
