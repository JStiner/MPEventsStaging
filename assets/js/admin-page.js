const supabaseClient = window.supabaseClient;

if (!supabaseClient) {
  console.error('Supabase client is not available for admin page.');
}

const params = new URLSearchParams(window.location.search);
const groupSlug = params.get('group');

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function getSessionOrRedirect() {
  const { data, error } = await supabaseClient.auth.getSession();
  if (error) throw error;
  if (!data.session?.user) {
    window.location.href = './index.html';
    return null;
  }
  return data.session;
}

async function getAccess() {
  const { data, error } = await supabaseClient.rpc('get_my_access');
  if (error) throw error;
  return data || [];
}

async function loadEvents() {
  const { data, error } = await supabaseClient
    .from('events')
    .select(`
      id,
      title,
      summary,
      description,
      location_name,
      address_line_1,
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
      metadata,
      event_groups!inner(slug, name)
    `)
    .eq('event_groups.slug', groupSlug)
    .order('start_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

function renderEvents(rows) {
  const mount = document.getElementById('eventsTableBody');
  mount.innerHTML = rows.map(row => `
    <tr>
      <td>${escapeHtml(row.title)}</td>
      <td>${escapeHtml(row.start_at || '')}</td>
      <td>${escapeHtml(row.location_name || '')}</td>
      <td>${escapeHtml(row.status || '')}</td>
      <td><button type="button" class="edit-btn" data-id="${row.id}">Edit</button></td>
    </tr>
  `).join('');

  mount.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const row = rows.find(x => x.id === btn.dataset.id);
      if (row) fillForm(row);
    });
  });
}

function fillForm(row = {}) {
  document.getElementById('eventId').value = row.id || '';
  document.getElementById('title').value = row.title || '';
  document.getElementById('summary').value = row.summary || '';
  document.getElementById('description').value = row.description || '';
  document.getElementById('location_name').value = row.location_name || '';
  document.getElementById('address_line_1').value = row.address_line_1 || '';
  document.getElementById('city').value = row.city || 'Mt. Pulaski';
  document.getElementById('state').value = row.state || 'IL';
  document.getElementById('postal_code').value = row.postal_code || '';
  document.getElementById('all_day').checked = !!row.all_day;
  document.getElementById('start_at').value = row.start_at ? row.start_at.slice(0, 16) : '';
  document.getElementById('end_at').value = row.end_at ? row.end_at.slice(0, 16) : '';
  document.getElementById('timezone_name').value = row.timezone_name || 'America/Chicago';
  document.getElementById('status').value = row.status || 'published';
  document.getElementById('visibility').value = row.visibility || 'public';
  document.getElementById('source_page_slug').value = row.source_page_slug || groupSlug;
  document.getElementById('external_id').value = row.external_id || '';
  document.getElementById('metadata').value = JSON.stringify(row.metadata || {}, null, 2);
}

function resetForm() {
  fillForm({ source_page_slug: groupSlug, city: 'Mt. Pulaski', state: 'IL', timezone_name: 'America/Chicago', status: 'published', visibility: 'public' });
}

async function saveEvent(event) {
  event.preventDefault();

  const payload = {
    _id: document.getElementById('eventId').value || null,
    _group_slug: groupSlug,
    _title: document.getElementById('title').value.trim(),
    _summary: document.getElementById('summary').value.trim() || null,
    _description: document.getElementById('description').value.trim() || null,
    _location_name: document.getElementById('location_name').value.trim() || null,
    _address_line_1: document.getElementById('address_line_1').value.trim() || null,
    _address_line_2: null,
    _city: document.getElementById('city').value.trim() || null,
    _state: document.getElementById('state').value.trim() || null,
    _postal_code: document.getElementById('postal_code').value.trim() || null,
    _all_day: document.getElementById('all_day').checked,
    _start_at: document.getElementById('start_at').value,
    _end_at: document.getElementById('end_at').value || null,
    _timezone_name: document.getElementById('timezone_name').value.trim() || 'America/Chicago',
    _status: document.getElementById('status').value,
    _visibility: document.getElementById('visibility').value,
    _source_page_slug: document.getElementById('source_page_slug').value.trim() || groupSlug,
    _external_id: document.getElementById('external_id').value.trim() || null,
    _metadata: safelyParseJson(document.getElementById('metadata').value),
  };

  const { error } = await supabaseClient.rpc('save_event', payload);
  if (error) {
    document.getElementById('formError').textContent = error.message;
    return;
  }

  document.getElementById('formError').textContent = '';
  await initPage();
  resetForm();
}

async function deleteEvent() {
  const eventId = document.getElementById('eventId').value;
  if (!eventId) return;

  const { error } = await supabaseClient.rpc('delete_event', { _event_id: eventId });
  if (error) {
    document.getElementById('formError').textContent = error.message;
    return;
  }

  document.getElementById('formError').textContent = '';
  await initPage();
  resetForm();
}

function safelyParseJson(text) {
  if (!text?.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function initPage() {
  await getSessionOrRedirect();
  const accessRows = await getAccess();
  const hasAccess = accessRows.some(row => row.is_admin || row.group_slug === groupSlug);
  if (!hasAccess) {
    document.body.innerHTML = '<main class="admin-page"><h1>Access denied</h1><p>You do not have access to this group.</p></main>';
    return;
  }

  document.getElementById('groupSlugLabel').textContent = groupSlug || '';
  const rows = await loadEvents();
  renderEvents(rows);
}

window.addEventListener('DOMContentLoaded', async () => {
  if (!supabaseClient) {
    const errorEl = document.getElementById('formError');
    if (errorEl) errorEl.textContent = 'Admin editor is unavailable until Supabase loads.';
    return;
  }
  document.getElementById('eventForm')?.addEventListener('submit', saveEvent);
  document.getElementById('newEventBtn')?.addEventListener('click', resetForm);
  document.getElementById('deleteEventBtn')?.addEventListener('click', deleteEvent);
  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
    window.location.href = './index.html';
  });

  resetForm();
  await initPage();
});
