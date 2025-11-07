-- supabase/migrations/20251102_rituals_color_default.sql
alter table public.rituals
  alter column color set default '#8B5CF6';
