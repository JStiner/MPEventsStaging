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

const PAGE_CALENDAR_MODES = {
  'community-events': 'full',
  'high-school-events': 'full',
  'town-services': 'full',
  'christmas-on-vinegar-hill': 'single',
  'fall-fest': 'multi-day',
  'second-fridays': 'monthly',
};

const state = {
  user: null,
  profile: null,
  groups: [],
  memberships: [],
  tabs: [],
  activeTab: null,
  auditRows: [],
  importRuns: [],
  groupData: {},
  selectedGroupViewBySlug: {},
  selectedPageByGroup: {},
  selectedDayByGroup: {},
  selectedCalendarDateByPage: {},
  selectedCalendarMonthByPage: {},
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

function displayValue(value, fallback = '-') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function displaySoon(value, fallback = 'Coming soon') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function normalizeTownGroup(value) {
  return String(value || '').trim() || 'Other';
}

function sortLocationsForAdmin(rows) {
  return rows.slice().sort((a, b) => {
    const aGroup = normalizeTownGroup(a?.location_group);
    const bGroup = normalizeTownGroup(b?.location_group);
    if (aGroup !== bGroup) return aGroup.localeCompare(bGroup);
    const aSort = Number.isFinite(Number(a?.web_sort_order)) ? Number(a.web_sort_order)
      : Number.isFinite(Number(a?.sort_order)) ? Number(a.sort_order)
      : null;
    const bSort = Number.isFinite(Number(b?.web_sort_order)) ? Number(b.web_sort_order)
      : Number.isFinite(Number(b?.sort_order)) ? Number(b.sort_order)
      : null;
    if (aSort !== null && bSort !== null && aSort !== bSort) return aSort - bSort;
    if (aSort !== null && bSort === null) return -1;
    if (aSort === null && bSort !== null) return 1;
    return String(a?.name || '').localeCompare(String(b?.name || ''));
  });
}

function getLocationForVendor(data, pageSlug, vendorRow) {
  if (!vendorRow) return null;
  const candidates = (data.locations || []).filter((row) => row.page_slug === pageSlug);
  return candidates.find((row) =>
    (vendorRow.event_location_id && row.id === vendorRow.event_location_id)
    || (vendorRow.location_external_id && row.external_id === vendorRow.location_external_id)
  ) || null;
}

function buildDirectionsUrl(locationRow) {
  const explicit = String(locationRow?.directions_url || '').trim();
  if (explicit) return explicit;
  const address = String(locationRow?.address || '').trim();
  if (!address) return '';
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

function getPublicPageHref(page) {
  const slug = String(page?.slug || '').trim();
  return slug ? `./${slug}.html` : './index.html';
}

function openAdminModal(title, bodyHtml) {
  const modal = ensureModalShell();
  if (!modal) return null;
  modal.innerHTML = `
    <div class="admin-modal-backdrop" data-modal-close></div>
    <div class="admin-modal-card admin-modal-card-wide">
      <div class="admin-modal-header">
        <h3>${escapeHtml(title)}</h3>
        <button type="button" class="admin-modal-close" data-modal-close>Close</button>
      </div>
      <div class="admin-modal-body">${bodyHtml}</div>
    </div>
  `;
  modal.classList.remove('hidden');
  modal.querySelectorAll('[data-modal-close]').forEach((el) => el.addEventListener('click', closeEventEditorModal));
  return modal;
}

async function openLocationEditorModal(groupSlug, tabKey, page, data, record = null) {
  const bodyHtml = `
    <form class="admin-form" data-form="location-modal">
      <input type="hidden" name="external_id" value="${escapeHtml(record?.external_id || '')}">
      <div class="admin-columns-2">
        <label>Name<input name="name" value="${escapeHtml(record?.name || '')}" required></label>
        <label>Location Number<input name="location_number" value="${escapeHtml(record?.location_number || '')}" placeholder="12"></label>
      </div>
      <div class="admin-columns-2">
        <label>Address<input name="address" value="${escapeHtml(record?.address || '')}"></label>
        <label>Town / Group<input name="location_group" value="${escapeHtml(record?.location_group || '')}" placeholder="Mt. Pulaski"></label>
      </div>
      <div class="admin-columns-3">
        <label>Web Sort<input type="number" name="web_sort_order" value="${escapeHtml(String(record?.web_sort_order ?? record?.sort_order ?? ''))}"></label>
        <label>Flyer Sort<input type="number" name="flyer_sort_order" value="${escapeHtml(String(record?.flyer_sort_order ?? record?.sort_order ?? ''))}"></label>
        <label>Legacy Sort<input type="number" name="sort_order" value="${escapeHtml(String(record?.sort_order ?? ''))}"></label>
      </div>
      <div class="admin-columns-3">
        <label>Map X<input type="number" step="0.1" name="map_x" value="${escapeHtml(String(record?.map_x ?? ''))}"></label>
        <label>Map Y<input type="number" step="0.1" name="map_y" value="${escapeHtml(String(record?.map_y ?? ''))}"></label>
        <label>Pin Icon<input name="pin_icon" value="${escapeHtml(record?.pin_icon || '')}"></label>
      </div>
      <div class="admin-columns-2">
        <label>Hours<input name="hours" value="${escapeHtml(record?.hours || '')}"></label>
        <label>Tags (comma)<input name="tags" value="${escapeHtml((record?.tags || []).join(', '))}" placeholder="Multi Vendor, Food"></label>
      </div>
      <label>Description<textarea rows="2" name="description">${escapeHtml(record?.description || '')}</textarea></label>
      <label>Notes<textarea rows="2" name="notes">${escapeHtml(record?.notes || '')}</textarea></label>
      <div class="admin-columns-2">
        <label>Directions Text<textarea rows="2" name="directions_text">${escapeHtml(record?.directions_text || '')}</textarea></label>
        <label>Directions URL<input name="directions_url" value="${escapeHtml(record?.directions_url || '')}" placeholder="https://..."></label>
      </div>
      <div class="admin-checkbox-grid">
        <label><input type="checkbox" name="multi_vendor" ${record?.multi_vendor ? 'checked' : ''}> Multi-vendor location</label>
        <label><input type="checkbox" name="is_bag_location" ${record?.is_bag_location ? 'checked' : ''}> Bag location</label>
        <label><input type="checkbox" name="show_on_flyer" ${record?.show_on_flyer === false ? '' : 'checked'}> Show on flyer</label>
        <label><input type="checkbox" name="is_active" ${record?.is_active === false ? '' : 'checked'}> Active</label>
      </div>
      <label>Raw JSON<textarea rows="3" name="raw">${escapeHtml(JSON.stringify(record?.raw || {}, null, 2))}</textarea></label>
      <p class="error-text" data-message="location-modal"></p>
      <div class="button-row">
        <button type="submit">Save Location</button>
        ${record ? '<button type="button" class="danger" data-delete-location-modal>Delete</button>' : ''}
      </div>
    </form>
  `;
  const modal = openAdminModal(record ? 'Edit Location' : 'Add Location', bodyHtml);
  const form = modal?.querySelector('[data-form="location-modal"]');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const formData = new FormData(event.currentTarget);
      const payload = {
        page_slug: page.slug,
        external_id: String(formData.get('external_id') || '').trim() || getId(),
        name: String(formData.get('name') || '').trim(),
        location_number: String(formData.get('location_number') || '').trim() || null,
        address: String(formData.get('address') || '').trim() || null,
        map_x: formData.get('map_x') ? Number(formData.get('map_x')) : null,
        map_y: formData.get('map_y') ? Number(formData.get('map_y')) : null,
        description: String(formData.get('description') || '').trim() || null,
        notes: String(formData.get('notes') || '').trim() || null,
        directions_text: String(formData.get('directions_text') || '').trim() || null,
        directions_url: String(formData.get('directions_url') || '').trim() || null,
        pin_icon: String(formData.get('pin_icon') || '').trim() || null,
        hours: String(formData.get('hours') || '').trim() || null,
        tags: String(formData.get('tags') || '').split(',').map((item) => item.trim()).filter(Boolean),
        multi_vendor: formData.get('multi_vendor') === 'on',
        is_bag_location: formData.get('is_bag_location') === 'on',
        show_on_flyer: formData.get('show_on_flyer') === 'on',
        is_active: formData.get('is_active') === 'on',
        location_group: String(formData.get('location_group') || '').trim() || null,
        sort_order: formData.get('sort_order') ? Number(formData.get('sort_order')) : null,
        web_sort_order: formData.get('web_sort_order') ? Number(formData.get('web_sort_order')) : null,
        flyer_sort_order: formData.get('flyer_sort_order') ? Number(formData.get('flyer_sort_order')) : null,
        raw: parseJsonField(formData.get('raw'), {}),
      };
      const { error } = await supabaseClient.from('event_locations').upsert(payload, { onConflict: 'page_slug,external_id' });
      if (error) throw error;
      closeEventEditorModal();
      await refreshGroup(groupSlug, tabKey);
    } catch (error) {
      const msg = modal.querySelector('[data-message="location-modal"]');
      if (msg) msg.textContent = error.message || 'Failed to save location.';
    }
  });
  modal?.querySelector('[data-delete-location-modal]')?.addEventListener('click', async () => {
    if (!record?.external_id) return;
    const { error } = await supabaseClient.from('event_locations').delete().eq('page_slug', page.slug).eq('external_id', record.external_id);
    if (error) {
      const msg = modal.querySelector('[data-message="location-modal"]');
      if (msg) msg.textContent = error.message || 'Failed to delete location.';
      return;
    }
    closeEventEditorModal();
    await refreshGroup(groupSlug, tabKey);
  });
}

async function openVendorEditorModal(groupSlug, tabKey, page, data, record = null) {
  const locationOptions = sortLocationsForAdmin(data.locations.filter((row) => row.page_slug === page.slug))
    .map((loc) => `<option value="${escapeHtml(loc.external_id)}">${escapeHtml(loc.location_group || 'Other')} · ${escapeHtml(loc.name || loc.external_id)}</option>`).join('');
  const bodyHtml = `
    <form class="admin-form" data-form="vendor-modal">
      <input type="hidden" name="external_id" value="${escapeHtml(record?.external_id || '')}">
      <div class="admin-columns-2">
        <label>Vendor Name<input name="name" value="${escapeHtml(record?.name || '')}" required></label>
        <label>Category<input name="category" value="${escapeHtml(record?.category || '')}" placeholder="Vendor, Food, Multi Vendor"></label>
      </div>
      <div class="admin-columns-3">
        <label>Location<input name="location_external_id" list="location-id-list-modal" value="${escapeHtml(record?.location_external_id || '')}" required></label>
        <label>Booth<input name="booth" value="${escapeHtml(record?.booth || '')}"></label>
        <label>Sort Order<input type="number" name="sort_order" value="${escapeHtml(String(record?.sort_order ?? ''))}"></label>
      </div>
      <div class="admin-columns-2">
        <label>Hours<input name="hours" value="${escapeHtml(record?.hours || '')}"></label>
        <label>Vendor Address<input name="vendor_address" value="${escapeHtml(record?.vendor_address || '')}" placeholder="Shown publicly"></label>
      </div>
      <label>Description<textarea rows="2" name="description">${escapeHtml(record?.description || '')}</textarea></label>
      <label>Product List<textarea rows="2" name="product_list">${escapeHtml(record?.product_list || '')}</textarea></label>
      <div class="admin-columns-3">
        <label>Public Phone<input name="public_phone" value="${escapeHtml(record?.public_phone || '')}" placeholder="-"></label>
        <label>Public Email<input name="public_email" value="${escapeHtml(record?.public_email || '')}" placeholder="-"></label>
        <label>Public Website<input name="public_website" value="${escapeHtml(record?.public_website || '')}" placeholder="https://..."></label>
      </div>
      <div class="admin-columns-3">
        <label>Internal Contact<input name="internal_contact_name" value="${escapeHtml(record?.internal_contact_name || '')}"></label>
        <label>Internal Phone<input name="internal_phone" value="${escapeHtml(record?.internal_phone || '')}"></label>
        <label>Internal Email<input name="internal_email" value="${escapeHtml(record?.internal_email || '')}"></label>
      </div>
      <label>Internal Notes<textarea rows="2" name="internal_notes">${escapeHtml(record?.internal_notes || '')}</textarea></label>
      <label><input type="checkbox" name="is_active" ${record?.is_active === false ? '' : 'checked'}> Active</label>
      <label>Raw JSON<textarea rows="3" name="raw">${escapeHtml(JSON.stringify(record?.raw || {}, null, 2))}</textarea></label>
      <p class="error-text" data-message="vendor-modal"></p>
      <div class="button-row">
        <button type="submit">Save Vendor</button>
        ${record ? '<button type="button" class="danger" data-delete-vendor-modal>Delete</button>' : ''}
      </div>
      <datalist id="location-id-list-modal">${locationOptions}</datalist>
    </form>
  `;
  const modal = openAdminModal(record ? 'Edit Vendor' : 'Add Vendor', bodyHtml);
  const form = modal?.querySelector('[data-form="vendor-modal"]');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const formData = new FormData(event.currentTarget);
      const locationExternalId = String(formData.get('location_external_id') || '').trim() || null;
      const matchedLocation = data.locations.find((row) => row.page_slug === page.slug && row.external_id === locationExternalId);
      const payload = {
        page_slug: page.slug,
        external_id: String(formData.get('external_id') || '').trim() || getId(),
        name: String(formData.get('name') || '').trim(),
        location_external_id: locationExternalId,
        event_location_id: matchedLocation?.id || null,
        category: String(formData.get('category') || '').trim() || null,
        description: String(formData.get('description') || '').trim() || null,
        booth: String(formData.get('booth') || '').trim() || null,
        hours: String(formData.get('hours') || '').trim() || null,
        vendor_address: String(formData.get('vendor_address') || '').trim() || null,
        public_phone: String(formData.get('public_phone') || '').trim() || null,
        public_email: String(formData.get('public_email') || '').trim() || null,
        public_website: String(formData.get('public_website') || '').trim() || null,
        product_list: String(formData.get('product_list') || '').trim() || null,
        internal_contact_name: String(formData.get('internal_contact_name') || '').trim() || null,
        internal_phone: String(formData.get('internal_phone') || '').trim() || null,
        internal_email: String(formData.get('internal_email') || '').trim() || null,
        internal_notes: String(formData.get('internal_notes') || '').trim() || null,
        is_active: formData.get('is_active') === 'on',
        sort_order: formData.get('sort_order') ? Number(formData.get('sort_order')) : 0,
        raw: parseJsonField(formData.get('raw'), {}),
      };
      const { error } = await supabaseClient.from('event_vendors').upsert(payload, { onConflict: 'page_slug,external_id' });
      if (error) throw error;
      closeEventEditorModal();
      await refreshGroup(groupSlug, tabKey);
    } catch (error) {
      const msg = modal.querySelector('[data-message="vendor-modal"]');
      if (msg) msg.textContent = error.message || 'Failed to save vendor.';
    }
  });
  modal?.querySelector('[data-delete-vendor-modal]')?.addEventListener('click', async () => {
    if (!record?.external_id) return;
    const { error } = await supabaseClient.from('event_vendors').delete().eq('page_slug', page.slug).eq('external_id', record.external_id);
    if (error) {
      const msg = modal.querySelector('[data-message="vendor-modal"]');
      if (msg) msg.textContent = error.message || 'Failed to delete vendor.';
      return;
    }
    closeEventEditorModal();
    await refreshGroup(groupSlug, tabKey);
  });
}

function getPageCalendarMode(pageSlug) {
  return PAGE_CALENDAR_MODES[pageSlug] || 'full';
}

function formatIsoDateLocal(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDayLabel(date) {
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function getPageStateKey(groupSlug, pageSlug) {
  return `${groupSlug}::${pageSlug}`;
}

function getSelectedCalendarDate(groupSlug, pageSlug, fallbackDate) {
  const key = getPageStateKey(groupSlug, pageSlug);
  if (!state.selectedCalendarDateByPage[key]) state.selectedCalendarDateByPage[key] = fallbackDate;
  return state.selectedCalendarDateByPage[key];
}

function setSelectedCalendarDate(groupSlug, pageSlug, value) {
  state.selectedCalendarDateByPage[getPageStateKey(groupSlug, pageSlug)] = value;
}

function getSelectedCalendarMonth(groupSlug, pageSlug, fallbackMonth) {
  const key = getPageStateKey(groupSlug, pageSlug);
  if (!state.selectedCalendarMonthByPage[key]) state.selectedCalendarMonthByPage[key] = fallbackMonth;
  return state.selectedCalendarMonthByPage[key];
}

function setSelectedCalendarMonth(groupSlug, pageSlug, value) {
  state.selectedCalendarMonthByPage[getPageStateKey(groupSlug, pageSlug)] = value;
}

function eventsForDate(scheduleRows, dateStr) {
  return sortByDate(scheduleRows.filter((row) => row.event_date === dateStr && (row.is_active == null || row.is_active === true)));
}

function getOrCreateDayRecord(data, pageSlug, dateStr) {
  return (data.days || []).find((day) => day.page_slug === pageSlug && day.event_date === dateStr) || null;
}

function buildCalendarDetailRows(scheduleRows) {
  return scheduleRows.map((row) => `
    <div class="admin-calendar-event-row">
      <button type="button" class="admin-calendar-edit" data-calendar-edit-schedule="${escapeHtml(row.external_id)}">Edit</button>
      <div class="admin-calendar-event-main">
        <div class="admin-calendar-event-time">${escapeHtml([row.start_time, row.end_time].filter(Boolean).join(' - ') || 'All day')}</div>
        <div class="admin-calendar-event-title">${escapeHtml(row.title || 'Untitled event')}</div>
        ${row.location_external_id ? `<div class="subtle-text">Location: ${escapeHtml(row.location_external_id)}</div>` : ''}
      </div>
    </div>
  `).join('');
}

function renderCalendarDetailCard(groupSlug, data, page, dateStr, headingLabel) {
  const rows = eventsForDate(data.schedule.filter((row) => row.page_slug === page.slug), dateStr);
  return `
    <section class="admin-card admin-calendar-detail-card">
      <div class="admin-calendar-detail-header">
        <div>
          <h3>${escapeHtml(headingLabel)}</h3>
          <p class="subtle-text">${escapeHtml(dateStr)}</p>
        </div>
        <button type="button" data-calendar-add-event="${escapeHtml(dateStr)}">Add Event</button>
      </div>
      <div class="admin-calendar-event-list">
        ${rows.length ? buildCalendarDetailRows(rows) : '<p class="subtle-text">No events for this selection yet.</p>'}
      </div>
      <p class="error-text" data-message="calendar"></p>
    </section>
  `;
}

function ensureModalShell() {
  const modal = document.getElementById('eventEditorModal');
  return modal;
}

function closeEventEditorModal() {
  const modal = ensureModalShell();
  if (modal) modal.classList.add('hidden');
}

function openEventEditorModal(groupSlug, tabKey, page, data, dateStr, record = null) {
  const modal = ensureModalShell();
  if (!modal) return;
  const locations = sortByOrderThenName(data.locations.filter((row) => row.page_slug === page.slug));
  const selectedDay = getOrCreateDayRecord(data, page.slug, dateStr);
  const title = record ? 'Edit Event' : 'Add Event';
  modal.innerHTML = `
    <div class="admin-modal-backdrop" data-modal-close></div>
    <div class="admin-modal-card">
      <div class="admin-modal-header">
        <h3>${escapeHtml(title)}</h3>
        <button type="button" class="admin-modal-close" data-modal-close>Close</button>
      </div>
      <form class="admin-form" data-form="calendar-event-modal">
        <input type="hidden" name="external_id" value="${escapeHtml(record?.external_id || '')}">
        <input type="hidden" name="event_date" value="${escapeHtml(record?.event_date || dateStr)}">
        <input type="hidden" name="day_external_id" value="${escapeHtml(record?.day_external_id || selectedDay?.external_id || '')}">
        <div class="admin-columns-2">
          <label>Title<input name="title" value="${escapeHtml(record?.title || '')}" required></label>
          <label>Category<input name="category" value="${escapeHtml(record?.category || '')}"></label>
        </div>
        <div class="admin-columns-3">
          <label>Date<input type="date" name="event_date_display" value="${escapeHtml(record?.event_date || dateStr)}" required></label>
          <label>Start Time<input name="start_time" value="${escapeHtml(record?.start_time || '')}" placeholder="6:00 PM"></label>
          <label>End Time<input name="end_time" value="${escapeHtml(record?.end_time || '')}" placeholder="8:00 PM"></label>
        </div>
        <div class="admin-columns-2">
          <label>Location
            <select name="location_external_id">
              <option value="">—</option>
              ${locations.map((loc) => `<option value="${escapeHtml(loc.external_id)}" ${loc.external_id === record?.location_external_id ? 'selected' : ''}>${escapeHtml(loc.name || loc.external_id)}</option>`).join('')}
            </select>
          </label>
          <label>Sort Order<input type="number" name="sort_order" value="${escapeHtml(String(record?.sort_order ?? ''))}"></label>
        </div>
        <label>Description<textarea rows="4" name="description">${escapeHtml(record?.description || '')}</textarea></label>
        <label>Vendor IDs (comma separated)<input name="vendor_ids" value="${escapeHtml((record?.vendor_ids || []).join(', '))}"></label>
        <label>Raw JSON<textarea rows="4" name="raw">${escapeHtml(JSON.stringify(record?.raw || {}, null, 2))}</textarea></label>
        <p class="error-text" data-message="modal"></p>
        <div class="button-row">
          <button type="submit">Save Event</button>
          ${record ? '<button type="button" class="danger" data-calendar-delete-modal>Delete Event</button>' : ''}
        </div>
      </form>
    </div>
  `;
  modal.classList.remove('hidden');

  modal.querySelectorAll('[data-modal-close]').forEach((el) => el.addEventListener('click', closeEventEditorModal));

  const formEl = modal.querySelector('[data-form="calendar-event-modal"]');
  formEl?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const eventDate = String(form.get('event_date_display') || '').trim();
      if (!eventDate) throw new Error('Event date is required.');

      let dayRecord = getOrCreateDayRecord(currentGroupData(groupSlug), page.slug, eventDate);
      if (!dayRecord) {
        const newDay = {
          page_slug: page.slug,
          external_id: getId(),
          label: formatDayLabel(new Date(`${eventDate}T12:00:00`)),
          event_date: eventDate,
          sort_order: 0,
          raw: {},
        };
        const { error: dayError } = await supabaseClient.from('event_days').upsert(newDay, { onConflict: 'page_slug,external_id' });
        if (dayError) throw dayError;
        dayRecord = newDay;
      }

      const payload = {
        page_slug: page.slug,
        external_id: String(form.get('external_id') || '').trim() || getId(),
        day_external_id: dayRecord.external_id,
        title: String(form.get('title') || '').trim(),
        start_time: String(form.get('start_time') || '').trim() || null,
        end_time: String(form.get('end_time') || '').trim() || null,
        location_external_id: String(form.get('location_external_id') || '').trim() || null,
        category: String(form.get('category') || '').trim() || null,
        description: String(form.get('description') || '').trim() || null,
        vendor_ids: String(form.get('vendor_ids') || '').split(',').map((item) => item.trim()).filter(Boolean),
        event_date: eventDate,
        sort_order: form.get('sort_order') ? Number(form.get('sort_order')) : null,
        raw: parseJsonField(form.get('raw'), {}),
        is_imported: false,
        is_active: true,
      };

      const { error } = await supabaseClient.from('event_schedule').upsert(payload, { onConflict: 'page_slug,external_id' });
      if (error) throw error;
      setSelectedCalendarDate(groupSlug, page.slug, eventDate);
      closeEventEditorModal();
      await refreshGroup(groupSlug, tabKey);
    } catch (error) {
      const msg = modal.querySelector('[data-message="modal"]');
      if (msg) msg.textContent = error.message || 'Failed to save event.';
    }
  });

  modal.querySelector('[data-calendar-delete-modal]')?.addEventListener('click', async () => {
    if (!record?.external_id) return;
    const { error } = await supabaseClient.from('event_schedule').delete().eq('page_slug', page.slug).eq('external_id', record.external_id);
    if (error) {
      const msg = modal.querySelector('[data-message="modal"]');
      if (msg) msg.textContent = error.message || 'Failed to delete event.';
      return;
    }
    closeEventEditorModal();
    await refreshGroup(groupSlug, tabKey);
  });
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

async function fetchImportRuns() {
  const { data, error } = await supabaseClient
    .from('v_event_import_runs')
    .select('id, source_key, page_slug, source_name, status, started_at, finished_at, items_found, items_inserted, items_updated, items_deleted, error_message')
    .order('started_at', { ascending: false })
    .limit(20);

  if (error) throw error;
  return data || [];
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
    supabaseClient.from('event_schedule').select('*').in('page_slug', pageSlugs).or('is_active.is.null,is_active.eq.true'),
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
  const importRows = (state.importRuns || []).map((row) => `
    <tr>
      <td>${escapeHtml(row.source_key || '')}</td>
      <td>${escapeHtml(row.page_slug || '—')}</td>
      <td>${escapeHtml(row.status || '—')}</td>
      <td>${escapeHtml(formatDate(row.started_at))}</td>
      <td>${escapeHtml(String(row.items_found ?? 0))}</td>
      <td>${escapeHtml(String((Number(row.items_inserted ?? 0) + Number(row.items_updated ?? 0))))}</td>
      <td>${escapeHtml(row.error_message || '')}</td>
    </tr>
  `).join('');

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
    <section class="admin-card">
      <h3>External Event Imports</h3>
      <div class="button-row">
        <button type="button" data-run-import="city">Import City Events</button>
        <button type="button" data-run-import="school">Import School Events</button>
        <button type="button" data-run-import="all">Import All</button>
      </div>
      <p class="error-text" data-message="imports"></p>
      <div class="table-wrap">
        <table class="admin-table">
          <thead><tr><th>source</th><th>page</th><th>status</th><th>started</th><th>staged</th><th>published</th><th>error</th></tr></thead>
          <tbody>${importRows || '<tr><td colspan="7">No import runs yet.</td></tr>'}</tbody>
        </table>
      </div>
    </section>
  `;

  panel.querySelector('#signOutButton')?.addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
    window.location.href = './login.html';
  });

  panel.querySelectorAll('[data-run-import]').forEach((button) => button.addEventListener('click', async () => {
    const target = button.dataset.runImport;
    const sourceKey = target === 'all' ? null : target;
    setMessage(panel, 'imports', `Running ${target} import…`);

    const { data, error } = await supabaseClient.functions.invoke('import-events', {
      body: sourceKey ? { source_key: sourceKey, auto_publish: true, requested_by: 'admin-ui' } : { auto_publish: true, requested_by: 'admin-ui' },
    });

    if (error) {
      setMessage(panel, 'imports', error.message || 'Import failed.');
      return;
    }

    if (!data?.ok) {
      setMessage(panel, 'imports', data?.error || 'Import failed.');
      return;
    }

    state.importRuns = await fetchImportRuns().catch(() => state.importRuns || []);
    setMessage(panel, 'imports', `Import complete for ${target}.`);
    renderAdminPanel();
  }));
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
  const mode = getPageCalendarMode(page.slug);
  const pageDays = sortByDate(data.days.filter((d) => d.page_slug === page.slug));
  const pageSchedule = data.schedule.filter((row) => row.page_slug === page.slug && (row.is_active == null || row.is_active === true));
  const allDateStrings = Array.from(new Set([
    ...pageDays.map((day) => day.event_date).filter(Boolean),
    ...pageSchedule.map((row) => row.event_date).filter(Boolean),
  ])).sort();
  const defaultDate = allDateStrings[0] || formatIsoDateLocal(new Date());
  const selectedDate = getSelectedCalendarDate(groupSlug, page.slug, defaultDate);

  if (mode === 'single' || mode === 'multi-day' || mode === 'monthly') {
    let selectorLabel = 'Event Day';
    let optionDates = allDateStrings;

    if (mode === 'monthly') {
      selectorLabel = 'Event Month';
      const months = Array.from(new Set(allDateStrings.map((dateStr) => dateStr.slice(0, 7)))).sort();
      const selectedMonth = getSelectedCalendarMonth(groupSlug, page.slug, months[0] || formatIsoDateLocal(new Date()).slice(0, 7));
      optionDates = allDateStrings.filter((dateStr) => dateStr.startsWith(selectedMonth));
    }

    const activeDate = optionDates.includes(selectedDate) ? selectedDate : (optionDates[0] || defaultDate);
    setSelectedCalendarDate(groupSlug, page.slug, activeDate);

    const selectorOptions = optionDates.map((dateStr) => {
      const date = new Date(`${dateStr}T12:00:00`);
      return `<button type="button" class="admin-chip ${dateStr === activeDate ? 'active' : ''}" data-calendar-select-date="${escapeHtml(dateStr)}">${escapeHtml(formatDayLabel(date))}</button>`;
    }).join('');

    const monthChips = mode === 'monthly'
      ? `<div class="admin-chip-row">${Array.from(new Set(allDateStrings.map((dateStr) => dateStr.slice(0, 7)))).sort().map((month) => `<button type="button" class="admin-chip ${month === getSelectedCalendarMonth(groupSlug, page.slug, month) ? 'active' : ''}" data-calendar-select-month="${escapeHtml(month)}">${escapeHtml(month)}</button>`).join('')}</div>`
      : '';

    return `
      <section class="admin-card">
        <h3>Calendar</h3>
        <p class="subtle-text">${selectorLabel} view for ${escapeHtml(page.event_name || page.slug)}.</p>
        ${monthChips}
        <div class="admin-chip-row">${selectorOptions || '<span class="subtle-text">No event days yet.</span>'}</div>
      </section>
      ${renderCalendarDetailCard(groupSlug, data, page, activeDate, formatDayLabel(new Date(`${activeDate}T12:00:00`)))}
    `;
  }

  const baseDate = new Date(`${selectedDate}T12:00:00`);
  const selectedMonth = getSelectedCalendarMonth(groupSlug, page.slug, `${baseDate.getFullYear()}-${String(baseDate.getMonth() + 1).padStart(2, '0')}`);
  const [year, month] = selectedMonth.split('-').map(Number);
  const monthStart = new Date(year || baseDate.getFullYear(), (month || (baseDate.getMonth() + 1)) - 1, 1);
  const gridStart = new Date(monthStart);
  gridStart.setDate(monthStart.getDate() - monthStart.getDay());
  const monthLabel = monthStart.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const cells = [];
  for (let i = 0; i < 42; i += 1) {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + i);
    const dateStr = formatIsoDateLocal(date);
    const isCurrentMonth = date.getMonth() === monthStart.getMonth();
    const dayCount = eventsForDate(pageSchedule, dateStr).length;
    const hasDay = pageDays.some((day) => day.event_date === dateStr);
    cells.push(`
      <button type="button" class="admin-calendar-cell ${isCurrentMonth ? '' : 'muted'} ${dateStr === selectedDate ? 'active' : ''}" data-calendar-select-date="${escapeHtml(dateStr)}">
        <span class="admin-calendar-cell-num">${date.getDate()}</span>
        <span class="admin-calendar-cell-meta">${dayCount ? `${dayCount} event${dayCount === 1 ? '' : 's'}` : (hasDay ? 'Day' : '')}</span>
      </button>
    `);
  }

  return `
    <section class="admin-card">
      <div class="admin-calendar-header">
        <button type="button" data-calendar-shift-month="-1">Previous</button>
        <h3>${escapeHtml(monthLabel)}</h3>
        <button type="button" data-calendar-shift-month="1">Next</button>
      </div>
      <div class="admin-calendar-weekdays">
        <span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span>
      </div>
      <div class="admin-calendar-grid">${cells.join('')}</div>
    </section>
    ${renderCalendarDetailCard(groupSlug, data, page, selectedDate, formatDayLabel(new Date(`${selectedDate}T12:00:00`)))}
  `;
}

function renderLocationsView(data, page) {
  const rows = sortLocationsForAdmin(data.locations.filter((r) => r.page_slug === page.slug));
  const grouped = rows.reduce((acc, row) => {
    const group = normalizeTownGroup(row.location_group);
    if (!acc[group]) acc[group] = [];
    acc[group].push(row);
    return acc;
  }, {});

  const groupsMarkup = Object.entries(grouped).map(([groupName, groupRows]) => {
    const locationItems = groupRows.map((row) => {
      const vendorCount = data.vendors.filter((vendor) => vendor.page_slug === page.slug && (vendor.event_location_id === row.id || vendor.location_external_id === row.external_id)).length;
      const tags = Array.isArray(row.tags) && row.tags.length ? row.tags.map((tag) => `<span class="admin-badge">${escapeHtml(tag)}</span>`).join('') : '<span class="admin-badge admin-badge-muted">No badges yet</span>';
      const bagBadge = row.is_bag_location ? '<span class="admin-badge admin-badge-highlight">Bag Location</span>' : '';
      const mvText = row.multi_vendor ? (vendorCount ? `${vendorCount} vendor${vendorCount === 1 ? '' : 's'}` : 'Vendor list coming soon') : 'Single location';
      return `
        <article class="admin-vendor-row admin-location-row">
          <div class="admin-entity-card__top">
            <div>
              <h5>${escapeHtml(displayValue(row.name))}</h5>
              <p class="subtle-text">${escapeHtml(displayValue(row.location_number))} · ${escapeHtml(displayValue(row.external_id))}</p>
            </div>
            <div class="button-row">
              <button type="button" data-edit-location="${escapeHtml(row.external_id)}">Edit</button>
              <button class="danger" type="button" data-delete-location="${escapeHtml(row.external_id)}">Delete</button>
            </div>
          </div>
          <div class="admin-badge-row">${tags}${bagBadge}</div>
          <dl class="admin-kv-grid compact">
            <div><dt>Address</dt><dd>${escapeHtml(displayValue(row.address))}</dd></div>
            <div><dt>Description</dt><dd>${escapeHtml(displaySoon(row.description, 'Description coming soon'))}</dd></div>
            <div><dt>Hours</dt><dd>${escapeHtml(displayValue(row.hours))}</dd></div>
            <div><dt>Directions</dt><dd>${escapeHtml(displayValue(row.directions_text))}</dd></div>
            <div><dt>Vendor Status</dt><dd>${escapeHtml(mvText)}</dd></div>
            <div><dt>Flyer</dt><dd>${row.show_on_flyer === false ? 'Hidden' : 'Included'}</dd></div>
          </dl>
        </article>
      `;
    }).join('');

    return `
      <section class="admin-group-block">
        <div class="admin-group-block__header">
          <div>
            <h4>${escapeHtml(groupName)}</h4>
            <p class="subtle-text">${groupRows.length} location${groupRows.length === 1 ? '' : 's'}</p>
          </div>
          <button type="button" data-location-new data-default-group="${escapeHtml(groupName)}">Add Location</button>
        </div>
        ${locationItems}
      </section>
    `;
  }).join('');

  const empty = `
    <section class="admin-empty-state">
      <h4>No locations yet</h4>
      <p class="subtle-text">Add the first event location to start building the public list and flyer sections.</p>
      <div class="button-row"><button type="button" data-location-new>Add Location</button></div>
    </section>
  `;

  return `
    <section class="admin-card">
      <div class="admin-section-header">
        <div>
          <h3>Locations</h3>
          <p class="subtle-text">Locations drive the CoVH flyer, grouped public listing, map references, and multi-vendor routing.</p>
        </div>
        <button type="button" data-location-new>Add Location</button>
      </div>
      ${groupsMarkup || empty}
      <p class="error-text" data-message="location"></p>
    </section>
  `;
}

function renderVendorsView(data, page) {
  const locations = sortLocationsForAdmin(data.locations.filter((r) => r.page_slug === page.slug));
  const vendors = sortByOrderThenName(data.vendors.filter((r) => r.page_slug === page.slug), 'name');

  const groupsMarkup = locations.map((location) => {
    const locationVendors = vendors.filter((vendor) => vendor.event_location_id === location.id || vendor.location_external_id === location.external_id);
    const vendorItems = locationVendors.map((row) => {
      const products = displaySoon(row.product_list, 'Product list coming soon');
      return `
        <article class="admin-vendor-row">
          <div class="admin-entity-card__top">
            <div>
              <h5>${escapeHtml(displayValue(row.name))}</h5>
              <p class="subtle-text">${escapeHtml(displayValue(row.category))} · ${escapeHtml(displayValue(row.booth))}</p>
            </div>
            <div class="button-row">
              <button type="button" data-edit-vendor="${escapeHtml(row.external_id)}">Edit</button>
              <button class="danger" type="button" data-delete-vendor="${escapeHtml(row.external_id)}">Delete</button>
            </div>
          </div>
          <dl class="admin-kv-grid compact">
            <div><dt>Public Address</dt><dd>${escapeHtml(displayValue(row.vendor_address))}</dd></div>
            <div><dt>Public Phone</dt><dd>${escapeHtml(displayValue(row.public_phone))}</dd></div>
            <div><dt>Public Email</dt><dd>${escapeHtml(displayValue(row.public_email))}</dd></div>
            <div><dt>Products</dt><dd>${escapeHtml(products)}</dd></div>
            <div><dt>Internal Contact</dt><dd>${escapeHtml(displayValue(row.internal_contact_name))}</dd></div>
            <div><dt>Internal Email</dt><dd>${escapeHtml(displayValue(row.internal_email))}</dd></div>
          </dl>
        </article>
      `;
    }).join('');

    const emptyState = location.multi_vendor
      ? '<p class="subtle-text">Vendor list coming soon.</p>'
      : '<p class="subtle-text">No vendors assigned to this location yet.</p>';

    return `
      <section class="admin-group-block">
        <div class="admin-group-block__header">
          <div>
            <h4>${escapeHtml(displayValue(location.location_group))} · ${escapeHtml(displayValue(location.name))}</h4>
            <p class="subtle-text">${escapeHtml(displayValue(location.address))}</p>
          </div>
          <button type="button" data-vendor-new data-default-location="${escapeHtml(location.external_id)}">Add Vendor</button>
        </div>
        ${vendorItems || emptyState}
      </section>
    `;
  }).join('');

  const unassigned = vendors.filter((vendor) => !getLocationForVendor(data, page.slug, vendor));
  const unassignedMarkup = unassigned.length ? `
    <section class="admin-group-block admin-group-block-warning">
      <div class="admin-group-block__header">
        <h4>Unassigned Vendors</h4>
        <span class="subtle-text">Needs location cleanup</span>
      </div>
      <div class="admin-entity-grid">
        ${unassigned.map((row) => `
          <article class="admin-entity-card">
            <div class="admin-entity-card__top">
              <div>
                <h5>${escapeHtml(displayValue(row.name))}</h5>
                <p class="subtle-text">${escapeHtml(displayValue(row.location_external_id))}</p>
              </div>
              <div class="button-row">
                <button type="button" data-edit-vendor="${escapeHtml(row.external_id)}">Edit</button>
                <button class="danger" type="button" data-delete-vendor="${escapeHtml(row.external_id)}">Delete</button>
              </div>
            </div>
          </article>
        `).join('')}
      </div>
    </section>
  ` : '';

  const empty = `
    <section class="admin-empty-state">
      <h4>No vendor records yet</h4>
      <p class="subtle-text">Use placeholder records now, then replace them with detailed vendor records as registrations are confirmed.</p>
    </section>
  `;

  return `
    <section class="admin-card">
      <div class="admin-section-header">
        <div>
          <h3>Vendors</h3>
          <p class="subtle-text">Public fields render on the website. Internal fields stay in admin for CoVH staff and location managers.</p>
        </div>
        <button type="button" data-vendor-new>Add Vendor</button>
      </div>
      ${groupsMarkup || empty}
      ${unassignedMarkup}
      <p class="error-text" data-message="vendor"></p>
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
      <div class="admin-form-header">
        <h4>${record ? 'Edit Location' : 'Add Location'}</h4>
        <p class="subtle-text">Use this record for public location listings, flyer sections, map metadata, and vendor routing.</p>
      </div>
      <div class="admin-columns-2">
        <label>Name<input name="name" value="${escapeHtml(record?.name || '')}" required></label>
        <label>Location Number<input name="location_number" value="${escapeHtml(record?.location_number || '')}" placeholder="12"></label>
      </div>
      <div class="admin-columns-2">
        <label>Address<input name="address" value="${escapeHtml(record?.address || '')}"></label>
        <label>Town / Group<input name="location_group" value="${escapeHtml(record?.location_group || '')}" placeholder="Mt. Pulaski"></label>
      </div>
      <div class="admin-columns-3">
        <label>Web Sort<input type="number" name="web_sort_order" value="${escapeHtml(String(record?.web_sort_order ?? record?.sort_order ?? ''))}"></label>
        <label>Flyer Sort<input type="number" name="flyer_sort_order" value="${escapeHtml(String(record?.flyer_sort_order ?? record?.sort_order ?? ''))}"></label>
        <label>Legacy Sort<input type="number" name="sort_order" value="${escapeHtml(String(record?.sort_order ?? ''))}"></label>
      </div>
      <div class="admin-columns-3">
        <label>Map X<input type="number" step="0.1" name="map_x" value="${escapeHtml(String(record?.map_x ?? ''))}"></label>
        <label>Map Y<input type="number" step="0.1" name="map_y" value="${escapeHtml(String(record?.map_y ?? ''))}"></label>
        <label>Pin Icon<input name="pin_icon" value="${escapeHtml(record?.pin_icon || '')}"></label>
      </div>
      <div class="admin-columns-2">
        <label>Hours<input name="hours" value="${escapeHtml(record?.hours || '')}"></label>
        <label>Tags (comma)<input name="tags" value="${escapeHtml((record?.tags || []).join(', '))}" placeholder="Multi Vendor, Food"></label>
      </div>
      <label>Description<textarea rows="2" name="description">${escapeHtml(record?.description || '')}</textarea></label>
      <label>Notes<textarea rows="2" name="notes">${escapeHtml(record?.notes || '')}</textarea></label>
      <div class="admin-columns-2">
        <label>Directions Text<textarea rows="2" name="directions_text">${escapeHtml(record?.directions_text || '')}</textarea></label>
        <label>Directions URL<input name="directions_url" value="${escapeHtml(record?.directions_url || '')}" placeholder="https://..."></label>
      </div>
      <div class="admin-checkbox-grid">
        <label><input type="checkbox" name="multi_vendor" ${record?.multi_vendor ? 'checked' : ''}> Multi-vendor location</label>
        <label><input type="checkbox" name="is_bag_location" ${record?.is_bag_location ? 'checked' : ''}> Bag location</label>
        <label><input type="checkbox" name="show_on_flyer" ${record?.show_on_flyer === false ? '' : 'checked'}> Show on flyer</label>
        <label><input type="checkbox" name="is_active" ${record?.is_active === false ? '' : 'checked'}> Active</label>
      </div>
      <label>Raw JSON<textarea rows="2" name="raw">${escapeHtml(JSON.stringify(record?.raw || {}, null, 2))}</textarea></label>
      <div class="button-row"><button type="submit">Save Location</button></div>
    `;
  }

  if (type === 'vendor') {
    const form = panel.querySelector('[data-form="vendor"]');
    if (!form) return;
    const locationOptions = sortLocationsForAdmin(data.locations.filter((row) => row.page_slug === page.slug)).map((loc) => `<option value="${escapeHtml(loc.external_id)}">${escapeHtml(loc.location_group || 'Other')} · ${escapeHtml(loc.name || loc.external_id)}</option>`).join('');
    form.innerHTML = `
      <input type="hidden" name="external_id" value="${escapeHtml(record?.external_id || '')}">
      <div class="admin-form-header">
        <h4>${record ? 'Edit Vendor' : 'Add Vendor'}</h4>
        <p class="subtle-text">Customer-facing contact is public. Internal contact is for CoVH staff and location managers only.</p>
      </div>
      <div class="admin-columns-2">
        <label>Vendor Name<input name="name" value="${escapeHtml(record?.name || '')}" required></label>
        <label>Category<input name="category" value="${escapeHtml(record?.category || '')}" placeholder="Vendor, Food, Multi Vendor"></label>
      </div>
      <div class="admin-columns-3">
        <label>Location<input name="location_external_id" list="location-id-list" value="${escapeHtml(record?.location_external_id || '')}" required></label>
        <label>Booth<input name="booth" value="${escapeHtml(record?.booth || '')}"></label>
        <label>Sort Order<input type="number" name="sort_order" value="${escapeHtml(String(record?.sort_order ?? ''))}"></label>
      </div>
      <div class="admin-columns-2">
        <label>Hours<input name="hours" value="${escapeHtml(record?.hours || '')}"></label>
        <label>Vendor Address<input name="vendor_address" value="${escapeHtml(record?.vendor_address || '')}" placeholder="Shown publicly"></label>
      </div>
      <label>Description<textarea rows="2" name="description">${escapeHtml(record?.description || '')}</textarea></label>
      <label>Product List<textarea rows="2" name="product_list">${escapeHtml(record?.product_list || '')}</textarea></label>
      <div class="admin-columns-3">
        <label>Public Phone<input name="public_phone" value="${escapeHtml(record?.public_phone || '')}" placeholder="-"></label>
        <label>Public Email<input name="public_email" value="${escapeHtml(record?.public_email || '')}" placeholder="-"></label>
        <label>Public Website<input name="public_website" value="${escapeHtml(record?.public_website || '')}" placeholder="https://..."></label>
      </div>
      <div class="admin-columns-3">
        <label>Internal Contact<input name="internal_contact_name" value="${escapeHtml(record?.internal_contact_name || '')}"></label>
        <label>Internal Phone<input name="internal_phone" value="${escapeHtml(record?.internal_phone || '')}"></label>
        <label>Internal Email<input name="internal_email" value="${escapeHtml(record?.internal_email || '')}"></label>
      </div>
      <label>Internal Notes<textarea rows="2" name="internal_notes">${escapeHtml(record?.internal_notes || '')}</textarea></label>
      <label><input type="checkbox" name="is_active" ${record?.is_active === false ? '' : 'checked'}> Active</label>
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
    <div class="admin-panel-header-row">
      <div>
        <h2>${escapeHtml(group.name)}</h2>
        <p class="subtle-text">${escapeHtml(group.slug)}</p>
      </div>
      <a class="admin-link-button" href="${escapeHtml(getPublicPageHref(page))}">Return to Front End</a>
    </div>
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

  panel.querySelectorAll('[data-calendar-select-date]').forEach((button) => button.addEventListener('click', () => {
    setSelectedCalendarDate(groupSlug, page.slug, button.dataset.calendarSelectDate);
    renderGroupPanel(tabKey);
  }));

  panel.querySelectorAll('[data-calendar-select-month]').forEach((button) => button.addEventListener('click', () => {
    setSelectedCalendarMonth(groupSlug, page.slug, button.dataset.calendarSelectMonth);
    const dataForGroup = currentGroupData(groupSlug);
    const dates = Array.from(new Set([
      ...dataForGroup.days.filter((row) => row.page_slug === page.slug).map((row) => row.event_date).filter(Boolean),
      ...dataForGroup.schedule.filter((row) => row.page_slug === page.slug).map((row) => row.event_date).filter(Boolean),
    ])).sort();
    const nextDate = dates.find((dateStr) => dateStr.startsWith(button.dataset.calendarSelectMonth)) || `${button.dataset.calendarSelectMonth}-01`;
    setSelectedCalendarDate(groupSlug, page.slug, nextDate);
    renderGroupPanel(tabKey);
  }));

  panel.querySelectorAll('[data-calendar-shift-month]').forEach((button) => button.addEventListener('click', () => {
    const current = getSelectedCalendarMonth(groupSlug, page.slug, formatIsoDateLocal(new Date()).slice(0, 7));
    const [year, month] = current.split('-').map(Number);
    const next = new Date(year, month - 1 + Number(button.dataset.calendarShiftMonth), 1);
    setSelectedCalendarMonth(groupSlug, page.slug, `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`);
    const currentSelectedDate = getSelectedCalendarDate(groupSlug, page.slug, formatIsoDateLocal(new Date()));
    const currentDay = Number((currentSelectedDate || '').slice(8, 10) || '1');
    setSelectedCalendarDate(groupSlug, page.slug, `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(currentDay).padStart(2, '0')}`);
    renderGroupPanel(tabKey);
  }));

  panel.querySelector('[data-calendar-add-event]')?.addEventListener('click', (event) => {
    openEventEditorModal(groupSlug, tabKey, page, data, event.currentTarget.dataset.calendarAddEvent, null);
  });

  panel.querySelectorAll('[data-calendar-edit-schedule]').forEach((button) => button.addEventListener('click', () => {
    const record = data.schedule.find((row) => row.page_slug === page.slug && row.external_id === button.dataset.calendarEditSchedule);
    if (record) openEventEditorModal(groupSlug, tabKey, page, data, record.event_date, record);
  }));

  panel.querySelectorAll('[data-location-new]').forEach((button) => button.addEventListener('click', () => openLocationEditorModal(groupSlug, tabKey, page, data, { location_group: button.dataset.defaultGroup || '' }))); 
  panel.querySelectorAll('[data-edit-location]').forEach((button) => button.addEventListener('click', () => {
    const record = data.locations.find((row) => row.page_slug === page.slug && row.external_id === button.dataset.editLocation);
    openLocationEditorModal(groupSlug, tabKey, page, data, record);
  }));
  panel.querySelectorAll('[data-delete-location]').forEach((button) => button.addEventListener('click', async () => {
    const { error } = await supabaseClient.from('event_locations').delete().eq('page_slug', page.slug).eq('external_id', button.dataset.deleteLocation);
    if (error) return setMessage(panel, 'location', error.message || 'Delete failed');
    await refreshGroup(groupSlug, tabKey);
  }));

  panel.querySelectorAll('[data-vendor-new]').forEach((button) => button.addEventListener('click', () => openVendorEditorModal(groupSlug, tabKey, page, data, button.dataset.defaultLocation ? { location_external_id: button.dataset.defaultLocation } : null)));
  panel.querySelectorAll('[data-edit-vendor]').forEach((button) => button.addEventListener('click', () => {
    const record = data.vendors.find((row) => row.page_slug === page.slug && row.external_id === button.dataset.editVendor);
    openVendorEditorModal(groupSlug, tabKey, page, data, record);
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
    state.importRuns = await fetchImportRuns().catch(() => []);
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
