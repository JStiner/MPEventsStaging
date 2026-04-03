-- Supabase-native external event import pipeline for event_schedule.

alter table if exists public.event_schedule
  add column if not exists source_key text,
  add column if not exists source_url text,
  add column if not exists import_hash text,
  add column if not exists is_imported boolean not null default false,
  add column if not exists is_active boolean not null default true,
  add column if not exists last_import_run_id bigint;

create index if not exists idx_event_schedule_import_lookup
  on public.event_schedule (source_key, page_slug, external_id);

create index if not exists idx_event_schedule_import_active
  on public.event_schedule (is_imported, is_active);

create or replace function public.begin_event_import(
  p_source_key text,
  p_created_by text default 'system'
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_id bigint;
begin
  if p_source_key is null or btrim(p_source_key) = '' then
    raise exception 'p_source_key is required';
  end if;

  insert into public.event_import_runs (
    source_key,
    status,
    created_by,
    started_at
  )
  values (
    btrim(p_source_key),
    'running',
    coalesce(nullif(btrim(p_created_by), ''), 'system'),
    now()
  )
  returning id into v_run_id;

  return v_run_id;
end;
$$;

create or replace function public.finish_event_import_success(
  p_run_id bigint,
  p_staged_count integer default null,
  p_published_count integer default null,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.event_import_runs
     set status = 'success',
         finished_at = now(),
         staged_count = coalesce(p_staged_count, staged_count, 0),
         published_count = coalesce(p_published_count, published_count, 0),
         notes = coalesce(nullif(p_notes, ''), notes),
         updated_at = now()
   where id = p_run_id;

  if not found then
    raise exception 'Run not found: %', p_run_id;
  end if;
end;
$$;

create or replace function public.finish_event_import_failed(
  p_run_id bigint,
  p_error_message text,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.event_import_runs
     set status = 'failed',
         finished_at = now(),
         error_message = left(coalesce(p_error_message, 'Unknown import failure'), 4000),
         notes = coalesce(nullif(p_notes, ''), notes),
         updated_at = now()
   where id = p_run_id;

  if not found then
    raise exception 'Run not found: %', p_run_id;
  end if;
end;
$$;

create or replace function public.publish_staging_events(p_run_id bigint)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_key text;
  v_upserted_count integer := 0;
begin
  select source_key
    into v_source_key
  from public.event_import_runs
  where id = p_run_id;

  if v_source_key is null then
    raise exception 'Import run not found: %', p_run_id;
  end if;

  with normalized as (
    select
      se.page_slug,
      coalesce(nullif(btrim(se.external_id), ''), se.content_hash) as resolved_external_id,
      se.title,
      se.description,
      se.location,
      se.start_at,
      se.end_at,
      coalesce(se.all_day, false) as all_day,
      se.source_url,
      se.raw_payload,
      se.content_hash,
      se.source_key,
      p_run_id as run_id
    from public.staging_events se
    where se.run_id = p_run_id
      and se.source_key = v_source_key
      and se.page_slug is not null
      and btrim(se.page_slug) <> ''
      and se.content_hash is not null
  ),
  upserted as (
    insert into public.event_schedule (
      page_slug,
      external_id,
      title,
      start_time,
      end_time,
      location_external_id,
      category,
      description,
      vendor_ids,
      event_date,
      sort_order,
      raw,
      source_key,
      source_url,
      import_hash,
      is_imported,
      is_active,
      last_import_run_id
    )
    select
      n.page_slug,
      n.resolved_external_id,
      n.title,
      case
        when n.all_day then null
        when n.start_at is null then null
        else to_char(n.start_at at time zone 'America/Chicago', 'FMHH12:MI AM')
      end as start_time,
      case
        when n.all_day then null
        when n.end_at is null then null
        else to_char(n.end_at at time zone 'America/Chicago', 'FMHH12:MI AM')
      end as end_time,
      null,
      null,
      n.description,
      null,
      (n.start_at at time zone 'America/Chicago')::date,
      null,
      coalesce(es.raw, '{}'::jsonb) || jsonb_build_object(
        'source_key', n.source_key,
        'source_url', n.source_url,
        'import_hash', n.content_hash,
        'last_import_run_id', n.run_id,
        'raw_payload', n.raw_payload,
        'location', n.location,
        'all_day', n.all_day,
        'is_imported', true,
        'is_active', true
      ),
      n.source_key,
      n.source_url,
      n.content_hash,
      true,
      true,
      n.run_id
    from normalized n
    left join public.event_schedule es
      on es.page_slug = n.page_slug
     and es.external_id = n.resolved_external_id
    on conflict (page_slug, external_id)
    do update
      set title = excluded.title,
          start_time = excluded.start_time,
          end_time = excluded.end_time,
          description = excluded.description,
          event_date = excluded.event_date,
          raw = coalesce(public.event_schedule.raw, '{}'::jsonb) || excluded.raw,
          source_key = excluded.source_key,
          source_url = excluded.source_url,
          import_hash = excluded.import_hash,
          is_imported = true,
          is_active = true,
          last_import_run_id = excluded.last_import_run_id,
          updated_at = now()
      where public.event_schedule.is_imported = true
    returning 1
  )
  select count(*) into v_upserted_count from upserted;

  update public.event_schedule es
     set is_active = false,
         last_import_run_id = p_run_id,
         raw = coalesce(es.raw, '{}'::jsonb) || jsonb_build_object(
           'is_active', false,
           'last_import_run_id', p_run_id
         ),
         updated_at = now()
   where es.source_key = v_source_key
     and es.is_imported = true
     and exists (
       select 1
       from public.staging_events se_scope
       where se_scope.run_id = p_run_id
         and se_scope.source_key = v_source_key
         and se_scope.page_slug = es.page_slug
     )
     and not exists (
       select 1
       from public.staging_events se_keep
       where se_keep.run_id = p_run_id
         and se_keep.source_key = v_source_key
         and se_keep.page_slug = es.page_slug
         and coalesce(nullif(btrim(se_keep.external_id), ''), se_keep.content_hash) = es.external_id
     );

  update public.event_import_runs
     set published_count = v_upserted_count,
         updated_at = now()
   where id = p_run_id;

  return v_upserted_count;
end;
$$;

drop view if exists public.v_event_import_runs;

create view public.v_event_import_runs as
select
  r.id,
  r.source_key,
  s.page_slug,
  s.name as source_name,
  s.parser_type,
  s.source_url,
  r.status,
  r.started_at,
  r.finished_at,
  r.staged_count,
  r.published_count,
  r.error_message,
  r.created_by,
  r.updated_at,
  extract(epoch from (coalesce(r.finished_at, now()) - r.started_at))::integer as duration_seconds
from public.event_import_runs r
left join public.event_sources s
  on s.source_key = r.source_key
order by r.started_at desc;
