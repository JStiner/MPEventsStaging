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
  selectedGroupViewBySlug: {},
  groupCalendarAnchorBySlug: {},
  groupLoadErrors: {},
  dateModalContext: null,
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

function formatDateOnly(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function toDateKey(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getDateRangeStart(date) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() - copy.getDay());
  return copy;
}

function formatJson(value) {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return String(value ?? '');
  }
}

function toTitleCase(value) {
  return String(value ?? '')
    .replaceAll('_', ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ');
}

function renderMetaRows(rows) {
  const content = rows.map(({ label, value }) => `
    <div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value ?? '—')}</dd></div>
  `).join('');

  return `<dl class="admin-meta compact">${content || '<div><dt>Status</dt><dd>—</dd></div>'}</dl>`;
}

function renderChipList(items, emptyLabel) {
  if (!items.length) {
    return `<p class="subtle-text">${escapeHtml(emptyLabel)}</p>`;
  }

  const chips = items.map((item) => `<li class="admin-chip">${escapeHtml(item)}</li>`).join('');
  return `<ul class="admin-chip-list">${chips}</ul>`;
}

function renderObjectRows(value, emptyLabel) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return `<p class="subtle-text">${escapeHtml(emptyLabel)}</p>`;
  }

  const entries = Object.entries(value);
  if (!entries.length) {
    return `<p class="subtle-text">${escapeHtml(emptyLabel)}</p>`;
  }

  const rows = entries.map(([key, entryValue]) => ({
    label: toTitleCase(key),
    value: entryValue === null || entryValue === undefined || entryValue === '' ? '—' : String(entryValue),
  }));
  return renderMetaRows(rows);
}

function renderListRows(value, emptyLabel) {
  if (!Array.isArray(value) || !value.length) {
    return `<p class="subtle-text">${escapeHtml(emptyLabel)}</p>`;
  }

  const rows = value.map((entry, index) => {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const objectRows = Object.entries(entry).map(([key, objectValue]) => `
        <li><strong>${escapeHtml(toTitleCase(key))}:</strong> ${escapeHtml(objectValue === null || objectValue === undefined || objectValue === '' ? '—' : String(objectValue))}</li>
      `).join('');
      return `<li><span class="subtle-text">Item ${index + 1}</span><ul class="admin-list">${objectRows}</ul></li>`;
    }

    return `<li>${escapeHtml(String(entry))}</li>`;
  }).join('');

  return `<ul class="admin-list">${rows}</ul>`;
}

function getFieldValue(entry, keys = [], fallback = '—') {
  if (!entry || typeof entry !== 'object') return fallback;
  for (const key of keys) {
    const value = entry[key];
    if (value !== null && value !== undefined && value !== '') return value;
  }
  return fallback;
}

function mapExistingPageDataToCalendarItems(groupSlug, pages) {
  const items = [];

  pages.forEach((page) => {
    const dateEntries = Array.isArray(page.dates) ? page.dates : [];
    dateEntries.forEach((entry, index) => {
      const isString = typeof entry === 'string';
      const dateKey = toDateKey(isString ? entry : (entry?.date || entry?.event_date || entry?.day || entry?.start_date));
      if (!dateKey) return;

      const title = isString
        ? (page.event_name || page.slug || `Item ${index + 1}`)
        : String(getFieldValue(entry, ['title', 'name', 'event_name'], page.event_name || page.slug || 'Untitled'));

      items.push({
        id: `${page.slug}:${index}`,
        groupSlug,
        pageSlug: page.slug,
        pageName: page.event_name || page.slug,
        entryIndex: index,
        date: dateKey,
        title,
        startTime: String(getFieldValue(entry, ['start_time', 'startTime', 'time', 'begin_time'], '')),
        endTime: String(getFieldValue(entry, ['end_time', 'endTime'], '')),
        location: String(getFieldValue(entry, ['location', 'place', 'venue'], '')),
        description: String(getFieldValue(entry, ['description', 'summary', 'details'], '')),
        category: String(getFieldValue(entry, ['category', 'type'], page.category || '')),
        sourceEntry: entry,
      });
    });
  });

  return items.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    if (a.startTime !== b.startTime) return a.startTime.localeCompare(b.startTime);
    return a.title.localeCompare(b.title);
  });
}

function buildCalendarMatrix(anchorDate) {
  const firstOfMonth = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
  const start = getDateRangeStart(firstOfMonth);
  const lastOfMonth = new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 0);
  const end = new Date(lastOfMonth);
  end.setDate(lastOfMonth.getDate() + (6 - lastOfMonth.getDay()));

  const days = [];
  for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    days.push(new Date(cursor));
  }
  return days;
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

  const activeGroupView = state.selectedGroupViewBySlug[group.slug] || 'calendar';
  state.selectedGroupViewBySlug[group.slug] = activeGroupView;

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

  const viewNav = `
    <div class="admin-tabs group-subnav">
      <button type="button" class="admin-tab ${activeGroupView === 'calendar' ? 'active' : ''}" data-group-view="calendar">Calendar</button>
      <button type="button" class="admin-tab ${activeGroupView === 'pages' ? 'active' : ''}" data-group-view="pages">Page Data</button>
    </div>
  `;

  const calendarSection = activeGroupView === 'calendar'
    ? renderGroupCalendar(group, pages)
    : '';

  const pageDetailsSection = activeGroupView === 'pages'
    ? `
      <div class="admin-grid">
        <section class="admin-card">
          <h3>Pages</h3>
          <div class="admin-tabs">${pageList}</div>
        </section>

        <section class="admin-card page-details-card">
          <h3>Page Details</h3>
          <div class="page-sections-grid">
            <section class="admin-subcard">
              <h4>Page Info</h4>
              ${renderMetaRows([
                { label: 'Slug', value: selectedPage.slug || '—' },
                { label: 'Event Name', value: selectedPage.event_name || '—' },
                { label: 'Event Type', value: selectedPage.event_type || '—' },
                { label: 'Summary', value: selectedPage.summary || '—' },
                { label: 'Category', value: selectedPage.category || '—' },
                { label: 'Group Slug', value: selectedPage.group_slug || '—' },
              ])}
            </section>

            <section class="admin-subcard">
              <h4>Labels</h4>
              ${renderMetaRows([
                { label: 'Date Label', value: selectedPage.date_label || '—' },
                { label: 'Area Label', value: selectedPage.area_label || '—' },
              ])}
            </section>

            <section class="admin-subcard">
              <h4>Tabs</h4>
              ${renderChipList(Array.isArray(selectedPage.tabs) ? selectedPage.tabs.map((tab) => String(tab)) : [], 'No tabs available.')}
              <details>
                <summary>Tabs JSON</summary>
                <pre class="json-block">${escapeHtml(formatJson(selectedPage.tabs))}</pre>
              </details>
            </section>

            <section class="admin-subcard">
              <h4>Dates</h4>
              ${renderListRows(selectedPage.dates, 'No dates available.')}
              <details>
                <summary>Dates JSON</summary>
                <pre class="json-block">${escapeHtml(formatJson(selectedPage.dates))}</pre>
              </details>
            </section>

            <section class="admin-subcard">
              <h4>Theme / Branding</h4>
              ${renderObjectRows(selectedPage.theme, 'No theme data.')}
              ${renderObjectRows(selectedPage.featured_branding, 'No branding data.')}
              <details>
                <summary>Theme / Branding JSON</summary>
                <pre class="json-block">${escapeHtml(formatJson({ theme: selectedPage.theme, featured_branding: selectedPage.featured_branding }))}</pre>
              </details>
            </section>

            <section class="admin-subcard">
              <h4>Flyer</h4>
              ${renderObjectRows(selectedPage.flyer, 'No flyer data.')}
              <details>
                <summary>Flyer JSON</summary>
                <pre class="json-block">${escapeHtml(formatJson(selectedPage.flyer))}</pre>
              </details>
            </section>

            <section class="admin-subcard">
              <h4>Resources</h4>
              ${renderListRows(selectedPage.resources, 'No resources available.')}
              <details>
                <summary>Resources JSON</summary>
                <pre class="json-block">${escapeHtml(formatJson(selectedPage.resources))}</pre>
              </details>
            </section>

            <section class="admin-subcard">
              <h4>Raw JSON</h4>
              <details>
                <summary>Show full raw payload</summary>
                <pre class="json-block">${escapeHtml(formatJson(selectedPage.raw))}</pre>
              </details>
            </section>
          </div>
        </section>
      </div>
    `
    : '';

  panel.innerHTML = `
    <h2>${escapeHtml(group.name)}</h2>
    <p class="subtle-text">${pages.length} page${pages.length === 1 ? '' : 's'} in <strong>${escapeHtml(group.slug)}</strong>.</p>
    ${viewNav}
    ${calendarSection}
    ${pageDetailsSection}
  `;

  panel.querySelectorAll('[data-group-view]').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedGroupViewBySlug[group.slug] = button.dataset.groupView;
      renderGroupPanel(tabKey);
    });
  });

  panel.querySelector('[data-calendar-prev]')?.addEventListener('click', () => {
    const anchor = state.groupCalendarAnchorBySlug[group.slug] || new Date();
    state.groupCalendarAnchorBySlug[group.slug] = new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1);
    renderGroupPanel(tabKey);
  });

  panel.querySelector('[data-calendar-next]')?.addEventListener('click', () => {
    const anchor = state.groupCalendarAnchorBySlug[group.slug] || new Date();
    state.groupCalendarAnchorBySlug[group.slug] = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);
    renderGroupPanel(tabKey);
  });

  panel.querySelectorAll('[data-calendar-date]').forEach((button) => {
    button.addEventListener('click', () => {
      const date = button.dataset.calendarDate;
      if (!date) return;
      const items = mapExistingPageDataToCalendarItems(group.slug, pages).filter((item) => item.date === date);
      openDateModal(group, pages, date, items);
    });
  });

  panel.querySelectorAll('[data-page-slug]').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedPageByGroup[group.slug] = button.dataset.pageSlug;
      renderGroupPanel(tabKey);
    });
  });
}

function renderGroupCalendar(group, pages) {
  const anchor = state.groupCalendarAnchorBySlug[group.slug] || new Date();
  state.groupCalendarAnchorBySlug[group.slug] = anchor;
  const calendarItems = mapExistingPageDataToCalendarItems(group.slug, pages);
  const itemsByDate = new Map();
  calendarItems.forEach((item) => {
    const list = itemsByDate.get(item.date) || [];
    list.push(item);
    itemsByDate.set(item.date, list);
  });

  const dayCells = buildCalendarMatrix(anchor);
  const monthLabel = anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    .map((day) => `<div class="group-calendar-weekday">${day}</div>`)
    .join('');

  const cells = dayCells.map((date) => {
    const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const dayItems = itemsByDate.get(dateKey) || [];
    const muted = date.getMonth() !== anchor.getMonth() ? 'muted' : '';
    const hasItems = dayItems.length ? 'has-items' : '';
    return `
      <button type="button" class="group-calendar-cell ${muted} ${hasItems}" data-calendar-date="${escapeHtml(dateKey)}">
        <span class="group-calendar-day-number">${date.getDate()}</span>
        <span class="group-calendar-item-count">${dayItems.length ? `${dayItems.length} item${dayItems.length === 1 ? '' : 's'}` : 'No items'}</span>
      </button>
    `;
  }).join('');

  return `
    <section class="admin-card">
      <div class="calendar-header-row">
        <h3>Calendar</h3>
        <div class="button-row">
          <button type="button" data-calendar-prev>&larr;</button>
          <strong>${escapeHtml(monthLabel)}</strong>
          <button type="button" data-calendar-next>&rarr;</button>
        </div>
      </div>
      <p class="subtle-text">Click a date to view, add, or edit items.</p>
      <div class="group-calendar-grid">
        ${weekdayLabels}
        ${cells}
      </div>
    </section>
  `;
}

function openDateModal(group, pages, date, items) {
  state.dateModalContext = { group, pages, date, editItemId: null };
  renderDateModal(items);
}

function closeDateModal() {
  state.dateModalContext = null;
  const modal = document.getElementById('dateItemModal');
  modal?.classList.add('hidden');
}

function buildEditableDateEntry(formData) {
  return {
    date: formData.date,
    title: formData.title,
    start_time: formData.start_time,
    end_time: formData.end_time,
    location: formData.location,
    description: formData.description,
    category: formData.category,
  };
}

async function saveDateItem(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!state.dateModalContext) return;
  const { group, pages, editItemId } = state.dateModalContext;
  const formData = Object.fromEntries(new FormData(form).entries());
  const targetPageSlug = String(formData.page_slug || '');
  const targetPage = pages.find((page) => page.slug === targetPageSlug);
  if (!targetPage) return;
  const sourceItem = editItemId
    ? mapExistingPageDataToCalendarItems(group.slug, pages).find((item) => item.id === editItemId)
    : null;

  const dates = Array.isArray(targetPage.dates) ? [...targetPage.dates] : [];
  const nextEntry = buildEditableDateEntry(formData);

  if (editItemId) {
    if (sourceItem && sourceItem.pageSlug === targetPage.slug && Number.isInteger(sourceItem.entryIndex)) {
      dates[sourceItem.entryIndex] = nextEntry;
    } else {
      dates.push(nextEntry);
    }
  } else {
    dates.push(nextEntry);
  }

  const { error } = await supabaseClient
    .from('event_pages')
    .update({ dates })
    .eq('group_slug', group.slug)
    .eq('slug', targetPage.slug);

  const messageEl = form.querySelector('[data-modal-message]');
  if (error) {
    if (messageEl) messageEl.textContent = `Failed to save item: ${error.message || 'Unknown error'}`;
    return;
  }

  let nextPages = pages.map((page) => (
    page.slug === targetPage.slug
      ? { ...page, dates }
      : page
  ));

  if (sourceItem && sourceItem.pageSlug !== targetPage.slug && Number.isInteger(sourceItem.entryIndex)) {
    nextPages = nextPages.map((page) => {
      if (page.slug !== sourceItem.pageSlug) return page;
      const sourceDates = Array.isArray(page.dates) ? [...page.dates] : [];
      sourceDates.splice(sourceItem.entryIndex, 1);
      return { ...page, dates: sourceDates };
    });

    const sourcePage = nextPages.find((page) => page.slug === sourceItem.pageSlug);
    const sourceUpdate = await supabaseClient
      .from('event_pages')
      .update({ dates: sourcePage?.dates || [] })
      .eq('group_slug', group.slug)
      .eq('slug', sourceItem.pageSlug);

    if (sourceUpdate.error && messageEl) {
      messageEl.textContent = `Saved target page, but failed to remove old item: ${sourceUpdate.error.message || 'Unknown error'}`;
    }
  }

  state.groupPagesBySlug[group.slug] = nextPages;

  const dateItems = mapExistingPageDataToCalendarItems(group.slug, state.groupPagesBySlug[group.slug])
    .filter((item) => item.date === state.dateModalContext.date);
  state.dateModalContext.editItemId = null;
  renderDateModal(dateItems);
  if (state.activeTab === `group:${group.slug}`) {
    renderGroupPanel(state.activeTab);
  }
}

function renderDateModal(items) {
  const modal = document.getElementById('dateItemModal');
  const content = document.getElementById('dateItemModalContent');
  if (!modal || !content || !state.dateModalContext) return;
  const { group, pages, date, editItemId } = state.dateModalContext;
  const editingItem = editItemId ? items.find((item) => item.id === editItemId) : null;

  const itemRows = items.map((item) => `
    <li class="date-item-row">
      <div>
        <strong>${escapeHtml(item.title || 'Untitled')}</strong>
        <p class="subtle-text">${escapeHtml(item.startTime || '—')} - ${escapeHtml(item.endTime || '—')} • ${escapeHtml(item.location || 'No location')}</p>
      </div>
      <button type="button" class="admin-tab" data-edit-item-id="${escapeHtml(item.id)}">Edit</button>
    </li>
  `).join('');

  const selectedPageForForm = editingItem?.pageSlug || pages[0]?.slug || '';

  content.innerHTML = `
    <div class="calendar-modal-header">
      <h3>${escapeHtml(formatDateOnly(date))}</h3>
      <button type="button" class="admin-tab" data-close-date-modal>Close</button>
    </div>
    <p class="subtle-text">${escapeHtml(group.name)} (${escapeHtml(group.slug)})</p>

    <section class="admin-subcard">
      <h4>Items for selected date</h4>
      ${items.length ? `<ul class="admin-list date-item-list">${itemRows}</ul>` : '<p class="subtle-text">No items exist for this date yet.</p>'}
      <div class="button-row">
        <button type="button" data-add-item>+ Add New Item</button>
      </div>
    </section>

    <section class="admin-subcard">
      <h4>${editingItem ? 'Edit Item' : 'New Item'}</h4>
      <form id="dateItemEditorForm" class="admin-form">
        <label>Page
          <select name="page_slug" required>
            ${pages.map((page) => `<option value="${escapeHtml(page.slug)}" ${page.slug === selectedPageForForm ? 'selected' : ''}>${escapeHtml(page.event_name || page.slug)}</option>`).join('')}
          </select>
        </label>
        <div class="admin-columns-2">
          <label>Title<input type="text" name="title" value="${escapeHtml(editingItem?.title || '')}" required></label>
          <label>Category/Type<input type="text" name="category" value="${escapeHtml(editingItem?.category || '')}"></label>
        </div>
        <div class="admin-columns-2">
          <label>Start Time<input type="text" name="start_time" placeholder="6:00 PM" value="${escapeHtml(editingItem?.startTime || '')}"></label>
          <label>End Time<input type="text" name="end_time" placeholder="8:00 PM" value="${escapeHtml(editingItem?.endTime || '')}"></label>
        </div>
        <label>Location<input type="text" name="location" value="${escapeHtml(editingItem?.location || '')}"></label>
        <label>Description<textarea name="description" rows="3">${escapeHtml(editingItem?.description || '')}</textarea></label>
        <input type="hidden" name="date" value="${escapeHtml(date)}">
        <p class="error-text" data-modal-message></p>
        <div class="button-row">
          <button type="submit">${editingItem ? 'Save Changes' : 'Save Item'}</button>
        </div>
      </form>
    </section>
  `;

  content.querySelector('[data-close-date-modal]')?.addEventListener('click', closeDateModal);
  content.querySelector('[data-add-item]')?.addEventListener('click', () => {
    state.dateModalContext.editItemId = null;
    renderDateModal(items);
  });
  content.querySelectorAll('[data-edit-item-id]').forEach((button) => {
    button.addEventListener('click', () => {
      state.dateModalContext.editItemId = button.dataset.editItemId;
      renderDateModal(items);
    });
  });
  content.querySelector('#dateItemEditorForm')?.addEventListener('submit', saveDateItem);

  modal.classList.remove('hidden');
}

function ensureDateModal() {
  if (document.getElementById('dateItemModal')) return;
  const modal = document.createElement('div');
  modal.id = 'dateItemModal';
  modal.className = 'admin-modal hidden';
  modal.innerHTML = '<div class="admin-modal-card" id="dateItemModalContent"></div>';
  document.body.appendChild(modal);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeDateModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeDateModal();
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
  ensureDateModal();

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
