import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

type EventSource = {
  source_key: string;
  page_slug: string;
  name: string | null;
  source_url: string;
  parser_type: string | null;
  auto_publish: boolean | null;
  is_enabled: boolean | null;
};

type NormalizedRow = {
  run_id: number;
  source_key: string;
  page_slug: string;
  external_id: string | null;
  title: string;
  description: string | null;
  location: string | null;
  start_at: string | null;
  end_at: string | null;
  all_day: boolean;
  source_url: string;
  raw_payload: Record<string, unknown>;
  content_hash: string;
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}));
    const requestedSourceKeys = Array.isArray(body?.sourceKeys)
      ? body.sourceKeys.map((value: unknown) => String(value || '').trim()).filter(Boolean)
      : null;

    let query = supabase
      .from('event_sources')
      .select('source_key,page_slug,name,source_url,parser_type,auto_publish,is_enabled')
      .eq('is_enabled', true)
      .order('source_key', { ascending: true });

    if (requestedSourceKeys && requestedSourceKeys.length > 0) {
      query = query.in('source_key', requestedSourceKeys);
    }

    const { data: sources, error: sourceError } = await query;
    if (sourceError) throw sourceError;

    const results: Array<Record<string, unknown>> = [];

    for (const source of (sources || []) as EventSource[]) {
      const runResult = await runSingleSource(source);
      results.push(runResult);
    }

    return json({ ok: true, results });
  } catch (error) {
    console.error('import-events fatal error', error);
    return json({ ok: false, error: (error as Error).message }, 500);
  }
});

async function runSingleSource(source: EventSource): Promise<Record<string, unknown>> {
  const { data: runId, error: beginError } = await supabase.rpc('begin_event_import', {
    p_source_key: source.source_key,
    p_created_by: 'edge:import-events',
  });

  if (beginError) {
    throw beginError;
  }

  const run_id = Number(runId);

  try {
    const normalizedRows = await fetchAndNormalizeSource(source, run_id);

    if (normalizedRows.length > 0) {
      const { error: insertError } = await supabase
        .from('staging_events')
        .insert(normalizedRows);
      if (insertError) throw insertError;
    }

    let publishedCount = 0;
    if (source.auto_publish) {
      const { data: publishResult, error: publishError } = await supabase.rpc('publish_staging_events', {
        p_run_id: run_id,
      });
      if (publishError) throw publishError;
      publishedCount = Number(publishResult || 0);
    }

    const { error: finishError } = await supabase.rpc('finish_event_import_success', {
      p_run_id: run_id,
      p_staged_count: normalizedRows.length,
      p_published_count: publishedCount,
      p_notes: `Imported by edge function on ${new Date().toISOString()}`,
    });
    if (finishError) throw finishError;

    return {
      source_key: source.source_key,
      run_id,
      staged_count: normalizedRows.length,
      published_count: publishedCount,
      status: 'success',
    };
  } catch (error) {
    await supabase.rpc('finish_event_import_failed', {
      p_run_id: run_id,
      p_error_message: (error as Error).message,
      p_notes: `Failed in edge import function at ${new Date().toISOString()}`,
    });

    return {
      source_key: source.source_key,
      run_id,
      status: 'failed',
      error: (error as Error).message,
    };
  }
}

async function fetchAndNormalizeSource(source: EventSource, run_id: number): Promise<NormalizedRow[]> {
  const parserType = (source.parser_type || '').toLowerCase();

  if (parserType === 'ics') {
    const icsText = await fetchText(source.source_url);
    return parseIcsSource(icsText, source, run_id);
  }

  const html = await fetchText(source.source_url);
  return parseCityCalendarHtml(html, source, run_id);
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'mpevents-import-bot/1.0',
      accept: 'text/html, text/calendar, application/xhtml+xml, application/xml;q=0.9, */*;q=0.8',
    },
  });

  if (!response.ok) {
    throw new Error(`Fetch failed (${response.status}) for ${url}`);
  }

  return await response.text();
}

function parseCityCalendarHtml(html: string, source: EventSource, run_id: number): NormalizedRow[] {
  const rows: NormalizedRow[] = [];

  // City of Mt. Pulaski: expected plugin markup often wraps entries in an article/list item with date + title + location.
  // TODO: confirm exact production selector if the city site template changes.
  const blocks = html.match(/<(article|li|div)[^>]*class="[^"]*(tribe-events|eventlist|event-item)[^"]*"[^>]*>[\s\S]*?<\/(article|li|div)>/gi) || [];

  for (const block of blocks) {
    const title = cleanup(stripTags(firstMatch(block, /<(h2|h3|a)[^>]*class="[^"]*(title|summary|event-title)[^"]*"[^>]*>([\s\S]*?)<\/(h2|h3|a)>/i, 3) || firstMatch(block, /<(h2|h3)[^>]*>([\s\S]*?)<\/(h2|h3)>/i, 2) || ''));
    if (!title) continue;

    const href = firstMatch(block, /<a[^>]*href="([^"]+)"[^>]*>/i, 1);
    const description = cleanup(stripTags(firstMatch(block, /<(p|div)[^>]*class="[^"]*(description|summary)[^"]*"[^>]*>([\s\S]*?)<\/(p|div)>/i, 3) || '')) || null;
    const location = cleanup(stripTags(firstMatch(block, /<(span|div)[^>]*class="[^"]*(venue|location)[^"]*"[^>]*>([\s\S]*?)<\/(span|div)>/i, 3) || '')) || null;

    const isoStart = parseDateToIso(firstMatch(block, /datetime="([^"]+)"/i, 1) || firstMatch(block, /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:?\d{2}|Z)?)/i, 1));
    const all_day = !isoStart;

    const raw_payload: Record<string, unknown> = {
      parser_type: source.parser_type || 'html',
      extracted_from: 'city_calendar_html',
      block,
      href,
    };

    const content_hash = stableHash(JSON.stringify({ title, description, location, isoStart, href }));

    rows.push({
      run_id,
      source_key: source.source_key,
      page_slug: source.page_slug,
      external_id: href ? stableHash(href) : null,
      title,
      description,
      location,
      start_at: isoStart,
      end_at: null,
      all_day,
      source_url: source.source_url,
      raw_payload,
      content_hash,
    });
  }

  return dedupeRows(rows);
}

function parseIcsSource(icsText: string, source: EventSource, run_id: number): NormalizedRow[] {
  const blocks = icsText.split('BEGIN:VEVENT').slice(1).map((part) => `BEGIN:VEVENT${part}`);
  const rows: NormalizedRow[] = [];

  for (const block of blocks) {
    const uid = unfoldIcs(findIcsValue(block, 'UID'));
    const title = unfoldIcs(findIcsValue(block, 'SUMMARY'));
    if (!title) continue;

    const description = unfoldIcs(findIcsValue(block, 'DESCRIPTION')) || null;
    const location = unfoldIcs(findIcsValue(block, 'LOCATION')) || null;
    const dtStartRaw = findIcsValue(block, 'DTSTART');
    const dtEndRaw = findIcsValue(block, 'DTEND');

    const start_at = parseIcsDate(dtStartRaw);
    const end_at = parseIcsDate(dtEndRaw);
    const all_day = /VALUE=DATE/i.test(dtStartRaw || '');

    const raw_payload: Record<string, unknown> = {
      parser_type: 'ics',
      uid,
      dtStartRaw,
      dtEndRaw,
      block,
    };

    const content_hash = stableHash(JSON.stringify({ uid, title, description, location, start_at, end_at }));

    rows.push({
      run_id,
      source_key: source.source_key,
      page_slug: source.page_slug,
      external_id: uid || null,
      title,
      description,
      location,
      start_at,
      end_at,
      all_day,
      source_url: source.source_url,
      raw_payload,
      content_hash,
    });
  }

  return dedupeRows(rows);
}

function dedupeRows(rows: NormalizedRow[]): NormalizedRow[] {
  const seen = new Set<string>();
  const deduped: NormalizedRow[] = [];

  for (const row of rows) {
    const key = `${row.page_slug}::${row.external_id || row.content_hash}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }

  return deduped;
}

function cleanup(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, ' ');
}

function firstMatch(value: string, pattern: RegExp, group = 1): string {
  const match = value.match(pattern);
  return match?.[group] || '';
}

function parseDateToIso(value: string): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function findIcsValue(block: string, key: string): string {
  const pattern = new RegExp(`^${key}(?:;[^:]*)?:(.*)$`, 'im');
  const match = block.match(pattern);
  return match?.[1] || '';
}

function unfoldIcs(value: string): string {
  return (value || '').replace(/\\n/g, '\n').replace(/\r?\n[ \t]/g, '').trim();
}

function parseIcsDate(value: string): string | null {
  const raw = unfoldIcs(value);
  if (!raw) return null;

  const zulu = raw.match(/^(\d{8})T(\d{6})Z$/);
  if (zulu) {
    const [_, day, time] = zulu;
    const iso = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}Z`;
    return parseDateToIso(iso);
  }

  const localWithTime = raw.match(/^(\d{8})T(\d{6})$/);
  if (localWithTime) {
    const [_, day, time] = localWithTime;
    const iso = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}-05:00`;
    return parseDateToIso(iso);
  }

  const dateOnly = raw.match(/^(\d{8})$/);
  if (dateOnly) {
    const [_, day] = dateOnly;
    return parseDateToIso(`${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T00:00:00-06:00`);
  }

  return parseDateToIso(raw);
}

function stableHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return `h${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
