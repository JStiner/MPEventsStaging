const supabaseClient = window.supabaseClient;

const GROUP_SUBVIEW_KEYS = ['calendar', 'pages', 'schedule', 'vendors', 'locations', 'flyer', 'resources', 'settings'];
const GROUP_SUBVIEW_LABELS = {
  calendar: 'Calendar',
  pages: 'General',
  schedule: 'Schedule',
  vendors: 'Vendors',
  locations: 'Locations',
  flyer: 'Flyer',
  resources: 'Resources',
  settings: 'Settings',
};

const state = {
  user: null,
  profile: null,
  groups: [],
  memberships: [],
  tabs: [],
  activeTab: null,
  auditRows: [],
  groupData: {},
  selectedGroupViewBySlug: {},
  selectedPageByGroup: {},
  selectedDayByGroup: {},
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatDate(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString();
}

function sortByName(rows, key = 'name') {
  return rows.slice().sort((a, b) => String(a?.[key] || '').localeCompare(String(b?.[key] || '')));
}

function sortByDate(rows) {
  return rows.slice().sort((a, b) => {
    const aDate = String(a?.event_date || '');
    const bDate = String(b?.event_date || '');
    if (aDate !== bDate) return aDate.localeCompare(bDate);
    return Number(a?.sort_order || 0) - Number(b?.sort_order || 0);
  });
}

function sortByOrderThenName(rows, key = 'name') {
  return rows.slice().sort((a, b) => {
    const aSort = Number.isFinite(Number(a?.sort_order)) ? Number(a.sort_order) : null;
    const bSort = Number.isFinite(Number(b?.sort_order)) ? Number(b.sort_order) : null;
    if (aSort !== null && bSort !== null && aSort !== bSort) return aSort - bSort;
    if (aSort !== null && bSort === null) return -1;
    if (aSort === null && bSort !== null) return 1;
    return String(a?.[key] || '').localeCompare(String(b?.[key] || ''));
  });
}

function getId() {
  return (window.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(16).slice(2)}`).slice(0, 60);
}

function parseJsonField(text, fallback = {}) {
  const value = String(text || '').trim();
  if (!value) return fallback;
  return JSON.parse(value);
}

async function requireUser() {
  const { data, error } = await supabaseClient.auth.getSession();
  if (error) throw error;
  const user = data.session?.user;
  if (!user) {
    window.location.href = './login.html';
    return null;
  }
  return user;
}

async function fetchProfile(userId) {
  const { data, error } = await supabaseClient
    .from('profiles')
    .select('id, email, display_name, is_admin')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return data;
}

async function fetchAllGroups() {
  const { data, error } = await supabaseClient.from('event_groups').select('id, slug, name').order('name');
  if (error) throw error;
  return data || [];
}

async function fetchMemberships(userId) {
  const { data, error } = await supabaseClient
    .from('group_memberships')
    .select('group_id, role, event_groups(id, slug, name)')
    .eq('user_id', userId);
  if (error) throw error;
  return data || [];
}

async function fetchAuditRows() {
  const viewResult = await supabaseClient
    .from('v_audit_log_admin')
    .select('id, changed_at, changed_by_email, table_name, action, group_slug, page_slug, record_label')
    .order('changed_at', { ascending: false })
    .limit(100);
  if (!viewResult.error) return viewResult.data || [];

  const tableResult = await supabaseClient
    .from('audit_log')
    .select('id, changed_at, changed_by_email, table_name, action, group_slug, page_slug, record_label')
    .order('changed_at', { ascending: false })
    .limit(100);
  if (tableResult.error) throw tableResult.error;
  return tableResult.data || [];
}

async function loadGroupData(groupSlug) {
  const pageResult = await supabaseClient.from('event_pages').select('*').eq('group_slug', groupSlug).order('event_name');
  if (pageResult.error) throw pageResult.error;

  const pages = pageResult.data || [];
  const pageSlugs = pages.map((p) => p.slug).filter(Boolean);
  if (!pageSlugs.length) {
    return { pages: [], days: [], schedule: [], locations: [], vendors: [], loaded: true, error: null };
  }

  const [daysResult, scheduleResult, locationsResult, vendorsResult] = await Promise.all([
    supabaseClient.from('event_days').select('*').in('page_slug', pageSlugs),
    supabaseClient.from('event_schedule').select('*').in('page_slug', pageSlugs),
    supabaseClient.from('event_locations').select('*').in('page_slug', pageSlugs),
    supabaseClient.from('event_vendors').select('*').in('page_slug', pageSlugs),
  ]);

  if (daysResult.error) throw daysResult.error;
  if (scheduleResult.error) throw scheduleResult.error;
  if (locationsResult.error) throw locationsResult.error;
  if (vendorsResult.error) throw vendorsResult.error;

  return {
    loaded: true,
    error: null,
    pages,
    days: daysResult.data || [],
    schedule: scheduleResult.data || [],
    locations: locationsResult.data || [],
    vendors: vendorsResult.data || [],
  };
}

function getGroupFromTab(tabKey) {
  return state.tabs.find((tab) => tab.key === tabKey)?.group;
}

function currentGroupData(groupSlug) {
  return state.groupData[groupSlug] || { loaded: false, pages: [], days: [], schedule: [], locations: [], vendors: [], error: null };
}

function buildTabs() {
  const tabs = [];
  if (state.profile?.is_admin) {
    state.groups.forEach((group) => tabs.push({ key: `group:${group.slug}`, type: 'group', group }));
    tabs.push({ key: 'admin', type: 'admin', label: 'Admin' });
    tabs.push({ key: 'audit', type: 'audit', label: 'Audit' });
    return tabs;
  }

  const seen = new Set();
  state.memberships.forEach((membership) => {
    const group = membership.event_groups;
    if (!group?.slug || seen.has(group.slug)) return;
    seen.add(group.slug);
    tabs.push({ key: `group:${group.slug}`, type: 'group', group });
  });
  tabs.push({ key: 'admin', type: 'admin', label: 'Admin' });
  return tabs;
}

function renderTabs() {
  const mount = document.getElementById('adminTabs');
  mount.innerHTML = state.tabs.map((tab) => {
    const label = tab.type === 'group' ? tab.group.name : tab.label;
    return `<button type="button" class="admin-tab ${state.activeTab === tab.key ? 'active' : ''}" data-tab="${escapeHtml(tab.key)}">${escapeHtml(label)}</button>`;
  }).join('');

  mount.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      state.activeTab = button.dataset.tab;
      renderTabs();
      renderPanels();
    });
  });
}

function renderAdminPanel() {
  const panel = document.getElementById('adminTabPanel');
  const groupRows = state.groups.map((group) => `<li>${escapeHtml(group.name)} <span class="subtle-text">(${escapeHtml(group.slug)})</span></li>`).join('');

  panel.innerHTML = `
    <h2>Admin</h2>
    <dl class="admin-meta">
      <div><dt>Email</dt><dd>${escapeHtml(state.profile?.email || state.user?.email || '')}</dd></div>
      <div><dt>Display Name</dt><dd>${escapeHtml(state.profile?.display_name || '—')}</dd></div>
      <div><dt>Admin Access</dt><dd>${state.profile?.is_admin ? 'Yes' : 'No'}</dd></div>
      <div><dt>Active Admin Model</dt><dd>admin.html + admin.js (event_* tables)</dd></div>
    </dl>
    <div class="button-row"><button type="button" id="signOutButton">Sign Out</button></div>
    <section class="admin-card"><h3>Event Groups</h3><ul class="admin-list">${groupRows || '<li>No groups found.</li>'}</ul></section>
  `;

  panel.querySelector('#signOutButton')?.addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
    window.location.href = './login.html';
  });
}

function getSelectedPage(groupSlug, data) {
  const pages = data.pages || [];
  if (!pages.length) return null;
  const selected = state.selectedPageByGroup[groupSlug];
  const row = pages.find((page) => page.slug === selected) || pages[0];
  state.selectedPageByGroup[groupSlug] = row.slug;
  return row;
}

function renderGeneralView(groupSlug, data, page) {
  return `
    <section class="admin-card">
      <h3>General / Pages</h3>
      <form class="admin-form" data-form="pages">
        <div class="admin-columns-2">
          <label>Event Name<input name="event_name" value="${escapeHtml(page.event_name || '')}" required></label>
          <label>Slug<input name="slug" value="${escapeHtml(page.slug || '')}" required></label>
        </div>
        <div class="admin-columns-2">
          <label>Event Type<input name="event_type" value="${escapeHtml(page.event_type || '')}"></label>
          <label>Category<input name="category" value="${escapeHtml(page.category || '')}"></label>
        </div>
        <label>Summary<textarea rows="3" name="summary">${escapeHtml(page.summary || '')}</textarea></label>
        <div class="admin-columns-2">
          <label>Date Label<input name="date_label" value="${escapeHtml(page.date_label || '')}"></label>
          <label>Area Label<textarea rows="2" name="area_label">${escapeHtml(page.area_label || '')}</textarea></label>
        </div>
        <label>Tabs (comma separated)<input name="tabs" value="${escapeHtml((page.tabs || []).join(', '))}"></label>
        <p class="error-text" data-message="pages"></p>
        <div class="button-row"><button type="submit">Save General</button></div>
      </form>
    </section>
  `;
}

function renderCalendarView(groupSlug, data, page) {
  const days = sortByDate(data.days.filter((d) => d.page_slug === page.slug));
  const selectedDayId = state.selectedDayByGroup[groupSlug] || days[0]?.external_id || '';
  state.selectedDayByGroup[groupSlug] = selectedDayId;
  const selectedDay = days.find((day) => day.external_id === selectedDayId) || null;

  const rows = days.map((day) => `
    <tr>
      <td>${escapeHtml(day.label || '—')}</td>
      <td>${escapeHtml(day.event_date || '—')}</td>
      <td>${escapeHtml(String(day.sort_order ?? ''))}</td>
      <td>
        <button type="button" data-edit-day="${escapeHtml(day.external_id)}">Edit</button>
        <button type="button" class="danger" data-delete-day="${escapeHtml(day.external_id)}">Delete</button>
      </td>
    </tr>
  `).join('');

  return `
    <section class="admin-card">
      <h3>Calendar (event_days)</h3>
      <div class="table-wrap">
        <table class="admin-table">
          <thead><tr><th>Label</th><th>Date</th><th>Sort</th><th>Actions</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="4">No day rows yet.</td></tr>'}</tbody>
        </table>
      </div>
    </section>
    <section class="admin-card">
      <h3>${selectedDay ? `Edit Day: ${escapeHtml(selectedDay.label || selectedDay.external_id)}` : 'Add Day'}</h3>
      <form class="admin-form" data-form="day">
        <input type="hidden" name="external_id" value="${escapeHtml(selectedDay?.external_id || '')}">
        <label>Label<input name="label" value="${escapeHtml(selectedDay?.label || '')}" required></label>
        <div class="admin-columns-3">
          <label>Date<input type="date" name="event_date" value="${escapeHtml(selectedDay?.event_date || '')}" required></label>
          <label>Sort Order<input type="number" name="sort_order" value="${escapeHtml(String(selectedDay?.sort_order ?? ''))}"></label>
          <label>Raw JSON<textarea rows="1" name="raw">${escapeHtml(JSON.stringify(selectedDay?.raw || {}, null, 2))}</textarea></label>
        </div>
        <p class="error-text" data-message="day"></p>
        <div class="button-row"><button type="submit">Save Day</button><button type="button" data-day-new>New Day</button></div>
      </form>
    </section>
  `;
}

function renderLocationsView(data, page) {
  const rows = sortByOrderThenName(data.locations.filter((r) => r.page_slug === page.slug));
  const table = rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.name || '—')}</td>
      <td>${escapeHtml(row.address || '—')}</td>
      <td>${escapeHtml(row.external_id || '')}</td>
      <td><button type="button" data-edit-location="${escapeHtml(row.external_id)}">Edit</button><button class="danger" type="button" data-delete-location="${escapeHtml(row.external_id)}">Delete</button></td>
    </tr>
  `).join('');

  return `
    <section class="admin-card">
      <h3>Locations (event_locations)</h3>
      <div class="table-wrap"><table class="admin-table"><thead><tr><th>Name</th><th>Address</th><th>External ID</th><th>Actions</th></tr></thead><tbody>${table || '<tr><td colspan="4">No locations yet.</td></tr>'}</tbody></table></div>
      <button type="button" data-location-new>Add Location</button>
      <p class="subtle-text">Edit a row to update map pins and location metadata used by public pages.</p>
      <p class="error-text" data-message="location"></p>
      <form class="admin-form" data-form="location"></form>
    </section>
  `;
}

function renderVendorsView(data, page) {
  const rows = sortByOrderThenName(data.vendors.filter((r) => r.page_slug === page.slug));
  const table = rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.name || '—')}</td>
      <td>${escapeHtml(row.location_external_id || '—')}</td>
      <td>${escapeHtml(row.category || '—')}</td>
      <td><button type="button" data-edit-vendor="${escapeHtml(row.external_id)}">Edit</button><button class="danger" type="button" data-delete-vendor="${escapeHtml(row.external_id)}">Delete</button></td>
    </tr>
  `).join('');

  return `
    <section class="admin-card">
      <h3>Vendors (event_vendors)</h3>
      <div class="table-wrap"><table class="admin-table"><thead><tr><th>Name</th><th>Location ID</th><th>Category</th><th>Actions</th></tr></thead><tbody>${table || '<tr><td colspan="4">No vendors yet.</td></tr>'}</tbody></table></div>
      <button type="button" data-vendor-new>Add Vendor</button>
      <p class="error-text" data-message="vendor"></p>
      <form class="admin-form" data-form="vendor"></form>
    </section>
  `;
}

function renderScheduleView(groupSlug, data, page) {
  const days = sortByDate(data.days.filter((r) => r.page_slug === page.slug));
  const locations = sortByOrderThenName(data.locations.filter((r) => r.page_slug === page.slug));
  const selectedDayId = state.selectedDayByGroup[groupSlug] || days[0]?.external_id || '';
  const entries = sortByDate(data.schedule.filter((row) => row.page_slug === page.slug && (!selectedDayId || row.day_external_id === selectedDayId)));

  const dayOptions = days.map((day) => `<option value="${escapeHtml(day.external_id)}" ${day.external_id === selectedDayId ? 'selected' : ''}>${escapeHtml(day.label || day.event_date)}</option>`).join('');
  const rows = entries.map((row) => `
    <tr>
      <td>${escapeHtml(row.title || '—')}</td>
      <td>${escapeHtml(row.start_time || '—')} - ${escapeHtml(row.end_time || '—')}</td>
      <td>${escapeHtml(row.location_external_id || '—')}</td>
      <td><button type="button" data-edit-schedule="${escapeHtml(row.external_id)}">Edit</button><button class="danger" type="button" data-delete-schedule="${escapeHtml(row.external_id)}">Delete</button></td>
    </tr>
  `).join('');

  return `
    <section class="admin-card">
      <h3>Schedule (event_schedule)</h3>
      <label>Filter Day<select data-schedule-day-filter>${dayOptions || '<option value="">No days yet</option>'}</select></label>
      <div class="table-wrap"><table class="admin-table"><thead><tr><th>Title</th><th>Time</th><th>Location</th><th>Actions</th></tr></thead><tbody>${rows || '<tr><td colspan="4">No schedule rows for selected day.</td></tr>'}</tbody></table></div>
      <button type="button" data-schedule-new>Add Schedule Entry</button>
      <p class="subtle-text">Schedule rows are tied to page, day, and location IDs and persist directly to event_schedule.</p>
      <p class="error-text" data-message="schedule"></p>
      <form class="admin-form" data-form="schedule"></form>
      <datalist id="location-id-list">${locations.map((loc) => `<option value="${escapeHtml(loc.external_id)}">${escapeHtml(loc.name || loc.external_id)}</option>`).join('')}</datalist>
    </section>
  `;
}

function renderFlyerView(page) {
  return `
    <section class="admin-card">
      <h3>Flyer</h3>
      <form class="admin-form" data-form="flyer">
        <label>Flyer JSON (event_pages.flyer)<textarea rows="14" name="flyer">${escapeHtml(JSON.stringify(page.flyer || {}, null, 2))}</textarea></label>
        <p class="error-text" data-message="flyer"></p>
        <div class="button-row"><button type="submit">Save Flyer</button></div>
      </form>
    </section>
  `;
}

function renderResourcesView(page) {
  const lines = Array.isArray(page.resources)
    ? page.resources.map((entry) => (typeof entry === 'string' ? entry : `${entry.label || ''}|${entry.href || ''}`))
    : [];

  return `
    <section class="admin-card">
      <h3>Resources</h3>
      <form class="admin-form" data-form="resources">
        <label>Resources (one per line: Label|URL)<textarea rows="10" name="resources_lines">${escapeHtml(lines.join('\n'))}</textarea></label>
        <p class="error-text" data-message="resources"></p>
        <div class="button-row"><button type="submit">Save Resources</button></div>
      </form>
    </section>
  `;
}

function renderSettingsView(page) {
  return `
    <section class="admin-card">
      <h3>Settings</h3>
      <form class="admin-form" data-form="settings">
        <label>Theme JSON<textarea rows="5" name="theme">${escapeHtml(JSON.stringify(page.theme || {}, null, 2))}</textarea></label>
        <label>Featured Branding JSON<textarea rows="5" name="featured_branding">${escapeHtml(JSON.stringify(page.featured_branding || {}, null, 2))}</textarea></label>
        <label>Raw JSON<textarea rows="8" name="raw">${escapeHtml(JSON.stringify(page.raw || {}, null, 2))}</textarea></label>
        <p class="error-text" data-message="settings"></p>
        <div class="button-row"><button type="submit">Save Settings</button></div>
      </form>
    </section>
  `;
}

function renderDynamicEntityForm(type, record, groupSlug) {
  const panel = document.getElementById('groupTabPanel');
  const data = currentGroupData(groupSlug);
  const page = getSelectedPage(groupSlug, data);
  if (!page) return;

  if (type === 'location') {
    const form = panel.querySelector('[data-form="location"]');
    if (!form) return;
    form.innerHTML = `
      <input type="hidden" name="external_id" value="${escapeHtml(record?.external_id || '')}">
      <div class="admin-columns-2">
        <label>Name<input name="name" value="${escapeHtml(record?.name || '')}" required></label>
        <label>Address<input name="address" value="${escapeHtml(record?.address || '')}"></label>
      </div>
      <div class="admin-columns-3">
        <label>Map X<input type="number" step="0.1" name="map_x" value="${escapeHtml(String(record?.map_x ?? ''))}"></label>
        <label>Map Y<input type="number" step="0.1" name="map_y" value="${escapeHtml(String(record?.map_y ?? ''))}"></label>
        <label>Sort Order<input type="number" name="sort_order" value="${escapeHtml(String(record?.sort_order ?? ''))}"></label>
      </div>
      <div class="admin-columns-2">
        <label>Hours<input name="hours" value="${escapeHtml(record?.hours || '')}"></label>
        <label>Location Group<input name="location_group" value="${escapeHtml(record?.location_group || '')}"></label>
      </div>
      <div class="admin-columns-2">
        <label>Tags (comma)<input name="tags" value="${escapeHtml((record?.tags || []).join(', '))}"></label>
        <label>Pin Icon<input name="pin_icon" value="${escapeHtml(record?.pin_icon || '')}"></label>
      </div>
      <label>Description<textarea rows="2" name="description">${escapeHtml(record?.description || '')}</textarea></label>
      <label>Notes<textarea rows="2" name="notes">${escapeHtml(record?.notes || '')}</textarea></label>
      <label>Directions Text<textarea rows="2" name="directions_text">${escapeHtml(record?.directions_text || '')}</textarea></label>
      <label><input type="checkbox" name="multi_vendor" ${record?.multi_vendor ? 'checked' : ''}> Multi-vendor location</label>
      <label>Raw JSON<textarea rows="2" name="raw">${escapeHtml(JSON.stringify(record?.raw || {}, null, 2))}</textarea></label>
      <div class="button-row"><button type="submit">Save Location</button></div>
    `;
  }

  if (type === 'vendor') {
    const form = panel.querySelector('[data-form="vendor"]');
    if (!form) return;
    const locationOptions = sortByOrderThenName(data.locations.filter((row) => row.page_slug === page.slug)).map((loc) => `<option value="${escapeHtml(loc.external_id)}">${escapeHtml(loc.name || loc.external_id)}</option>`).join('');
    form.innerHTML = `
      <input type="hidden" name="external_id" value="${escapeHtml(record?.external_id || '')}">
      <div class="admin-columns-2">
        <label>Name<input name="name" value="${escapeHtml(record?.name || '')}" required></label>
        <label>Category<input name="category" value="${escapeHtml(record?.category || '')}"></label>
      </div>
      <div class="admin-columns-3">
        <label>Location ID<input name="location_external_id" list="location-id-list" value="${escapeHtml(record?.location_external_id || '')}"></label>
        <label>Booth<input name="booth" value="${escapeHtml(record?.booth || '')}"></label>
        <label>Sort Order<input type="number" name="sort_order" value="${escapeHtml(String(record?.sort_order ?? ''))}"></label>
      </div>
      <label>Hours<input name="hours" value="${escapeHtml(record?.hours || '')}"></label>
      <label>Description<textarea rows="2" name="description">${escapeHtml(record?.description || '')}</textarea></label>
      <label>Raw JSON<textarea rows="2" name="raw">${escapeHtml(JSON.stringify(record?.raw || {}, null, 2))}</textarea></label>
      <div class="button-row"><button type="submit">Save Vendor</button></div>
      <datalist id="location-id-list">${locationOptions}</datalist>
    `;
  }

  if (type === 'schedule') {
    const form = panel.querySelector('[data-form="schedule"]');
    if (!form) return;
    const days = sortByDate(data.days.filter((row) => row.page_slug === page.slug));
    const locations = sortByOrderThenName(data.locations.filter((row) => row.page_slug === page.slug));
    form.innerHTML = `
      <input type="hidden" name="external_id" value="${escapeHtml(record?.external_id || '')}">
      <div class="admin-columns-2">
        <label>Title<input name="title" value="${escapeHtml(record?.title || '')}" required></label>
        <label>Category<input name="category" value="${escapeHtml(record?.category || '')}"></label>
      </div>
      <div class="admin-columns-3">
        <label>Day<select name="day_external_id" required>${days.map((d) => `<option value="${escapeHtml(d.external_id)}" ${d.external_id === (record?.day_external_id || state.selectedDayByGroup[groupSlug]) ? 'selected' : ''}>${escapeHtml(d.label || d.event_date)}</option>`).join('')}</select></label>
        <label>Date<input type="date" name="event_date" value="${escapeHtml(record?.event_date || '')}" required></label>
        <label>Location<select name="location_external_id">${locations.map((loc) => `<option value="${escapeHtml(loc.external_id)}" ${loc.external_id === record?.location_external_id ? 'selected' : ''}>${escapeHtml(loc.name || loc.external_id)}</option>`).join('')}</select></label>
      </div>
      <div class="admin-columns-3">
        <label>Start Time<input name="start_time" value="${escapeHtml(record?.start_time || '')}"></label>
        <label>End Time<input name="end_time" value="${escapeHtml(record?.end_time || '')}"></label>
        <label>Sort Order<input type="number" name="sort_order" value="${escapeHtml(String(record?.sort_order ?? ''))}"></label>
      </div>
      <label>Vendor IDs (comma)<input name="vendor_ids" value="${escapeHtml((record?.vendor_ids || []).join(', '))}"></label>
      <label>Description<textarea rows="2" name="description">${escapeHtml(record?.description || '')}</textarea></label>
      <label>Raw JSON<textarea rows="2" name="raw">${escapeHtml(JSON.stringify(record?.raw || {}, null, 2))}</textarea></label>
      <div class="button-row"><button type="submit">Save Schedule</button></div>
    `;
  }
}

function renderGroupPanel(tabKey) {
  const group = getGroupFromTab(tabKey);
  const panel = document.getElementById('groupTabPanel');
  if (!group) {
    panel.innerHTML = '<p>Group not found.</p>';
    return;
  }

  const data = currentGroupData(group.slug);
  if (!data.loaded && !data.error) {
    panel.innerHTML = `<p class="subtle-text">Loading ${escapeHtml(group.name)}…</p>`;
    loadGroupData(group.slug)
      .then((rows) => {
        state.groupData[group.slug] = rows;
        if (rows.pages[0] && !state.selectedPageByGroup[group.slug]) state.selectedPageByGroup[group.slug] = rows.pages[0].slug;
      })
      .catch((error) => {
        state.groupData[group.slug] = { loaded: true, error, pages: [], days: [], schedule: [], locations: [], vendors: [] };
      })
      .finally(() => {
        if (state.activeTab === tabKey) renderGroupPanel(tabKey);
      });
    return;
  }

  if (data.error) {
    panel.innerHTML = `<p class="error-text">Failed to load group data: ${escapeHtml(data.error.message || 'Unknown error')}</p>`;
    return;
  }

  if (!data.pages.length) {
    panel.innerHTML = `<h2>${escapeHtml(group.name)}</h2><p>No pages configured for this group.</p>`;
    return;
  }

  const view = state.selectedGroupViewBySlug[group.slug] || 'pages';
  state.selectedGroupViewBySlug[group.slug] = view;

  const page = getSelectedPage(group.slug, data);
  const pageTabs = data.pages.map((p) => `<button type="button" class="admin-tab ${p.slug === page.slug ? 'active' : ''}" data-page-slug="${escapeHtml(p.slug)}">${escapeHtml(p.event_name || p.slug)}</button>`).join('');
  const subviewTabs = GROUP_SUBVIEW_KEYS.map((key) => `<button type="button" class="admin-tab ${key === view ? 'active' : ''}" data-group-view="${escapeHtml(key)}">${escapeHtml(GROUP_SUBVIEW_LABELS[key])}</button>`).join('');

  let body = '';
  if (view === 'pages') body = renderGeneralView(group.slug, data, page);
  if (view === 'calendar') body = renderCalendarView(group.slug, data, page);
  if (view === 'schedule') body = renderScheduleView(group.slug, data, page);
  if (view === 'locations') body = renderLocationsView(data, page);
  if (view === 'vendors') body = renderVendorsView(data, page);
  if (view === 'flyer') body = renderFlyerView(page);
  if (view === 'resources') body = renderResourcesView(page);
  if (view === 'settings') body = renderSettingsView(page);

  panel.innerHTML = `
    <h2>${escapeHtml(group.name)}</h2>
    <p class="subtle-text">${escapeHtml(group.slug)}</p>
    <div class="admin-tabs">${subviewTabs}</div>
    <div class="admin-tabs">${pageTabs}</div>
    ${body}
  `;

  panel.querySelectorAll('[data-group-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.selectedGroupViewBySlug[group.slug] = btn.dataset.groupView;
      renderGroupPanel(tabKey);
    });
  });

  panel.querySelectorAll('[data-page-slug]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.selectedPageByGroup[group.slug] = btn.dataset.pageSlug;
      renderGroupPanel(tabKey);
    });
  });

  bindGroupActions(group.slug, tabKey);
}

function setMessage(panel, key, text) {
  const el = panel.querySelector(`[data-message="${key}"]`);
  if (el) el.textContent = text;
}

async function refreshGroup(groupSlug, tabKey) {
  state.groupData[groupSlug] = await loadGroupData(groupSlug);
  renderGroupPanel(tabKey);
}

async function savePageSection(groupSlug, tabKey, pageSlug, payload, messageKey, successMessage) {
  const panel = document.getElementById('groupTabPanel');
  const { error } = await supabaseClient.from('event_pages').update(payload).eq('group_slug', groupSlug).eq('slug', pageSlug);
  if (error) {
    setMessage(panel, messageKey, error.message || 'Save failed');
    return;
  }
  setMessage(panel, messageKey, successMessage);
  await refreshGroup(groupSlug, tabKey);
}

async function bindGroupActions(groupSlug, tabKey) {
  const panel = document.getElementById('groupTabPanel');
  const data = currentGroupData(groupSlug);
  const page = getSelectedPage(groupSlug, data);
  if (!page) return;

  panel.querySelector('[data-form="pages"]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      event_name: String(form.get('event_name') || '').trim(),
      slug: String(form.get('slug') || '').trim(),
      event_type: String(form.get('event_type') || '').trim() || null,
      category: String(form.get('category') || '').trim() || null,
      summary: String(form.get('summary') || '').trim() || null,
      date_label: String(form.get('date_label') || '').trim() || null,
      area_label: String(form.get('area_label') || '').trim() || null,
      tabs: String(form.get('tabs') || '').split(',').map((item) => item.trim()).filter(Boolean),
    };
    await savePageSection(groupSlug, tabKey, page.slug, payload, 'pages', 'General settings saved.');
  });

  panel.querySelector('[data-form="flyer"]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const form = new FormData(event.currentTarget);
      await savePageSection(groupSlug, tabKey, page.slug, { flyer: parseJsonField(form.get('flyer'), {}) }, 'flyer', 'Flyer saved.');
    } catch (error) {
      setMessage(panel, 'flyer', error.message || 'Invalid JSON.');
    }
  });

  panel.querySelector('[data-form="resources"]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const lines = String(form.get('resources_lines') || '').split('\n').map((line) => line.trim()).filter(Boolean);
    const resources = lines.map((line) => {
      const [label, href] = line.split('|').map((part) => part.trim());
      if (href) return { label: label || href, href };
      return { label: line, href: line };
    });
    await savePageSection(groupSlug, tabKey, page.slug, { resources }, 'resources', 'Resources saved.');
  });

  panel.querySelector('[data-form="settings"]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const form = new FormData(event.currentTarget);
      const payload = {
        theme: parseJsonField(form.get('theme'), {}),
        featured_branding: parseJsonField(form.get('featured_branding'), {}),
        raw: parseJsonField(form.get('raw'), {}),
      };
      await savePageSection(groupSlug, tabKey, page.slug, payload, 'settings', 'Settings saved.');
    } catch (error) {
      setMessage(panel, 'settings', error.message || 'Invalid JSON.');
    }
  });

  panel.querySelector('[data-form="day"]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const form = new FormData(event.currentTarget);
      const external_id = String(form.get('external_id') || '').trim() || getId();
      const payload = {
        page_slug: page.slug,
        external_id,
        label: String(form.get('label') || '').trim(),
        event_date: String(form.get('event_date') || '').trim(),
        sort_order: form.get('sort_order') ? Number(form.get('sort_order')) : null,
        raw: parseJsonField(form.get('raw'), {}),
      };
      const { error } = await supabaseClient.from('event_days').upsert(payload, { onConflict: 'page_slug,external_id' });
      if (error) throw error;
      state.selectedDayByGroup[groupSlug] = external_id;
      setMessage(panel, 'day', 'Day saved.');
      await refreshGroup(groupSlug, tabKey);
    } catch (error) {
      setMessage(panel, 'day', error.message || 'Failed to save day.');
    }
  });

  panel.querySelectorAll('[data-edit-day]').forEach((button) => button.addEventListener('click', () => {
    state.selectedDayByGroup[groupSlug] = button.dataset.editDay;
    renderGroupPanel(tabKey);
  }));

  panel.querySelector('[data-day-new]')?.addEventListener('click', () => {
    state.selectedDayByGroup[groupSlug] = '';
    renderGroupPanel(tabKey);
  });

  panel.querySelectorAll('[data-delete-day]').forEach((button) => button.addEventListener('click', async () => {
    const externalId = button.dataset.deleteDay;
    const { error } = await supabaseClient.from('event_days').delete().eq('page_slug', page.slug).eq('external_id', externalId);
    if (error) {
      setMessage(panel, 'day', error.message || 'Delete failed');
      return;
    }
    if (state.selectedDayByGroup[groupSlug] === externalId) state.selectedDayByGroup[groupSlug] = '';
    await refreshGroup(groupSlug, tabKey);
  }));

  panel.querySelector('[data-schedule-day-filter]')?.addEventListener('change', (event) => {
    state.selectedDayByGroup[groupSlug] = event.target.value;
    renderGroupPanel(tabKey);
  });

  panel.querySelector('[data-location-new]')?.addEventListener('click', () => renderDynamicEntityForm('location', null, groupSlug));
  panel.querySelectorAll('[data-edit-location]').forEach((button) => button.addEventListener('click', () => {
    const record = data.locations.find((row) => row.page_slug === page.slug && row.external_id === button.dataset.editLocation);
    renderDynamicEntityForm('location', record, groupSlug);
  }));
  panel.querySelectorAll('[data-delete-location]').forEach((button) => button.addEventListener('click', async () => {
    const { error } = await supabaseClient.from('event_locations').delete().eq('page_slug', page.slug).eq('external_id', button.dataset.deleteLocation);
    if (error) return setMessage(panel, 'location', error.message || 'Delete failed');
    await refreshGroup(groupSlug, tabKey);
  }));

  panel.querySelector('[data-vendor-new]')?.addEventListener('click', () => renderDynamicEntityForm('vendor', null, groupSlug));
  panel.querySelectorAll('[data-edit-vendor]').forEach((button) => button.addEventListener('click', () => {
    const record = data.vendors.find((row) => row.page_slug === page.slug && row.external_id === button.dataset.editVendor);
    renderDynamicEntityForm('vendor', record, groupSlug);
  }));
  panel.querySelectorAll('[data-delete-vendor]').forEach((button) => button.addEventListener('click', async () => {
    const { error } = await supabaseClient.from('event_vendors').delete().eq('page_slug', page.slug).eq('external_id', button.dataset.deleteVendor);
    if (error) return setMessage(panel, 'vendor', error.message || 'Delete failed');
    await refreshGroup(groupSlug, tabKey);
  }));

  panel.querySelector('[data-schedule-new]')?.addEventListener('click', () => renderDynamicEntityForm('schedule', null, groupSlug));
  panel.querySelectorAll('[data-edit-schedule]').forEach((button) => button.addEventListener('click', () => {
    const record = data.schedule.find((row) => row.page_slug === page.slug && row.external_id === button.dataset.editSchedule);
    renderDynamicEntityForm('schedule', record, groupSlug);
  }));
  panel.querySelectorAll('[data-delete-schedule]').forEach((button) => button.addEventListener('click', async () => {
    const { error } = await supabaseClient.from('event_schedule').delete().eq('page_slug', page.slug).eq('external_id', button.dataset.deleteSchedule);
    if (error) return setMessage(panel, 'schedule', error.message || 'Delete failed');
    await refreshGroup(groupSlug, tabKey);
  }));

  panel.querySelector('[data-form="location"]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const form = new FormData(event.currentTarget);
      const payload = {
        page_slug: page.slug,
        external_id: String(form.get('external_id') || '').trim() || getId(),
        name: String(form.get('name') || '').trim(),
        address: String(form.get('address') || '').trim() || null,
        map_x: form.get('map_x') ? Number(form.get('map_x')) : null,
        map_y: form.get('map_y') ? Number(form.get('map_y')) : null,
        description: String(form.get('description') || '').trim() || null,
        notes: String(form.get('notes') || '').trim() || null,
        directions_text: String(form.get('directions_text') || '').trim() || null,
        pin_icon: String(form.get('pin_icon') || '').trim() || null,
        hours: String(form.get('hours') || '').trim() || null,
        tags: String(form.get('tags') || '').split(',').map((item) => item.trim()).filter(Boolean),
        multi_vendor: form.get('multi_vendor') === 'on',
        location_group: String(form.get('location_group') || '').trim() || null,
        sort_order: form.get('sort_order') ? Number(form.get('sort_order')) : null,
        raw: parseJsonField(form.get('raw'), {}),
      };
      const { error } = await supabaseClient.from('event_locations').upsert(payload, { onConflict: 'page_slug,external_id' });
      if (error) throw error;
      setMessage(panel, 'location', 'Location saved.');
      await refreshGroup(groupSlug, tabKey);
    } catch (error) {
      setMessage(panel, 'location', error.message || 'Failed to save location.');
    }
  });

  panel.querySelector('[data-form="vendor"]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const form = new FormData(event.currentTarget);
      const payload = {
        page_slug: page.slug,
        external_id: String(form.get('external_id') || '').trim() || getId(),
        name: String(form.get('name') || '').trim(),
        location_external_id: String(form.get('location_external_id') || '').trim() || null,
        category: String(form.get('category') || '').trim() || null,
        description: String(form.get('description') || '').trim() || null,
        booth: String(form.get('booth') || '').trim() || null,
        hours: String(form.get('hours') || '').trim() || null,
        sort_order: form.get('sort_order') ? Number(form.get('sort_order')) : null,
        raw: parseJsonField(form.get('raw'), {}),
      };
      const { error } = await supabaseClient.from('event_vendors').upsert(payload, { onConflict: 'page_slug,external_id' });
      if (error) throw error;
      setMessage(panel, 'vendor', 'Vendor saved.');
      await refreshGroup(groupSlug, tabKey);
    } catch (error) {
      setMessage(panel, 'vendor', error.message || 'Failed to save vendor.');
    }
  });

  panel.querySelector('[data-form="schedule"]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const form = new FormData(event.currentTarget);
      const dayExternalId = String(form.get('day_external_id') || '').trim();
      const payload = {
        page_slug: page.slug,
        external_id: String(form.get('external_id') || '').trim() || getId(),
        day_external_id: dayExternalId || null,
        title: String(form.get('title') || '').trim(),
        start_time: String(form.get('start_time') || '').trim() || null,
        end_time: String(form.get('end_time') || '').trim() || null,
        location_external_id: String(form.get('location_external_id') || '').trim() || null,
        category: String(form.get('category') || '').trim() || null,
        description: String(form.get('description') || '').trim() || null,
        vendor_ids: String(form.get('vendor_ids') || '').split(',').map((item) => item.trim()).filter(Boolean),
        event_date: String(form.get('event_date') || '').trim(),
        sort_order: form.get('sort_order') ? Number(form.get('sort_order')) : null,
        raw: parseJsonField(form.get('raw'), {}),
      };
      const { error } = await supabaseClient.from('event_schedule').upsert(payload, { onConflict: 'page_slug,external_id' });
      if (error) throw error;
      state.selectedDayByGroup[groupSlug] = dayExternalId;
      setMessage(panel, 'schedule', 'Schedule row saved.');
      await refreshGroup(groupSlug, tabKey);
    } catch (error) {
      setMessage(panel, 'schedule', error.message || 'Failed to save schedule.');
    }
  });
}

function renderAuditPanel() {
  const panel = document.getElementById('auditTabPanel');
  if (!state.profile?.is_admin) {
    panel.innerHTML = '<p>You do not have permission to view audit data.</p>';
    return;
  }

  const rows = state.auditRows.map((row) => `
    <tr>
      <td>${escapeHtml(formatDate(row.changed_at))}</td>
      <td>${escapeHtml(row.changed_by_email || '')}</td>
      <td>${escapeHtml(row.table_name || '')}</td>
      <td>${escapeHtml(row.action || '')}</td>
      <td>${escapeHtml(row.group_slug || '')}</td>
      <td>${escapeHtml(row.page_slug || '')}</td>
      <td>${escapeHtml(row.record_label || '')}</td>
    </tr>
  `).join('');

  panel.innerHTML = `
    <h2>Audit</h2>
    <div class="table-wrap">
      <table class="admin-table">
        <thead><tr><th>changed_at</th><th>changed_by</th><th>table</th><th>action</th><th>group</th><th>page</th><th>record</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7">No audit rows.</td></tr>'}</tbody>
      </table>
    </div>
  `;
}

function renderPanels() {
  const adminPanel = document.getElementById('adminTabPanel');
  const auditPanel = document.getElementById('auditTabPanel');
  const groupPanel = document.getElementById('groupTabPanel');
  adminPanel.classList.add('hidden');
  auditPanel.classList.add('hidden');
  groupPanel.classList.add('hidden');

  if (state.activeTab === 'admin') {
    adminPanel.classList.remove('hidden');
    renderAdminPanel();
    return;
  }

  if (state.activeTab === 'audit') {
    auditPanel.classList.remove('hidden');
    renderAuditPanel();
    return;
  }

  if (state.activeTab?.startsWith('group:')) {
    groupPanel.classList.remove('hidden');
    renderGroupPanel(state.activeTab);
  }
}

async function initAdmin() {
  if (!supabaseClient) {
    document.body.innerHTML = '<main class="admin-shell"><p>Supabase client unavailable.</p></main>';
    return;
  }

  state.user = await requireUser();
  if (!state.user) return;

  state.profile = await fetchProfile(state.user.id);
  state.memberships = await fetchMemberships(state.user.id);
  state.groups = state.profile?.is_admin
    ? await fetchAllGroups()
    : sortByName(state.memberships.map((membership) => membership.event_groups).filter(Boolean), 'name');

  if (state.profile?.is_admin) {
    state.auditRows = await fetchAuditRows();
  }

  state.tabs = buildTabs();
  state.activeTab = state.tabs[0]?.key || 'admin';
  renderTabs();
  renderPanels();
}

window.addEventListener('DOMContentLoaded', async () => {
  try {
    await initAdmin();
  } catch (error) {
    console.error(error);
    document.body.innerHTML = `<main class="admin-shell"><p class="error-text">${escapeHtml(error.message || 'Failed to load admin.')}</p></main>`;
  }
});
