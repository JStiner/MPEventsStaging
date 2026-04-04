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
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
  throw new Error('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_ANON_KEY are required.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed. Use POST.' }, 405);
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? '';

    if (!authHeader) {
      return json({ ok: false, error: 'Missing Authorization header.' }, 401);
    }

    const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    const {
      data: { user },
      error: userError,
    } = await callerClient.auth.getUser();

    if (userError || !user) {
      return json({ ok: false, error: 'Unauthorized.' }, 401);
    }

    const { data: profile, error: profileError } = await callerClient
      .from('profiles')
      .select('id,email,is_admin')
      .eq('id', user.id)
      .single();

    if (profileError) {
      return json({ ok: false, error: profileError.message || 'Unable to load profile.' }, 403);
    }

    if (!profile?.is_admin) {
      return json({ ok: false, error: 'Forbidden.' }, 403);
    }

    const body = await req.json().catch(() => ({}));

    const requestedSourceKeys = Array.isArray(body?.sourceKeys)
      ? body.sourceKeys.map((value: unknown) => String(value || '').trim()).filter(Boolean)
      : body?.source_key
        ? [String(body.source_key).trim()].filter(Boolean)
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
      const runResult = await runSingleSource(source, profile.email || user.email || user.id);
      results.push(runResult);
    }

    return json({ ok: true, results });
  } catch (error) {
    console.error('import-events fatal error', error);
    return json({ ok: false, error: (error as Error).message }, 500);
  }
});