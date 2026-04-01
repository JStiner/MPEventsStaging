-- COVH readiness verification (run in Supabase SQL editor)
-- Slug under test
--   christmas-on-vinegar-hill

-- 1) Required page row
select slug, event_name, event_type, date_label, area_label
from public.event_pages
where slug = 'christmas-on-vinegar-hill';

-- 2) Required tab/resource/flyer presence in page payload
select
  slug,
  tabs,
  resources,
  (flyer is not null) as has_flyer_column,
  (raw->'flyer' is not null) as has_flyer_in_raw
from public.event_pages
where slug = 'christmas-on-vinegar-hill';

-- 3) Row counts for dependent tables
select 'event_days' as table_name, count(*) as row_count
from public.event_days where page_slug = 'christmas-on-vinegar-hill'
union all
select 'event_locations', count(*)
from public.event_locations where page_slug = 'christmas-on-vinegar-hill'
union all
select 'event_schedule', count(*)
from public.event_schedule where page_slug = 'christmas-on-vinegar-hill'
union all
select 'event_vendors', count(*)
from public.event_vendors where page_slug = 'christmas-on-vinegar-hill';

-- 4) Location key quality (IDs + names should exist)
select count(*) as missing_location_identity
from public.event_locations
where page_slug = 'christmas-on-vinegar-hill'
  and (external_id is null or name is null);

-- 5) Schedule linkage quality
-- Every schedule row should have a date and location_external_id
select count(*) as invalid_schedule_rows
from public.event_schedule
where page_slug = 'christmas-on-vinegar-hill'
  and (event_date is null or location_external_id is null);

-- 6) Broken schedule -> location references
select s.external_id as schedule_external_id, s.location_external_id
from public.event_schedule s
left join public.event_locations l
  on l.page_slug = s.page_slug
 and l.external_id = s.location_external_id
where s.page_slug = 'christmas-on-vinegar-hill'
  and l.external_id is null;

-- 7) Vendor linkage quality (if vendor_ids are used)
-- Finds schedule rows that reference vendor IDs not present in event_vendors.
with vendor_ids as (
  select page_slug, external_id
  from public.event_vendors
  where page_slug = 'christmas-on-vinegar-hill'
),
schedule_vendor_ids as (
  select
    s.external_id as schedule_external_id,
    s.page_slug,
    unnest(coalesce(s.vendor_ids, '{}')) as vendor_id
  from public.event_schedule s
  where s.page_slug = 'christmas-on-vinegar-hill'
)
select svi.schedule_external_id, svi.vendor_id
from schedule_vendor_ids svi
left join vendor_ids v
  on v.page_slug = svi.page_slug
 and v.external_id = svi.vendor_id
where v.external_id is null;

-- 8) Flyer asset keys (for manual URL validation in browser)
-- If assets are embedded in flyer JSON, this extracts common keys.
select
  slug,
  coalesce(
    flyer #>> '{assets,headerGraphic}',
    raw #>> '{flyer,assets,headerGraphic}'
  ) as header_graphic,
  coalesce(
    flyer #>> '{assets,bagIcon}',
    raw #>> '{flyer,assets,bagIcon}'
  ) as bag_icon,
  coalesce(
    flyer #>> '{assets,qrMap}',
    raw #>> '{flyer,assets,qrMap}'
  ) as qr_map,
  coalesce(
    flyer #>> '{assets,maps,mtPulaski}',
    raw #>> '{flyer,assets,maps,mtPulaski}'
  ) as map_mt_pulaski
from public.event_pages
where slug = 'christmas-on-vinegar-hill';
