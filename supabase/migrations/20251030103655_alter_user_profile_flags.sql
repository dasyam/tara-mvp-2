-- supabase/migrations/20251102_alter_user_profile_flags.sql
alter table public.user_profile
  add column if not exists has_kids boolean default false,
  add column if not exists shift_worker boolean default false;

-- Ensure goal exists and holds canonical or 'mixed'
alter table public.user_profile
  add column if not exists goal text;
