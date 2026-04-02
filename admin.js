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
  groupSelectedDateBySlug: {},
  groupCalendarEditorBySlug: {},
  groupSubviewConfigBySlug: {},
  groupCalendarAnchorBySlug: {},
  groupLoadErrors: {},
};

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
const SUPPORTED_GROUP_VIEWS = new Set(['calendar', 'pages']);
const GROUP_SUBVIEW_STORAGE_KEY = 'admin.groupSubviewConfig.v1';
const DEFAULT_GROUP_SUBVIEW_CONFIG = {
  '*': {
    calendar: true,
    pages: true,
    schedule: false,
    vendors: false,
    locations: false,
    flyer: false,
    resources: false,
    settings: false,
  },
  'christmas-on-vinegar-hill': {
    calendar: false,
    pages: true,
    schedule: false,
    vendors: false,
    locations: false,
    flyer: false,
    resources: false,
    settings: false,
  },
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

function getDefaultSubviewConfigForGroup(groupSlug) {
  return {
    ...DEFAULT_GROUP_SUBVIEW_CONFIG['*'],
    ...(DEFAULT_GROUP_SUBVIEW_CONFIG[groupSlug] || {}),
  };
}

function hydrateGroupSubviewConfig(groups) {
  let stored = {};
  try {
    stored = JSON.parse(window.localStorage.getItem(GROUP_SUBVIEW_STORAGE_KEY) || '{}');
  } catch {
    stored = {};
  }

  state.groupSubviewConfigBySlug = {};
  groups.forEach((group) => {
    const defaultConfig = getDefaultSubviewConfigForGroup(group.slug);
    const savedConfig = stored?.[group.slug] && typeof stored[group.slug] === 'object' ? stored[group.slug] : {};
    state.groupSubviewConfigBySlug[group.slug] = { ...defaultConfig, ...savedConfig };
  });
}

function persistGroupSubviewConfig() {
  try {
    window.localStorage.setItem(GROUP_SUBVIEW_STORAGE_KEY, JSON.stringify(state.groupSubviewConfigBySlug));
  } catch (error) {
    console.warn('Unable to persist group subview config', error);
  }
}

function getEnabledGroupViews(groupSlug) {
  const config = state.groupSubviewConfigBySlug[groupSlug] || getDefaultSubviewConfigForGroup(groupSlug);
  return GROUP_SUBVIEW_KEYS.filter((key) => config[key]);
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

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? '').trim())
    .filter(Boolean);
}

function normalizeDatesForEditor(value) {
  if (!Array.isArray(value)) return [];
  const entries = value.map((entry) => {
    if (typeof entry === 'string') {
      return { date: toDateKey(entry) || '' };
    }
    if (entry && typeof entry === 'object') {
      return { date: toDateKey(entry.date || entry.event_date || entry.day || entry.start_date) || '' };
    }
    return { date: '' };
  }).filter((entry) => entry.date);

  return entries.length ? entries : [{ date: '' }];
}

function buildGeneralFormModel(page) {
  return {
    slug: page.slug || '',
    event_name: page.event_name || '',
    event_type: page.event_type || '',
    category: page.category || '',
    summary: page.summary || '',
    date_label: page.date_label || '',
    area_label: page.area_label || '',
    tabs: normalizeStringList(page.tabs),
    dates: normalizeDatesForEditor(page.dates),
    resources: normalizeStringList(page.resources),
    theme: page.theme || {},
    featured_branding: page.featured_branding || {},
    raw: page.raw || {},
    flyer: page.flyer || {},
  };
}

function renderStringListEditor(fieldName, values, addLabel) {
  const rows = (values.length ? values : ['']).map((item, index) => `
    <div class="list-editor-row">
      <input type="text" name="${fieldName}" value="${escapeHtml(item)}" placeholder="Enter value">
      <button type="button" class="list-row-remove" data-remove-row="${fieldName}" data-row-index="${index}">Remove</button>
    </div>
  `).join('');

  return `
    <div class="list-editor" data-list-editor="${fieldName}">
      ${rows}
    </div>
    <button type="button" class="secondary-action" data-add-row="${fieldName}">${escapeHtml(addLabel)}</button>
  `;
}

function renderDateListEditor(values) {
  const rows = (values.length ? values : [{ date: '' }]).map((item, index) => `
    <div class="list-editor-row date-row">
      <input type="date" name="dates" value="${escapeHtml(item.date || '')}">
      <button type="button" class="list-row-remove" data-remove-row="dates" data-row-index="${index}">Remove</button>
    </div>
  `).join('');

  return `
    <div class="list-editor" data-list-editor="dates">
      ${rows}
    </div>
    <button type="button" class="secondary-action" data-add-row="dates">Add Date</button>
  `;
}

function getFieldValue(entry, keys = [], fallback = '—') {
  if (!entry || typeof entry !== 'object') return fallback;
  for (const key of keys) {
    const value = entry[key];
    if (value !== null && value !== undefined && value !== '') return value;
  }
  return fallback;
}

function normalizeCalendarItem(item, context = {}) {
  const date = toDateKey(item?.date || item?.event_date || item?.day || item?.start_date);
  if (!date) return null;

  const title = String(getFieldValue(item, ['title', 'name', 'event_name'], context.pageName || context.pageSlug || 'Untitled'));
  const startTime = String(getFieldValue(item, ['start_time', 'startTime', 'time', 'begin_time'], ''));
  const endTime = String(getFieldValue(item, ['end_time', 'endTime'], ''));
  const location = String(getFieldValue(item, ['location', 'locationName', 'place', 'venue'], ''));
  const description = String(getFieldValue(item, ['description', 'summary', 'details'], ''));
  const category = String(getFieldValue(item, ['category', 'type'], context.pageCategory || ''));

  return {
    id: String(context.id || item?.id || `${context.pageSlug || 'event'}:${date}:${title}`),
    title,
    date,
    startTime,
    endTime,
    location,
    description,
    category,
    sourcePageSlug: context.pageSlug || '',
    groupSlug: context.groupSlug || '',
    pageSlug: context.pageSlug || '',
    pageName: context.pageName || context.pageSlug || '',
    entryIndex: Number.isInteger(context.entryIndex) ? context.entryIndex : null,
    sourceEntry: item,
    sourceType: context.sourceType || 'unknown',
  };
}

function extractPageCalendarItems(page, groupSlug) {
  const pageName = page.event_name || page.slug;
  const pageCategory = page.category || '';
  const normalized = [];
  const rawMatchesByDate = new Map();
  const pushRawMatch = (dateKey, sourceType, rawItem) => {
    if (!dateKey) return;
    const list = rawMatchesByDate.get(dateKey) || [];
    list.push({ sourceType, rawItem });
    rawMatchesByDate.set(dateKey, list);
  };

  const dateEntries = Array.isArray(page.dates) ? page.dates : [];
  dateEntries.forEach((entry, index) => {
    const rawEntry = typeof entry === 'string' ? { date: entry } : (entry || {});
    const normalizedEntry = normalizeCalendarItem(rawEntry, {
      id: `${page.slug}:dates:${index}`,
      groupSlug,
      pageSlug: page.slug,
      pageName,
      pageCategory,
      entryIndex: index,
      sourceType: 'dates',
    });
    if (!normalizedEntry) return;
    normalized.push(normalizedEntry);
    pushRawMatch(normalizedEntry.date, 'dates', entry);
  });

  const raw = page.raw && typeof page.raw === 'object' ? page.raw : {};
  const rawDays = Array.isArray(raw.days) ? raw.days : [];
  const rawLocations = Array.isArray(raw.locations) ? raw.locations : [];
  const dayDateById = new Map();
  rawDays.forEach((day) => {
    const dayDate = toDateKey(day?.date || day?.event_date || day?.day || day?.start_date);
    if (!dayDate) return;
    [day?.id, day?.external_id, day?.key].filter(Boolean).forEach((key) => dayDateById.set(String(key), dayDate));
  });
  const locationById = new Map();
  rawLocations.forEach((loc) => {
    const locName = String(getFieldValue(loc, ['name', 'location', 'title'], '') || '');
    [loc?.id, loc?.external_id, loc?.key].filter(Boolean).forEach((key) => locationById.set(String(key), locName));
  });

  const rawSchedules = Array.isArray(raw.schedule) ? raw.schedule : [];
  rawSchedules.forEach((entry, index) => {
    const dayId = String(entry?.dayId || entry?.day_id || entry?.day_external_id || '');
    const locationId = String(entry?.locationId || entry?.location_id || entry?.location_external_id || '');
    const resolvedDate = toDateKey(entry?.date || entry?.event_date || entry?.day || dayDateById.get(dayId));
    const resolvedLocation = String(getFieldValue(entry, ['location', 'locationName', 'place', 'venue'], locationById.get(locationId) || ''));
    const normalizedEntry = normalizeCalendarItem(
      { ...entry, date: resolvedDate, location: resolvedLocation },
      {
        id: `${page.slug}:raw.schedule:${index}`,
        groupSlug,
        pageSlug: page.slug,
        pageName,
        pageCategory,
        sourceType: 'raw.schedule',
      },
    );
    if (!normalizedEntry) return;
    normalized.push(normalizedEntry);
    pushRawMatch(normalizedEntry.date, 'raw.schedule', entry);
  });

  const rawEvents = Array.isArray(raw.events) ? raw.events : [];
  rawEvents.forEach((entry, index) => {
    const normalizedEntry = normalizeCalendarItem(entry, {
      id: `${page.slug}:raw.events:${index}`,
      groupSlug,
      pageSlug: page.slug,
      pageName,
      pageCategory,
      sourceType: 'raw.events',
    });
    if (!normalizedEntry) return;
    normalized.push(normalizedEntry);
    pushRawMatch(normalizedEntry.date, 'raw.events', entry);
  });

  return { normalized, rawMatchesByDate };
}

function mapExistingPageDataToCalendarItems(groupSlug, pages) {
  const items = [];
  pages.forEach((page) => {
    const pageItems = extractPageCalendarItems(page, groupSlug);
    items.push(...pageItems.normalized);
  });
  return items.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    if (a.startTime !== b.startTime) return a.startTime.localeCompare(b.startTime);
    return a.title.localeCompare(b.title);
  });
}

function buildCalendarDayCounts(items) {
  const countsByDate = new Map();
  items.forEach((item) => {
    if (!item?.date) return;
    countsByDate.set(item.date, (countsByDate.get(item.date) || 0) + 1);
  });
  return countsByDate;
}

function extractCalendarItemsForDate(groupSlug, pages, selectedDate) {
  const dateKey = toDateKey(selectedDate);
  const normalizedItems = [];
  const rawMatches = [];
  if (!dateKey) return { dateKey: null, normalizedItems, rawMatches };

  pages.forEach((page) => {
    const pageItems = extractPageCalendarItems(page, groupSlug);
    normalizedItems.push(...pageItems.normalized.filter((item) => item.date === dateKey));
    const rawForDate = pageItems.rawMatchesByDate.get(dateKey) || [];
    rawMatches.push(...rawForDate.map((entry) => ({ pageSlug: page.slug, ...entry })));
  });

  normalizedItems.sort((a, b) => {
    if (a.startTime !== b.startTime) return a.startTime.localeCompare(b.startTime);
    return a.title.localeCompare(b.title);
  });

  console.groupCollapsed(`[admin calendar] selected date ${dateKey}`);
  console.log('selected date:', dateKey);
  console.log('raw matched items for selected date:', rawMatches);
  console.log('normalized items for renderer:', normalizedItems);
  console.groupEnd();

  return { dateKey, normalizedItems, rawMatches };
}

function getGroupCalendarBehavior(groupSlug) {
  return {
    supportsInlineEditor: true,
    eventNoun: 'event',
    emptyLabel: 'No events',
    groupSlug,
  };
}

function formatEventCountLabel(count, behavior = getGroupCalendarBehavior()) {
  if (!count) return behavior.emptyLabel;
  if (count === 1) return `1 ${behavior.eventNoun}`;
  return `${count} ${behavior.eventNoun}s`;
}

function getWeekKeyFromDate(dateValue) {
  const parsed = new Date(`${dateValue}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  const start = getDateRangeStart(parsed);
  return toDateKey(start);
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
  const groupSubviewRows = state.groups.map((group) => {
    const config = state.groupSubviewConfigBySlug[group.slug] || getDefaultSubviewConfigForGroup(group.slug);
    const cells = GROUP_SUBVIEW_KEYS.map((key) => `
      <label class="subview-toggle">
        <input
          type="checkbox"
          data-group-subview-toggle="true"
          data-group-slug="${escapeHtml(group.slug)}"
          data-subview-key="${escapeHtml(key)}"
          ${config[key] ? 'checked' : ''}
        >
        <span>${escapeHtml(GROUP_SUBVIEW_LABELS[key])}</span>
      </label>
    `).join('');

    return `
      <tr>
        <th scope="row">${escapeHtml(group.name)}<br><span class="subtle-text">${escapeHtml(group.slug)}</span></th>
        <td>
          <div class="subview-toggle-grid">${cells}</div>
        </td>
      </tr>
    `;
  }).join('');

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

    <section class="admin-card">
      <h3>Event Groups</h3>
      <ul class="admin-list">${list || '<li>No event groups found.</li>'}</ul>
    </section>

    <section class="admin-card">
      <h3>Group Subview Management</h3>
      <p class="subtle-text">Enable or disable which subviews are available inside each group tab.</p>
      <div class="table-wrap">
        <table class="admin-table">
          <thead>
            <tr><th>Group</th><th>Enabled subviews</th></tr>
          </thead>
          <tbody>${groupSubviewRows || '<tr><td colspan="2">No groups found.</td></tr>'}</tbody>
        </table>
      </div>
    </section>
  `;

  panel.querySelector('#signOutButton')?.addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
    window.location.href = './login.html';
  });

  panel.querySelectorAll('[data-group-subview-toggle]').forEach((input) => {
    input.addEventListener('change', () => {
      const groupSlug = input.dataset.groupSlug;
      const subviewKey = input.dataset.subviewKey;
      if (!groupSlug || !subviewKey) return;
      const config = state.groupSubviewConfigBySlug[groupSlug] || getDefaultSubviewConfigForGroup(groupSlug);
      config[subviewKey] = input.checked;
      state.groupSubviewConfigBySlug[groupSlug] = config;
      persistGroupSubviewConfig();

      const activeGroupKey = `group:${groupSlug}`;
      if (state.activeTab === activeGroupKey) {
        const enabledViews = getEnabledGroupViews(groupSlug);
        if (!enabledViews.includes(state.selectedGroupViewBySlug[groupSlug])) {
          state.selectedGroupViewBySlug[groupSlug] = enabledViews[0] || 'pages';
        }
        renderGroupPanel(activeGroupKey);
      }
    });
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

  const enabledViews = getEnabledGroupViews(group.slug);
  const preferredView = state.selectedGroupViewBySlug[group.slug] || enabledViews[0] || 'pages';
  const activeGroupView = enabledViews.includes(preferredView) ? preferredView : (enabledViews[0] || 'pages');
  state.selectedGroupViewBySlug[group.slug] = activeGroupView;

  const selectedSlug = state.selectedPageByGroup[group.slug] || pages[0].slug;
  state.selectedPageByGroup[group.slug] = selectedSlug;

  const selectedPage = pages.find((page) => page.slug === selectedSlug) || pages[0];
  state.selectedPageByGroup[group.slug] = selectedPage.slug;

  const isSinglePageGroup = pages.length === 1;

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
      ${enabledViews.map((view) => `
        <button type="button" class="admin-tab ${activeGroupView === view ? 'active' : ''}" data-group-view="${escapeHtml(view)}">
          ${escapeHtml(GROUP_SUBVIEW_LABELS[view] || toTitleCase(view))}
        </button>
      `).join('')}
    </div>
  `;

  const calendarSection = activeGroupView === 'calendar' ? renderGroupCalendar(group, pages) : '';

  const formPage = buildGeneralFormModel(selectedPage);

  const pageDetailsSection = activeGroupView === 'pages'
    ? `
      <div class="group-general-layout ${isSinglePageGroup ? 'single-page' : 'multi-page'}">
        ${isSinglePageGroup ? '' : `
          <aside class="admin-card group-page-rail">
            <h3>Pages</h3>
            <div class="admin-tabs rail-tabs">${pageList}</div>
          </aside>
        `}

        <section class="group-general-main">
          ${isSinglePageGroup ? `
            <div class="page-identifier">
              <strong>Page:</strong> ${escapeHtml(selectedPage.event_name || selectedPage.slug)} <span class="subtle-text">(${escapeHtml(selectedPage.slug)})</span>
            </div>
          ` : ''}

          <form class="admin-form general-edit-form" data-page-edit-form="${escapeHtml(selectedPage.slug)}">
            <div class="general-sections-grid">
              <section class="admin-subcard">
                <h4>Basic Info</h4>
                <label>
                  Event Name
                  <input type="text" name="event_name" value="${escapeHtml(formPage.event_name)}" required>
                </label>
                <label>
                  Slug
                  <input type="text" name="slug" value="${escapeHtml(formPage.slug)}">
                </label>
                <p class="subtle-text compact-note">Changing the slug can break existing links and integrations.</p>
                <label>
                  Event Type
                  <input type="text" name="event_type" value="${escapeHtml(formPage.event_type)}">
                </label>
                <label>
                  Category
                  <input type="text" name="category" value="${escapeHtml(formPage.category)}">
                </label>
                <label>
                  Group Slug
                  <input type="text" value="${escapeHtml(selectedPage.group_slug || '')}" disabled>
                </label>
              </section>

              <section class="admin-subcard section-wide">
                <h4>Summary</h4>
                <label>
                  Summary
                  <textarea name="summary" rows="5">${escapeHtml(formPage.summary)}</textarea>
                </label>
              </section>

              <section class="admin-subcard">
                <h4>Labels</h4>
                <label>
                  Date Label
                  <input type="text" name="date_label" value="${escapeHtml(formPage.date_label)}">
                </label>
                <label>
                  Area Label
                  <textarea name="area_label" rows="4">${escapeHtml(formPage.area_label)}</textarea>
                </label>
              </section>

              <section class="admin-subcard">
                <h4>Tabs</h4>
                ${renderStringListEditor('tabs', formPage.tabs, 'Add Tab')}
              </section>

              <section class="admin-subcard">
                <h4>Dates</h4>
                ${renderDateListEditor(formPage.dates)}
              </section>

              <section class="admin-subcard">
                <h4>Resources</h4>
                ${renderStringListEditor('resources', formPage.resources, 'Add Resource')}
              </section>

              <section class="admin-subcard section-wide">
                <h4>Advanced</h4>
                <details>
                  <summary>Theme / Branding</summary>
                  <pre class="json-block">${escapeHtml(formatJson({ theme: formPage.theme, featured_branding: formPage.featured_branding }))}</pre>
                </details>
                <details>
                  <summary>Raw JSON</summary>
                  <pre class="json-block">${escapeHtml(formatJson(formPage.raw))}</pre>
                </details>
              </section>
            </div>
            <div class="form-submit-row">
              <p class="subtle-text save-message" data-page-save-message></p>
              <button type="submit">Save</button>
            </div>
          </form>
        </section>
      </div>
    `
    : '';
  const placeholderSection = !SUPPORTED_GROUP_VIEWS.has(activeGroupView)
    ? renderGroupSubviewScaffold(group, activeGroupView)
    : '';

  panel.innerHTML = `
    <h2>${escapeHtml(group.name)}</h2>
    <p class="subtle-text">${pages.length} page${pages.length === 1 ? '' : 's'} in <strong>${escapeHtml(group.slug)}</strong>.</p>
    ${viewNav}
    ${calendarSection}
    ${pageDetailsSection}
    ${placeholderSection}
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
      state.groupSelectedDateBySlug[group.slug] = date;
      const nextEditorState = state.groupCalendarEditorBySlug[group.slug] || { mode: null, itemId: null };
      nextEditorState.mode = null;
      nextEditorState.itemId = null;
      state.groupCalendarEditorBySlug[group.slug] = nextEditorState;
      renderGroupPanel(tabKey);
    });
  });

  panel.querySelector('[data-calendar-add-event]')?.addEventListener('click', () => {
    state.groupCalendarEditorBySlug[group.slug] = { mode: 'add', itemId: null };
    renderGroupPanel(tabKey);
  });

  panel.querySelectorAll('[data-calendar-edit-item]').forEach((button) => {
    button.addEventListener('click', () => {
      state.groupCalendarEditorBySlug[group.slug] = { mode: 'edit', itemId: button.dataset.calendarEditItem || null };
      renderGroupPanel(tabKey);
    });
  });

  panel.querySelector('[data-calendar-cancel-form]')?.addEventListener('click', () => {
    state.groupCalendarEditorBySlug[group.slug] = { mode: null, itemId: null };
    renderGroupPanel(tabKey);
  });

  panel.querySelector('[data-calendar-inline-form]')?.addEventListener('submit', (event) => {
    saveCalendarDateItem(event, group);
  });

  panel.querySelectorAll('[data-page-slug]').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedPageByGroup[group.slug] = button.dataset.pageSlug;
      renderGroupPanel(tabKey);
    });
  });

  panel.querySelectorAll('[data-add-row]').forEach((button) => {
    button.addEventListener('click', () => {
      const fieldName = button.dataset.addRow;
      const listRoot = panel.querySelector(`[data-list-editor="${fieldName}"]`);
      if (!fieldName || !listRoot) return;
      const row = document.createElement('div');
      row.className = fieldName === 'dates' ? 'list-editor-row date-row' : 'list-editor-row';
      if (fieldName === 'dates') {
        row.innerHTML = `
          <input type="date" name="dates" value="">
          <button type="button" class="list-row-remove" data-remove-row="dates">Remove</button>
        `;
      } else {
        row.innerHTML = `
          <input type="text" name="${fieldName}" value="" placeholder="Enter value">
          <button type="button" class="list-row-remove" data-remove-row="${fieldName}">Remove</button>
        `;
      }
      listRoot.appendChild(row);
    });
  });

  panel.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-row]');
    if (!button) return;
    const row = button.closest('.list-editor-row');
    if (!row) return;
    const listRoot = row.parentElement;
    if (!listRoot) return;
    if (listRoot.querySelectorAll('.list-editor-row').length <= 1) {
      const input = row.querySelector('input');
      if (input) input.value = '';
      return;
    }
    row.remove();
  });

  panel.querySelector('[data-page-edit-form]')?.addEventListener('submit', (event) => saveGeneralPage(event, group));
}

async function saveGeneralPage(event, group) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form) return;
  const selectedSlug = state.selectedPageByGroup[group.slug];
  const pages = state.groupPagesBySlug[group.slug] || [];
  const page = pages.find((entry) => entry.slug === selectedSlug);
  const messageEl = form.querySelector('[data-page-save-message]');
  if (!page) {
    if (messageEl) messageEl.textContent = 'Unable to resolve selected page.';
    return;
  }

  const readValues = (name) => Array.from(form.querySelectorAll(`[name="${name}"]`))
    .map((input) => String(input.value || '').trim())
    .filter(Boolean);

  const nextSlug = String(form.querySelector('[name="slug"]')?.value || '').trim() || page.slug;
  const payload = {
    slug: nextSlug,
    event_name: String(form.querySelector('[name="event_name"]')?.value || '').trim(),
    event_type: String(form.querySelector('[name="event_type"]')?.value || '').trim() || null,
    category: String(form.querySelector('[name="category"]')?.value || '').trim() || null,
    summary: String(form.querySelector('[name="summary"]')?.value || '').trim() || null,
    date_label: String(form.querySelector('[name="date_label"]')?.value || '').trim() || null,
    area_label: String(form.querySelector('[name="area_label"]')?.value || '').trim() || null,
    tabs: readValues('tabs'),
    dates: readValues('dates').map((date) => ({ date })),
    resources: readValues('resources'),
  };

  const { error } = await supabaseClient
    .from('event_pages')
    .update(payload)
    .eq('group_slug', group.slug)
    .eq('slug', page.slug);

  if (error) {
    if (messageEl) messageEl.textContent = `Save failed: ${error.message || 'Unknown error'}`;
    return;
  }

  if (messageEl) messageEl.textContent = 'Saved.';

  state.groupPagesBySlug[group.slug] = pages.map((entry) => (
    entry.slug === page.slug
      ? { ...entry, ...payload, group_slug: group.slug }
      : entry
  ));
  state.selectedPageByGroup[group.slug] = nextSlug;
  renderGroupPanel(`group:${group.slug}`);
}

function renderGroupCalendar(group, pages) {
  const anchor = state.groupCalendarAnchorBySlug[group.slug] || new Date();
  state.groupCalendarAnchorBySlug[group.slug] = anchor;
  const behavior = getGroupCalendarBehavior(group.slug);
  const calendarItems = mapExistingPageDataToCalendarItems(group.slug, pages);
  const countsByDate = buildCalendarDayCounts(calendarItems);

  const dayCells = buildCalendarMatrix(anchor);
  const selectedDate = state.groupSelectedDateBySlug[group.slug];
  const selectedWeekKey = selectedDate ? getWeekKeyFromDate(selectedDate) : null;
  const monthLabel = anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const weekdayHeaders = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    .map((day) => `<th scope="col" class="group-calendar-weekday">${day}</th>`)
    .join('');

  const weekRows = [];
  for (let index = 0; index < dayCells.length; index += 7) {
    const weekDates = dayCells.slice(index, index + 7);
    const firstDateKey = toDateKey(weekDates[0]);
    const weekKey = firstDateKey ? getWeekKeyFromDate(firstDateKey) : null;

    const cells = weekDates.map((date) => {
      const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      const dayCount = countsByDate.get(dateKey) || 0;
      const muted = date.getMonth() !== anchor.getMonth() ? 'muted' : '';
      const hasItems = dayCount ? 'has-items' : '';
      const selected = selectedDate === dateKey ? 'selected' : '';
      return `
        <td class="group-calendar-day-cell">
          <button type="button" class="group-calendar-cell ${muted} ${hasItems} ${selected}" data-calendar-date="${escapeHtml(dateKey)}">
            <span class="group-calendar-day-number">${date.getDate()}</span>
            <span class="group-calendar-item-count">${escapeHtml(formatEventCountLabel(dayCount, behavior))}</span>
          </button>
        </td>
      `;
    }).join('');

    weekRows.push(`
      <tr class="group-calendar-week-row">
        ${cells}
      </tr>
    `);

    if (selectedWeekKey && weekKey === selectedWeekKey && selectedDate) {
      const selectedItemsResult = extractCalendarItemsForDate(group.slug, pages, selectedDate);
      const selectedItems = selectedItemsResult.normalizedItems;
      const editorState = state.groupCalendarEditorBySlug[group.slug] || { mode: null, itemId: null };
      weekRows.push(renderCalendarExpandedRow(group, pages, selectedDate, selectedItems, editorState));
    }
  }

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
      <p class="subtle-text">Click a date to inspect and edit events inline.</p>
      <div class="group-calendar-table-wrap">
        <table class="group-calendar-table">
          <thead>
            <tr>${weekdayHeaders}</tr>
          </thead>
          <tbody>
            ${weekRows.join('')}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderCalendarExpandedRow(group, pages, date, items, editorState) {
  const editingItem = editorState.mode === 'edit'
    ? items.find((item) => item.id === editorState.itemId)
    : null;
  const showForm = editorState.mode === 'add' || !!editingItem;
  const defaultPageSlug = editingItem?.pageSlug || pages[0]?.slug || '';

  const eventCards = items.map((item) => `
    <li class="calendar-event-card">
      <div class="calendar-event-content">
        <strong>${escapeHtml(item.title || 'Untitled')}</strong>
        <p class="subtle-text">${escapeHtml(item.startTime || 'No start time')}${item.endTime ? ` - ${escapeHtml(item.endTime)}` : ''}</p>
        <p class="subtle-text">${escapeHtml(item.location || 'No location')}</p>
        <p class="subtle-text">${escapeHtml(item.description ? `${item.description.slice(0, 140)}${item.description.length > 140 ? '…' : ''}` : 'No description')}</p>
      </div>
      <button type="button" class="secondary-action" data-calendar-edit-item="${escapeHtml(item.id)}">Edit</button>
    </li>
  `).join('');

  return `
    <tr class="group-calendar-expanded-row">
      <td colspan="7">
        <section class="calendar-expanded-panel">
          <div class="calendar-expanded-header">
            <div>
              <h4>${escapeHtml(formatDateOnly(date))}</h4>
              <p class="subtle-text">${escapeHtml(formatEventCountLabel(items.length))}</p>
            </div>
            <button type="button" data-calendar-add-event>Add Event</button>
          </div>

          <section class="calendar-expanded-subpanel">
            <h5>Events for this date</h5>
            ${items.length ? `<ul class="calendar-event-list">${eventCards}</ul>` : '<p class="subtle-text">No events scheduled for this date yet.</p>'}
          </section>

          ${showForm ? `
            <section class="calendar-expanded-subpanel">
              <h5>${editingItem ? 'Edit Event' : 'Add Event'}</h5>
              <form class="admin-form" data-calendar-inline-form>
                <label>Page
                  <select name="page_slug" required>
                    ${pages.map((page) => `<option value="${escapeHtml(page.slug)}" ${page.slug === defaultPageSlug ? 'selected' : ''}>${escapeHtml(page.event_name || page.slug)}</option>`).join('')}
                  </select>
                </label>
                <div class="admin-columns-2">
                  <label>Title<input type="text" name="title" value="${escapeHtml(editingItem?.title || '')}" required></label>
                  <label>Category/Type<input type="text" name="category" value="${escapeHtml(editingItem?.category || '')}"></label>
                </div>
                <div class="admin-columns-2">
                  <label>Start Time<input type="text" name="start_time" value="${escapeHtml(editingItem?.startTime || '')}" placeholder="6:00 PM"></label>
                  <label>End Time<input type="text" name="end_time" value="${escapeHtml(editingItem?.endTime || '')}" placeholder="8:00 PM"></label>
                </div>
                <label>Location<input type="text" name="location" value="${escapeHtml(editingItem?.location || '')}"></label>
                <label>Description<textarea name="description" rows="3">${escapeHtml(editingItem?.description || '')}</textarea></label>
                <input type="hidden" name="date" value="${escapeHtml(date)}">
                <input type="hidden" name="edit_item_id" value="${escapeHtml(editingItem?.id || '')}">
                <p class="error-text" data-calendar-form-message></p>
                <div class="button-row">
                  <button type="submit">Save</button>
                  <button type="button" class="secondary-action" data-calendar-cancel-form>Cancel</button>
                </div>
              </form>
            </section>
          ` : ''}
        </section>
      </td>
    </tr>
  `;
}

function renderGroupSubviewScaffold(group, viewKey) {
  return `
    <section class="admin-card">
      <h3>${escapeHtml(GROUP_SUBVIEW_LABELS[viewKey] || toTitleCase(viewKey))}</h3>
      <p class="subtle-text">
        This subview is enabled for <strong>${escapeHtml(group.slug)}</strong> but does not yet have editor controls.
      </p>
      <p class="subtle-text">Use the Admin tab to enable or disable subviews per group.</p>
    </section>
  `;
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

async function saveCalendarDateItem(event, group) {
  event.preventDefault();
  const form = event.currentTarget;
  const pages = state.groupPagesBySlug[group.slug] || [];
  const formData = Object.fromEntries(new FormData(form).entries());
  const targetPageSlug = String(formData.page_slug || '');
  const targetPage = pages.find((page) => page.slug === targetPageSlug);
  if (!targetPage) return;

  const editItemId = String(formData.edit_item_id || '').trim() || null;
  const sourceItem = editItemId
    ? mapExistingPageDataToCalendarItems(group.slug, pages).find((item) => item.id === editItemId)
    : null;

  const dates = Array.isArray(targetPage.dates) ? [...targetPage.dates] : [];
  const nextEntry = buildEditableDateEntry(formData);
  if (sourceItem && sourceItem.pageSlug === targetPage.slug && Number.isInteger(sourceItem.entryIndex)) {
    dates[sourceItem.entryIndex] = nextEntry;
  } else {
    dates.push(nextEntry);
  }

  const messageEl = form.querySelector('[data-calendar-form-message]');
  const { error } = await supabaseClient
    .from('event_pages')
    .update({ dates })
    .eq('group_slug', group.slug)
    .eq('slug', targetPage.slug);
  if (error) {
    if (messageEl) messageEl.textContent = `Failed to save event: ${error.message || 'Unknown error'}`;
    return;
  }

  let nextPages = pages.map((page) => (page.slug === targetPage.slug ? { ...page, dates } : page));
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
      messageEl.textContent = `Saved target page, but failed to remove old event: ${sourceUpdate.error.message || 'Unknown error'}`;
      return;
    }
  }

  state.groupPagesBySlug[group.slug] = nextPages;
  state.groupCalendarEditorBySlug[group.slug] = { mode: null, itemId: null };
  renderGroupPanel(`group:${group.slug}`);
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
  hydrateGroupSubviewConfig(state.groups);

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
