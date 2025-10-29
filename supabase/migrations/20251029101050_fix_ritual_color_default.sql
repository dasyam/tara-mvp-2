-- 20251101_fix_ritual_color_default.sql
alter table public.rituals
  alter column color set default '#8b5cf6';

update public.rituals
set color = '#8b5cf6'
where (color is null or color = '');

alter table public.rituals
  alter column color set not null;
