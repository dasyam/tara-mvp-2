-- supabase/migrations/20251102_alter_user_profile_flags.sql
-- Profile flags for effort overrides
-- Add has_kids if missing
do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'user_profile'
      and column_name  = 'has_kids'
  ) then
    alter table public.user_profile
      add column has_kids boolean default false;
  end if;
end
$$;

-- Add shift_worker if missing
do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'user_profile'
      and column_name  = 'shift_worker'
  ) then
    alter table public.user_profile
      add column shift_worker boolean default false;
  end if;
end
$$;