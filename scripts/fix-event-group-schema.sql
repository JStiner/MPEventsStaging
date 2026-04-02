-- Fix admin calendar save/delete flow to use the actual event group table.
-- The previous implementation referenced public.groups in helper/save logic.

begin;

-- Helper used by save flow: resolve a group ID from slug using the real table.
create or replace function public.resolve_event_group_id_by_slug(_group_slug text)
returns uuid
language plpgsql
stable
as $$
declare
  _group_id uuid;
begin
  if _group_slug is null or btrim(_group_slug) = '' then
    raise exception 'Group slug is required';
  end if;

  select eg.id
    into _group_id
  from public.event_groups eg
  where eg.slug = _group_slug
  limit 1;

  if _group_id is null then
    raise exception 'Unknown event group slug: %', _group_slug;
  end if;

  return _group_id;
end;
$$;

-- Save/update event from admin calendar editor.
create or replace function public.save_event(
  _id uuid default null,
  _group_slug text default null,
  _title text default null,
  _summary text default null,
  _description text default null,
  _location_name text default null,
  _address_line_1 text default null,
  _address_line_2 text default null,
  _city text default null,
  _state text default null,
  _postal_code text default null,
  _all_day boolean default false,
  _start_at timestamptz default null,
  _end_at timestamptz default null,
  _timezone_name text default 'America/Chicago',
  _status text default 'published',
  _visibility text default 'public',
  _source_page_slug text default null,
  _external_id text default null,
  _metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _group_id uuid;
  _saved_id uuid;
begin
  if _title is null or btrim(_title) = '' then
    raise exception 'Title is required';
  end if;

  if _start_at is null then
    raise exception 'Start time is required';
  end if;

  _group_id := public.resolve_event_group_id_by_slug(_group_slug);

  if _id is null then
    insert into public.events (
      group_id,
      title,
      summary,
      description,
      location_name,
      address_line_1,
      address_line_2,
      city,
      state,
      postal_code,
      all_day,
      start_at,
      end_at,
      timezone_name,
      status,
      visibility,
      source_page_slug,
      external_id,
      metadata
    ) values (
      _group_id,
      _title,
      nullif(_summary, ''),
      nullif(_description, ''),
      nullif(_location_name, ''),
      nullif(_address_line_1, ''),
      nullif(_address_line_2, ''),
      nullif(_city, ''),
      nullif(_state, ''),
      nullif(_postal_code, ''),
      coalesce(_all_day, false),
      _start_at,
      _end_at,
      coalesce(nullif(_timezone_name, ''), 'America/Chicago'),
      coalesce(nullif(_status, ''), 'published'),
      coalesce(nullif(_visibility, ''), 'public'),
      coalesce(nullif(_source_page_slug, ''), _group_slug),
      nullif(_external_id, ''),
      coalesce(_metadata, '{}'::jsonb)
    )
    returning id into _saved_id;
  else
    update public.events
    set group_id = _group_id,
        title = _title,
        summary = nullif(_summary, ''),
        description = nullif(_description, ''),
        location_name = nullif(_location_name, ''),
        address_line_1 = nullif(_address_line_1, ''),
        address_line_2 = nullif(_address_line_2, ''),
        city = nullif(_city, ''),
        state = nullif(_state, ''),
        postal_code = nullif(_postal_code, ''),
        all_day = coalesce(_all_day, false),
        start_at = _start_at,
        end_at = _end_at,
        timezone_name = coalesce(nullif(_timezone_name, ''), 'America/Chicago'),
        status = coalesce(nullif(_status, ''), 'published'),
        visibility = coalesce(nullif(_visibility, ''), 'public'),
        source_page_slug = coalesce(nullif(_source_page_slug, ''), _group_slug),
        external_id = nullif(_external_id, ''),
        metadata = coalesce(_metadata, '{}'::jsonb),
        updated_at = now()
    where id = _id
    returning id into _saved_id;

    if _saved_id is null then
      raise exception 'Event not found: %', _id;
    end if;
  end if;

  return _saved_id;
end;
$$;

commit;
