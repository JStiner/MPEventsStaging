const supabaseClient = window.supabaseClient;

const state = {
  user: null,
  profile: null,
  groups: [],
  memberships: [],
  tabs: [],
  activeTab: null,
  auditRows: [],
  groupPagesBySlug: {},
  selectedPageByGroup: {},
  groupLoadErrors: {},
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
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function formatJson(value) {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return String(value ?? '');
  }
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
  const { data, error } = await supabaseClient
    .from('event_groups')
    .select('id, slug, name')
    .order('name', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function fetchMemberships(userId) {
  const { data, error } = await supabaseClient
    .from('group_memberships')
    .select('group_id, role, event_groups(id, slug, name)')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

async function fetchPagesByGroup(groupSlug) {
  const { data, error } = await supabaseClient
    .from('event_pages')
    .select('slug, event_name, event_type, summary, date_label, area_label, category, tabs, dates, theme, featured_branding, flyer, resources, raw, group_slug')
    .eq('group_slug', groupSlug)
    .order('event_name', { ascending: true, nullsFirst: false });

  if (error) throw error;
  return data || [];
}

function buildTabs() {
  const tabs = [];

  if (state.profile?.is_admin) {
    for (const group of state.groups) {
      tabs.push({ key: `group:${group.slug}`, type: 'group', group });
    }
    tabs.push({ key: 'admin', type: 'admin', label: 'Admin' });
    tabs.push({ key: 'audit', type: 'audit', label: 'Audit' });
    return tabs;
  }

  const seen = new Set();
  for (const membership of state.memberships) {
    const group = membership.event_groups;
    if (!group?.slug || seen.has(group.slug)) continue;
    seen.add(group.slug);
    tabs.push({ key: `group:${group.slug}`, type: 'group', group, role: membership.role });
  }

  tabs.push({ key: 'admin', type: 'admin', label: 'Admin' });
  return tabs;
}

function renderTabs() {
  const mount = document.getElementById('adminTabs');
  mount.innerHTML = state.tabs.map((tab) => {
    const label = tab.type === 'group' ? tab.group.name : tab.label;
    const active = state.activeTab === tab.key ? 'active' : '';
    return `<button type="button" class="admin-tab ${active}" data-tab="${escapeHtml(tab.key)}">${escapeHtml(label)}</button>`;
  }).join('');

  mount.querySelectorAll('.admin-tab').forEach((button) => {
    button.addEventListener('click', () => {
      state.activeTab = button.dataset.tab;
      renderTabs();
      renderPanels();
    });
  });
}

function renderAdminPanel() {
  const panel = document.getElementById('adminTabPanel');
  const list = state.groups.map((group) => `<li>${escapeHtml(group.name)} <span class="subtle-text">(${escapeHtml(group.slug)})</span></li>`).join('');

  panel.innerHTML = `
    <h2>Admin</h2>
    <dl class="admin-meta">
      <div><dt>Email</dt><dd>${escapeHtml(state.profile?.email || state.user?.email || '')}</dd></div>
      <div><dt>Display Name</dt><dd>${escapeHtml(state.profile?.display_name || '—')}</dd></div>
      <div><dt>Admin Access</dt><dd>${state.profile?.is_admin ? 'Yes' : 'No'}</dd></div>
    </dl>

    <div class="button-row">
      <button id="signOutButton" type="button">Sign Out</button>
    </div>

    <h3>Event Groups</h3>
    <ul class="admin-list">${list || '<li>No event groups found.</li>'}</ul>
  `;

  panel.querySelector('#signOutButton')?.addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
    window.location.href = './login.html';
  });
}

function formatFieldValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') return `<pre>${escapeHtml(formatJson(value))}</pre>`;
  return escapeHtml(String(value));
}

function renderGroupPanel(tabKey) {
  const group = state.tabs.find((tab) => tab.key === tabKey)?.group;
  const panel = document.getElementById('groupTabPanel');
  if (!group) {
    panel.innerHTML = '<p>Group not found.</p>';
    return;
  }

  const pages = state.groupPagesBySlug[group.slug];
  const loadError = state.groupLoadErrors[group.slug];

  if (!pages && !loadError) {
    panel.innerHTML = `
      <h2>${escapeHtml(group.name)}</h2>
      <p class="subtle-text">Loading pages for <strong>${escapeHtml(group.slug)}</strong>…</p>
    `;

    fetchPagesByGroup(group.slug)
      .then((rows) => {
        state.groupPagesBySlug[group.slug] = rows;
        delete state.groupLoadErrors[group.slug];
        if (rows.length && !state.selectedPageByGroup[group.slug]) {
          state.selectedPageByGroup[group.slug] = rows[0].slug;
        }
      })
      .catch((error) => {
        console.error('Failed to load event pages for group', group.slug, error);
        state.groupLoadErrors[group.slug] = error;
      })
      .finally(() => {
        if (state.activeTab === tabKey) renderGroupPanel(tabKey);
      });
    return;
  }

  if (loadError) {
    panel.innerHTML = `
      <h2>${escapeHtml(group.name)}</h2>
      <p class="error-text">Failed to load pages for group <strong>${escapeHtml(group.slug)}</strong>: ${escapeHtml(loadError.message || 'Unknown error')}</p>
    `;
    return;
  }

  if (!pages?.length) {
    panel.innerHTML = `
      <h2>${escapeHtml(group.name)}</h2>
      <p class="subtle-text">No pages found for <strong>${escapeHtml(group.slug)}</strong>.</p>
    `;
    return;
  }

  const selectedSlug = state.selectedPageByGroup[group.slug] || pages[0].slug;
  state.selectedPageByGroup[group.slug] = selectedSlug;

  const selectedPage = pages.find((page) => page.slug === selectedSlug) || pages[0];
  state.selectedPageByGroup[group.slug] = selectedPage.slug;

  const pageList = pages.map((page) => {
    const activeClass = page.slug === selectedPage.slug ? 'active' : '';
    return `
      <button type="button" class="admin-tab ${activeClass}" data-page-slug="${escapeHtml(page.slug)}">
        ${escapeHtml(page.event_name || page.slug)}
      </button>
    `;
  }).join('');

  panel.innerHTML = `
    <h2>${escapeHtml(group.name)}</h2>
    <p class="subtle-text">${pages.length} page${pages.length === 1 ? '' : 's'} in <strong>${escapeHtml(group.slug)}</strong>.</p>

    <div class="admin-grid">
      <section class="admin-card">
        <h3>Pages</h3>
        <div class="admin-tabs">${pageList}</div>
      </section>

      <section class="admin-card">
        <h3>Page Details</h3>
        <dl class="admin-meta">
          <div><dt>slug</dt><dd>${formatFieldValue(selectedPage.slug)}</dd></div>
          <div><dt>event_name</dt><dd>${formatFieldValue(selectedPage.event_name)}</dd></div>
          <div><dt>event_type</dt><dd>${formatFieldValue(selectedPage.event_type)}</dd></div>
          <div><dt>summary</dt><dd>${formatFieldValue(selectedPage.summary)}</dd></div>
          <div><dt>date_label</dt><dd>${formatFieldValue(selectedPage.date_label)}</dd></div>
          <div><dt>area_label</dt><dd>${formatFieldValue(selectedPage.area_label)}</dd></div>
          <div><dt>category</dt><dd>${formatFieldValue(selectedPage.category)}</dd></div>
          <div><dt>tabs</dt><dd>${formatFieldValue(selectedPage.tabs)}</dd></div>
          <div><dt>dates</dt><dd>${formatFieldValue(selectedPage.dates)}</dd></div>
          <div><dt>theme</dt><dd>${formatFieldValue(selectedPage.theme)}</dd></div>
          <div><dt>featured_branding</dt><dd>${formatFieldValue(selectedPage.featured_branding)}</dd></div>
          <div><dt>flyer</dt><dd>${formatFieldValue(selectedPage.flyer)}</dd></div>
          <div><dt>resources</dt><dd>${formatFieldValue(selectedPage.resources)}</dd></div>
          <div><dt>raw</dt><dd>${formatFieldValue(selectedPage.raw)}</dd></div>
        </dl>
      </section>
    </div>
  `;

  panel.querySelectorAll('[data-page-slug]').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedPageByGroup[group.slug] = button.dataset.pageSlug;
      renderGroupPanel(tabKey);
    });
  });
}

async function fetchAuditRows() {
  const viewResult = await supabaseClient
    .from('v_audit_log_admin')
    .select('id, changed_at, changed_by_email, table_name, action, group_slug, page_slug, record_label, changed_fields, old_data, new_data')
    .order('changed_at', { ascending: false })
    .limit(200);

  if (!viewResult.error) return viewResult.data || [];

  const tableResult = await supabaseClient
    .from('audit_log')
    .select('id, changed_at, changed_by_email, table_name, action, group_slug, page_slug, record_label, changed_fields, old_data, new_data')
    .order('changed_at', { ascending: false })
    .limit(200);

  if (tableResult.error) throw tableResult.error;
  return tableResult.data || [];
}

function renderAuditPanel() {
  const panel = document.getElementById('auditTabPanel');

  if (!state.profile?.is_admin) {
    panel.innerHTML = '<p>You do not have permission to view the audit log.</p>';
    return;
  }

  const rows = state.auditRows.map((row, index) => {
    const rowId = `audit-${index}`;
    return `
      <tr data-audit-toggle="${rowId}" class="audit-row">
        <td>${escapeHtml(formatDate(row.changed_at))}</td>
        <td>${escapeHtml(row.changed_by_email || '')}</td>
        <td>${escapeHtml(row.table_name || '')}</td>
        <td>${escapeHtml(row.action || '')}</td>
        <td>${escapeHtml(row.group_slug || '')}</td>
        <td>${escapeHtml(row.page_slug || '')}</td>
        <td>${escapeHtml(row.record_label || '')}</td>
      </tr>
      <tr id="${rowId}" class="audit-detail hidden">
        <td colspan="7">
          <div class="audit-json-grid">
            <section>
              <h4>Changed Fields</h4>
              <pre>${escapeHtml(formatJson(row.changed_fields))}</pre>
            </section>
            <section>
              <h4>Old Data</h4>
              <pre>${escapeHtml(formatJson(row.old_data))}</pre>
            </section>
            <section>
              <h4>New Data</h4>
              <pre>${escapeHtml(formatJson(row.new_data))}</pre>
            </section>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  panel.innerHTML = `
    <h2>Audit Log</h2>
    <p class="subtle-text">Latest ${state.auditRows.length} change records.</p>
    <div class="table-wrap">
      <table class="audit-table">
        <thead>
          <tr>
            <th>changed_at</th>
            <th>changed_by_email</th>
            <th>table_name</th>
            <th>action</th>
            <th>group_slug</th>
            <th>page_slug</th>
            <th>record_label</th>
          </tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="7">No audit records found.</td></tr>'}</tbody>
      </table>
    </div>
  `;

  panel.querySelectorAll('.audit-row').forEach((row) => {
    row.addEventListener('click', () => {
      const detail = document.getElementById(row.dataset.auditToggle);
      detail?.classList.toggle('hidden');
    });
  });
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
    console.error('Supabase client not initialized');
    document.body.innerHTML = '<main class="admin-shell"><p>Supabase client unavailable.</p></main>';
    return;
  }

  state.user = await requireUser();
  if (!state.user) return;

  state.profile = await fetchProfile(state.user.id);
  state.memberships = await fetchMemberships(state.user.id);
  state.groups = state.profile?.is_admin
    ? await fetchAllGroups()
    : state.memberships.map((membership) => membership.event_groups).filter(Boolean);

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
    document.body.innerHTML = `<main class="admin-shell"><p class="error-text">${escapeHtml(error.message || 'Failed to load admin page.')}</p></main>`;
  }
});
