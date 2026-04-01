-- Verify required tables exist
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'event_pages',
    'event_days',
    'event_locations',
    'event_schedule',
    'event_vendors'
  )
order by table_name;

-- Verify required slugs exist
select slug, event_name
from public.event_pages
where slug in (
  'christmas-on-vinegar-hill',
  'community-events',
  'fall-fest',
  'second-fridays',
  'high-school-events',
  'town-services'
)
order by slug;

-- Count per COVH table
select 'event_days' as table_name, count(*) as row_count from public.event_days where page_slug = 'christmas-on-vinegar-hill'
union all
select 'event_locations', count(*) from public.event_locations where page_slug = 'christmas-on-vinegar-hill'
union all
select 'event_schedule', count(*) from public.event_schedule where page_slug = 'christmas-on-vinegar-hill'
union all
select 'event_vendors', count(*) from public.event_vendors where page_slug = 'christmas-on-vinegar-hill';

-- Validate flyer object exists in DB for COVH page
select
  slug,
  (flyer is not null) as has_flyer_column,
  (raw->'flyer' is not null) as has_flyer_in_raw
from public.event_pages
where slug = 'christmas-on-vinegar-hill';

-- Optional: quick RLS sanity check for anon (run as anon role/session)
-- select slug from public.event_pages limit 1;
