const eventFile = document.documentElement.dataset.eventFile;
const supabaseClient = window.supabaseClient;

function getPageSlug() {
  const explicit = document.documentElement.dataset.pageSlug;
  if (explicit) return explicit;
  const fileName = window.location.pathname.split('/').pop() || '';
  return fileName.replace(/\.html$/i, '') || null;
}

const state = {
  eventData: null,
  selectedDate: null,
  filterMode: 'day'
};

const el = {
  eventEyebrow: document.getElementById('event-eyebrow'),
  eventName: document.getElementById('event-name'),
  eventSummary: document.getElementById('event-summary'),
  eventDates: document.getElementById('event-dates'),
  eventLocation: document.getElementById('event-location'),
  dayFilter: document.getElementById('day-filter'),
  scheduleList: document.getElementById('schedule-list'),
  mapSurface: document.getElementById('map-surface'),
  mapLocationList: document.getElementById('map-location-list'),
  vendorList: document.getElementById('vendor-list'),
  locationList: document.getElementById('location-list'),
  flyerPanel: document.getElementById('flyer-panel'),
  resourceLinks: document.getElementById('resource-links'),
  modal: document.getElementById('detail-modal'),
  modalKicker: document.getElementById('modal-kicker'),
  modalTitle: document.getElementById('modal-title'),
  modalContent: document.getElementById('modal-content'),
  closeModal: document.getElementById('close-modal'),
  themeToggle: document.getElementById('theme-toggle')
};

const THEME_STORAGE_KEY = 'mp-community-events-theme';

function getStoredTheme() {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) || 'light';
  } catch (error) {
    return 'light';
  }
}

function applyTheme(theme) {
  const isDark = theme === 'dark';
  document.body.classList.toggle('theme-dark', isDark);

  if (el.themeToggle) {
    el.themeToggle.setAttribute('aria-pressed', String(isDark));
    const label = el.themeToggle.querySelector('.theme-toggle-label');
    if (label) {
      label.textContent = isDark ? 'Light mode' : 'Dark mode';
    }
  }
}

function initThemeToggle() {
  applyTheme(getStoredTheme());

  if (!el.themeToggle) return;

  el.themeToggle.addEventListener('click', () => {
    const nextTheme = document.body.classList.contains('theme-dark') ? 'light' : 'dark';
    applyTheme(nextTheme);

    try {
      localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch (error) {
      console.warn('Theme preference could not be saved.', error);
    }
  });
}

function formatTimeRange(start, end) {
  const startText = String(start || '').trim();
  const endText = String(end || '').trim();
  const emptyStart = !startText || startText.toUpperCase() === 'TBD';
  const emptyEnd = !endText || endText.toUpperCase() === 'TBD';

  if (emptyStart && emptyEnd) return 'TBD';
  if (emptyEnd || startText === endText) return startText || endText;
  if (emptyStart) return endText;
  return `${startText} – ${endText}`;
}

function convertTimeTo24(timeStr) {
  const match = String(timeStr).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return '00:00';
  let [, h, m, ap] = match;
  let hour = parseInt(h, 10);
  if (ap.toUpperCase() === 'PM' && hour !== 12) hour += 12;
  if (ap.toUpperCase() === 'AM' && hour === 12) hour = 0;
  return `${String(hour).padStart(2, '0')}:${m}`;
}

function makeButton(label, onClick, className = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  if (className) button.className = className;
  button.addEventListener('click', onClick);
  return button;
}


function escapeAttr(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function getDirectionsUrl(location) {
  if (location?.googleMapsUrl) return location.googleMapsUrl;
  const destination = encodeURIComponent(location?.address || location?.name || state.eventData?.eventName || 'Mt. Pulaski, IL');
  return `https://www.google.com/maps/dir/?api=1&destination=${destination}`;
}

function getInteractiveMapUrl(data = state.eventData) {
  return data?.interactiveMapUrl || '';
}

function getLocationCardId(locationId) {
  return `location-card-${locationId}`;
}

function getMapPanelTitle(panelKey) {
  return {
    mtPulaski: 'Mt. Pulaski',
    chestnut: 'Chestnut',
    elkhart: 'Elkhart',
    latham: 'Latham'
  }[panelKey] || 'Map';
}

function buildMapHotspot(location, data = state.eventData, className = 'map-hotspot') {
  const x = location.panelX ?? location.mapX ?? 50;
  const y = location.panelY ?? location.mapY ?? 50;
  const number = location.flyerNumber || location.number || location.pinNumber || '';
  return `
    <button
      type="button"
      class="${className}"
      style="left:${x}%; top:${y}%;"
      data-location-id="${escapeAttr(location.id)}"
      aria-label="${escapeAttr(location.name)}"
      title="${escapeAttr(location.name)}"
    >${number || '•'}</button>
  `;
}

function bindMapHotspots(scope = document, data = state.eventData) {
  scope.querySelectorAll('[data-location-id]').forEach(button => {
    button.addEventListener('click', () => {
      const location = getLocationById(button.dataset.locationId, data);
      if (location) showLocationModal(location, data);
    });
  });
}

function showLocationCard(locationId) {
  const locationsTab = document.querySelector('[data-tab="locations"]');
  locationsTab?.click();
  const card = document.getElementById(getLocationCardId(locationId));
  card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function getDisclaimerMarkup(data = state.eventData, extraClass = '') {
  if (!data?.disclaimer?.text) return '';
  const title = data.disclaimer.title || 'Important Notice';
  const className = ['disclaimer', extraClass].filter(Boolean).join(' ');
  return `
    <section class="${className}" aria-label="${title}">
      <strong>${title}:</strong> ${data.disclaimer.text}
    </section>
  `;
}

function ensureModalHeaderStructure() {
  if (!el.modal || !el.modalKicker || !el.modalTitle) return;
  const card = el.modal.querySelector('.modal-card');
  if (!card) return;

  let header = card.querySelector('.modal-header');
  if (!header) {
    header = document.createElement('div');
    header.className = 'modal-header';
    card.insertBefore(header, el.modalContent || el.closeModal?.nextSibling || null);
  }

  if (el.modalKicker.parentElement !== header) header.appendChild(el.modalKicker);
  if (el.modalTitle.parentElement !== header) header.appendChild(el.modalTitle);
}

function openModal(kicker, title, html) {
  ensureModalHeaderStructure();
  el.modalKicker.textContent = kicker;
  el.modalTitle.textContent = title;
  el.modalContent.innerHTML = `${html}${getDisclaimerMarkup(state.eventData, 'modal-disclaimer')}`;
  el.modal.classList.remove('hidden');
  document.body.classList.add('modal-open');
}

function closeModal() {
  el.modal.classList.add('hidden');
  document.body.classList.remove('modal-open');
}

function showLoadError(message) {
  if (el.scheduleList) {
    el.scheduleList.innerHTML = `<div class="empty-state error-state">${message}</div>`;
  }
}

function getLocationById(id, data = state.eventData) {
  return data?.locations?.find(loc => loc.id === id);
}

function getVendorsByLocation(locationId, data = state.eventData) {
  return (data?.vendors || []).filter(v => v.locationId === locationId);
}

function getScheduleByLocation(locationId, data = state.eventData) {
  return (data?.schedule || []).filter(s => s.locationId === locationId);
}

function badgeMarkup(tags = []) {
  if (!tags.length) return '';
  return `<div class="badge-row">${tags.map(tag => `<span class="mini-badge">${tag}</span>`).join('')}</div>`;
}

function renderPageDisclaimer(data) {
  const shell = document.querySelector('main.phone-shell');
  if (!shell) return;

  let disclaimer = document.getElementById('page-disclaimer');
  if (!disclaimer) {
    disclaimer = document.createElement('section');
    disclaimer.id = 'page-disclaimer';
    shell.appendChild(disclaimer);
  }

  disclaimer.outerHTML = getDisclaimerMarkup(data, 'page-disclaimer');
}

function renderHeader(data) {
  if (el.eventEyebrow) el.eventEyebrow.textContent = data.eventType || 'Community Event';
  if (el.eventName) el.eventName.textContent = data.eventName;
  if (el.eventSummary) el.eventSummary.textContent = data.summary;
  if (el.eventDates) el.eventDates.textContent = data.dateLabel;
  if (el.eventLocation) el.eventLocation.textContent = data.areaLabel;

  renderPageDisclaimer(data);

  if (el.resourceLinks) {
    el.resourceLinks.innerHTML = '';
    (data.resources || []).forEach(resource => {
      const a = document.createElement('a');
      a.className = 'resource-link';
      a.href = resource.href;
      a.textContent = resource.label;
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener');
      el.resourceLinks.appendChild(a);
    });
  }
}


function getUniqueDates(data) {
  return Array.from(new Set((data.schedule || []).map(item => item.date))).sort();
}

function getMonthOptions(data) {
  const seen = new Set();
  return getUniqueDates(data).map(dateStr => {
    const date = new Date(`${dateStr}T12:00:00`);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (seen.has(key)) return null;
    seen.add(key);
    return {
      id: key,
      label: date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
    };
  }).filter(Boolean);
}

function getFilterMode(data) {
  const uniqueDates = getUniqueDates(data);
  return uniqueDates.length > 31 ? 'month' : 'day';
}

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function getEventCode(data) {
  return data?._meta?.code || '';
}

function getCurrentOrNextDayId(data) {
  const days = data.days || [];
  if (!days.length) return null;

  const today = todayYmd();

  // current exact day
  const current = days.find(day => day.date === today);
  if (current) return current.id;

  // next future day
  const upcoming = days.find(day => day.date >= today);
  if (upcoming) return upcoming.id;

  // fallback to first day
  return days[0].id;
}

function getNextAvailableDayIdFromSchedule(data) {
  const schedule = (data.schedule || []).slice();
  if (!schedule.length) return null;

  const today = todayYmd();

  const uniqueDates = Array.from(
    new Set(schedule.map(item => item.date).filter(Boolean))
  ).sort();

  // first current or future schedule date
  const nextDate = uniqueDates.find(date => date >= today);

  if (nextDate) {
    const matchingDay = (data.days || []).find(day => day.date === nextDate);
    return matchingDay?.id || nextDate;
  }

  // fallback to last available date/day if all have passed
  const lastDate = uniqueDates[uniqueDates.length - 1];
  const matchingDay = (data.days || []).find(day => day.date === lastDate);
  return matchingDay?.id || lastDate;
}

function getCurrentMonthId() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
}

function getBestDefaultSelection(data) {
  const code = getEventCode(data);
  const filterMode = getFilterMode(data);

  // Month-driven pages
  if (code === 'COMMUNITY' || code === 'SCHOOL' || code === 'TOWN') {
    return getCurrentMonthId();
  }

  // Fall Fest: active/current day, then next day, then first day
  if (code === 'FALLFEST') {
    return getCurrentOrNextDayId(data);
  }

  // 2nd Fridays: next available event date, else last available
  if (code === '2NDFRIDAY' || code === 'SECOND_FRIDAYS') {
    return getNextAvailableDayIdFromSchedule(data);
  }

  // COVH: leave current behavior
  if (code === 'COVH') {
    if (filterMode === 'month') {
      const months = getMonthOptions(data);
      return months[0]?.id || 'all';
    }
    return data.days?.[0]?.id || null;
  }

  // Generic fallback
  if (filterMode === 'month') {
    const currentMonth = getCurrentMonthId();
    const monthOptions = getMonthOptions(data);
    const hasCurrent = monthOptions.some(month => month.id === currentMonth);
    return hasCurrent ? currentMonth : (monthOptions[0]?.id || 'all');
  }

  return getCurrentOrNextDayId(data) || data.days?.[0]?.id || null;
}

function renderDayFilter(data) {
  if (!el.dayFilter) return;
  el.dayFilter.innerHTML = '';
  if (!data.days?.length && !(data.schedule || []).length) return;

  state.filterMode = getFilterMode(data);

  if (state.filterMode === 'month') {
	const monthOptions = getMonthOptions(data);
	const defaultSelection = getBestDefaultSelection(data);
	state.selectedDate = state.selectedDate || defaultSelection || 'all';
	
	const validMonthIds = new Set(monthOptions.map(month => month.id));
if (state.selectedDate !== 'all' && !validMonthIds.has(state.selectedDate)) {
  state.selectedDate = monthOptions[0]?.id || 'all';
}

    const allChip = document.createElement('button');
    allChip.type = 'button';
    allChip.className = `day-chip ${state.selectedDate === 'all' ? 'active' : ''}`;
    allChip.textContent = 'All';
    allChip.addEventListener('click', () => {
      state.selectedDate = 'all';
      renderDayFilter(data);
      renderSchedule(data);
    });
    el.dayFilter.appendChild(allChip);

    monthOptions.forEach(month => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `day-chip ${state.selectedDate === month.id ? 'active' : ''}`;
      chip.textContent = month.label;
      chip.addEventListener('click', () => {
        state.selectedDate = month.id;
        renderDayFilter(data);
        renderSchedule(data);
      });
      el.dayFilter.appendChild(chip);
    });

    return;
  }

	state.selectedDate = state.selectedDate || getBestDefaultSelection(data) || data.days[0]?.id || null;

  data.days.forEach(day => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `day-chip ${state.selectedDate === day.id ? 'active' : ''}`;
    chip.textContent = day.label;
    chip.addEventListener('click', () => {
      state.selectedDate = day.id;
      renderDayFilter(data);
      renderSchedule(data);
    });
    el.dayFilter.appendChild(chip);
  });
}

function renderSchedule(data) {
  if (!el.scheduleList) return;
  el.scheduleList.innerHTML = '';
  let filtered = data.schedule || [];
  if (state.filterMode === 'month') {
    if (state.selectedDate !== 'all') {
      filtered = filtered.filter(item => item.date && item.date.slice(0, 7) === state.selectedDate);
    }
  } else {
    filtered = filtered.filter(item => item.dayId === state.selectedDate);
  }

  filtered = filtered.slice().sort((a, b) => {
    const aDate = new Date(`${a.date}T${convertTimeTo24(a.startTime)}:00`);
    const bDate = new Date(`${b.date}T${convertTimeTo24(b.startTime)}:00`);
    return aDate - bDate;
  });

  if (!filtered.length) {
    el.scheduleList.innerHTML = `<div class="empty-state">${state.filterMode === 'month' ? 'No events for this month yet.' : 'No events for this date yet.'}</div>`;
    return;
  }

  filtered.forEach(item => {
    const card = document.createElement('article');
    card.className = 'schedule-card';
    card.id = item.id;

    const location = getLocationById(item.locationId, data);
    const vendorText = item.vendorIds?.length
      ? data.vendors.filter(v => item.vendorIds.includes(v.id)).map(v => v.name).join(', ')
      : 'No linked vendors';

    const eventDateText = item.date
      ? new Date(`${item.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
      : '';

    card.innerHTML = `
      <div class="schedule-top">
        <span class="time-range">${formatTimeRange(item.startTime, item.endTime)}</span>
        <span class="mini-badge">${item.category}</span>
      </div>
      <h2>${item.title}</h2>
      ${state.filterMode === 'month' ? `<div class="detail-row"><strong>Date:</strong> ${eventDateText}</div>` : ''}
      <div class="detail-row"><strong>Location:</strong> ${location?.name || 'TBD'}</div>
      <div class="detail-row">${item.description}</div>
    `;

    card.appendChild(makeButton('View details', () => {
      openModal(
        'Schedule Item',
        item.title,
        `
          ${item.date ? `<p><strong>Date:</strong> ${new Date(`${item.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>` : ''}
          <p><strong>Time:</strong> ${formatTimeRange(item.startTime, item.endTime)}</p>
          <p><strong>Location:</strong> ${location?.name || 'TBD'}</p>
          <p><strong>Category:</strong> ${item.category}</p>
          <p>${item.description}</p>
          <p><strong>Linked Vendors:</strong> ${vendorText}</p>
        `
      );
    }));

    el.scheduleList.appendChild(card);
  });
}

function renderVendorSection(location, locationVendors) {
  if (!location?.multiVendor || !locationVendors?.length) return '';

  return `
    <hr class="modal-divider" />
    <h3>Vendors at this location</h3>
    <div class="modal-list">
      ${locationVendors.map(v => `
        <div class="modal-list-item">
          <strong>${v.name}</strong>
          <div>${v.description || ''}</div>
          <div class="muted-inline">${v.hours || ''}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function showLocationModal(location, data) {
  const locationVendors = getVendorsByLocation(location.id, data);
  const locationEvents = getScheduleByLocation(location.id, data);

  const eventsHtml = locationEvents.length
    ? `<div class="modal-list">${locationEvents.map(e => `
        <div class="modal-list-item">
          <strong>${e.title}</strong>
          <div>${formatTimeRange(e.startTime, e.endTime)}</div>
        </div>
      `).join('')}</div>`
    : '<p>No specific scheduled items at this stop.</p>';

  openModal(
    location.multiVendor ? 'Multi-Vendor Location' : 'Location',
    location.name,
    `
      <p><strong>Address:</strong> ${location.address}</p>
      <p><strong>Hours:</strong> ${location.hours || location.notes || 'See event schedule.'}</p>
      <p>${location.description}</p>
      <div class="modal-action-row">
        <button type="button" class="modal-action-button" data-modal-action="details" data-location-id="${escapeAttr(location.id)}">View Details</button>
        <a class="modal-action-button" href="${escapeAttr(getDirectionsUrl(location))}" target="_blank" rel="noopener">Get Directions</a>
      </div>
      ${badgeMarkup(location.tags)}
      ${renderVendorSection(location, locationVendors)}
      <hr class="modal-divider" />
      <h3>Scheduled items</h3>
      ${eventsHtml}
      <hr class="modal-divider" />
      <p><strong>Directions:</strong> ${location.directionsText || 'Use Get Directions for turn-by-turn navigation.'}</p>
    `
  );

  el.modalContent?.querySelector('[data-modal-action="details"]')?.addEventListener('click', () => {
    closeModal();
    showLocationCard(location.id);
  });
}

function renderMap(data) {
  if (!el.mapSurface || !el.mapLocationList) return;
  el.mapSurface.innerHTML = '';
  el.mapLocationList.innerHTML = '';

  const interactiveMapLink = document.getElementById('interactive-map-link');
  if (interactiveMapLink) {
    const interactiveUrl = getInteractiveMapUrl(data) || '#';
    interactiveMapLink.href = interactiveUrl;
    interactiveMapLink.style.display = interactiveUrl ? '' : 'none';
  }

  const covhPanels = [
    { key: 'mtPulaski', title: 'Mt. Pulaski', image: data.flyer?.assets?.maps?.mtPulaski },
    { key: 'chestnut', title: 'Chestnut', image: data.flyer?.assets?.maps?.chestnut },
    { key: 'elkhart', title: 'Elkhart', image: data.flyer?.assets?.maps?.elkhart },
    { key: 'latham', title: 'Latham', image: data.flyer?.assets?.maps?.latham }
  ].filter(panel => panel.image);

  if (covhPanels.length) {
    el.mapSurface.innerHTML = `
      <div class="covh-map-layout covh-map-layout-tab">
        ${covhPanels.map(panel => `
          <section class="covh-map-panel ${panel.key === 'mtPulaski' ? 'covh-map-main-card' : 'covh-map-card'}">
            <img src="${escapeAttr(panel.image)}" alt="${escapeAttr(panel.title)} event map" class="${panel.key === 'mtPulaski' ? 'covh-main-map' : ''}" loading="lazy" />
            <div class="covh-map-tag ${panel.key === 'mtPulaski' ? 'covh-main-map-tag' : ''}">${panel.title}</div>
            <div class="covh-map-hotspots">
              ${(data.locations || []).filter(location => (location.mapPanel || 'mtPulaski') === panel.key).map(location => buildMapHotspot(location, data, 'map-hotspot')).join('')}
            </div>
          </section>
        `).join('')}
      </div>
    `;
    bindMapHotspots(el.mapSurface, data);
  }

  data.locations.forEach(location => {
    const card = document.createElement('article');
    card.className = 'item-card';
    card.id = getLocationCardId(location.id);
    card.innerHTML = `
      <div class="card-header-line">
        <h2>${location.name}</h2>
        ${location.multiVendor ? '<span class="mini-badge">Multi Vendor</span>' : ''}
      </div>
      <div class="detail-row"><strong>Address:</strong> ${location.address}</div>
      <div class="detail-row"><strong>Hours:</strong> ${location.hours || 'TBD'}</div>
      <div class="detail-row">${location.description}</div>
      ${badgeMarkup(location.tags)}
    `;
    card.appendChild(makeButton('Open location details', () => showLocationModal(location, data)));
    const directions = document.createElement('a');
    directions.className = 'inline-link-button';
    directions.href = getDirectionsUrl(location);
    directions.target = '_blank';
    directions.rel = 'noopener';
    directions.textContent = 'Get directions';
    card.appendChild(directions);
    el.mapLocationList.appendChild(card);
  });
}

function renderVendors(data) {
  if (!el.vendorList) return;
  el.vendorList.innerHTML = '';
  (data.vendors || []).forEach(vendor => {
    const location = getLocationById(vendor.locationId, data);
    const card = document.createElement('article');
    card.className = 'vendor-card';
    card.innerHTML = `
      <h2>${vendor.name}</h2>
      <div class="detail-row"><strong>Category:</strong> ${vendor.category}</div>
      <div class="detail-row"><strong>Location:</strong> ${location?.name || 'TBD'}</div>
      <div class="detail-row">${vendor.description || ''}</div>
    `;
    card.appendChild(makeButton('View vendor details', () => {
      openModal(
        'Vendor',
        vendor.name,
        `
          <p><strong>Category:</strong> ${vendor.category || 'Vendor'}</p>
          <p><strong>Location:</strong> ${location?.name || 'TBD'}</p>
          <p>${vendor.description || ''}</p>
          <p><strong>Booth / Spot:</strong> ${vendor.booth || 'TBD'}</p>
          <p><strong>Hours:</strong> ${vendor.hours || 'Add live hours later.'}</p>
        `
      );
    }));
    el.vendorList.appendChild(card);
  });
}

function renderLocations(data) {
  if (!el.locationList) return;
  el.locationList.innerHTML = '';

  const groups = {};
  (data.locations || []).forEach(location => {
    const groupName = location.group || 'Locations';
    groups[groupName] = groups[groupName] || [];
    groups[groupName].push(location);
  });

  Object.entries(groups).forEach(([groupName, locations]) => {
    const wrapper = document.createElement('section');
    wrapper.className = 'location-group';

    const header = document.createElement('div');
    header.className = 'section-kicker';
    header.textContent = groupName;
    wrapper.appendChild(header);

    locations.forEach(location => {
      const vendorsAtLocation = getVendorsByLocation(location.id, data);
      const card = document.createElement('article');
      card.className = 'location-card';
      card.innerHTML = `
        <div class="card-header-line">
          <h2>${location.name}</h2>
          ${location.multiVendor ? '<span class="mini-badge">Multi Vendor</span>' : ''}
        </div>
        <div class="detail-row"><strong>Address:</strong> ${location.address}</div>
        <div class="detail-row"><strong>Hours:</strong> ${location.hours || 'TBD'}</div>
        <div class="detail-row">${location.description}</div>
        ${location.multiVendor ? `<div class="detail-row"><strong>Vendors loaded:</strong> ${vendorsAtLocation.length}</div>` : ''}
        ${badgeMarkup(location.tags)}
      `;
      card.appendChild(makeButton('View details', () => showLocationModal(location, data)));
      wrapper.appendChild(card);
    });

    el.locationList.appendChild(wrapper);
  });
}


function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isCovhFlyer(flyer = state.eventData?.flyer, data = state.eventData) {
  return data?._meta?.code === 'COVH' || /christmas on vinegar hill/i.test(flyer?.document?.title || '');
}

function renderCovhBadgeKey(flyer) {
  return `
    <aside class="covh-key-card">
      <div class="covh-key-title">Icon Key</div>
      ${(flyer.legend || []).map(item => `
        <div class="covh-key-row">
          <span class="covh-key-label">${escapeHtml(item.label)}</span>
          <span class="covh-key-meaning">${escapeHtml(item.meaning)}</span>
        </div>
      `).join('')}
    </aside>
  `;
}

function renderCovhListItem(entry, flyer) {
  const badges = (entry.badges || [])
    .map(b => `<span class="covh-inline-badge">${escapeHtml(b)}</span>`)
    .join(' ');

  const bagIcon = entry.bagLocation && flyer?.assets?.bagIcon
    ? `<img src="${escapeHtml(flyer.assets.bagIcon)}" alt="Bag location" class="covh-bag-icon covh-inline-bag-icon" loading="lazy" />`
    : '';

  const metaIcons = `${badges}${badges && bagIcon ? ' ' : ''}${bagIcon}`;

  return `
    <article class="covh-list-item">
      <div class="covh-item-head">
        <div class="covh-item-title-line">
          <span class="covh-item-number">${escapeHtml(entry.number)}</span>
          <h4>${escapeHtml(entry.name)}</h4>
        </div>
        <div class="covh-item-hours">${escapeHtml(entry.hours || 'TBD')}</div>
      </div>
      <div class="covh-item-meta">
        ${metaIcons ? `<span class="covh-item-badges">${metaIcons}</span>` : ''}
        <span>${escapeHtml(entry.address || '')}</span>
      </div>
      <p>${escapeHtml(entry.description || '')}</p>
    </article>
  `;
}

function renderCovhRegionalItem(entry, flyer) {
  const badges = (entry.badges || [])
    .map(b => `<span class="covh-inline-badge">${escapeHtml(b)}</span>`)
    .join(' ');

  const bagIcon = entry.bagLocation && flyer?.assets?.bagIcon
    ? `<img src="${escapeHtml(flyer.assets.bagIcon)}" alt="Bag location" class="covh-bag-icon covh-inline-bag-icon" loading="lazy" />`
    : '';

  const metaIcons = `${badges}${badges && bagIcon ? ' ' : ''}${bagIcon}`;

  return `
    <div class="covh-regional-item">
      <div class="covh-regional-head">
        <span class="covh-regional-name">${escapeHtml(entry.number)} ${escapeHtml(entry.name)}</span>
        <span class="covh-regional-hours">${escapeHtml(entry.hours || 'TBD')}</span>
      </div>
      <div class="covh-regional-meta">
        ${metaIcons ? `<span class="covh-item-badges">${metaIcons}</span>` : ''}
        <span>${escapeHtml(entry.address || '')}</span>
      </div>
      <p>${escapeHtml(entry.description || '')}</p>
    </div>
  `;
}

function renderCovhPageOne(flyer) {
  const allEntries = [
    ...(flyer.sections?.['mt-pulaski-a']?.entries || []),
    ...(flyer.sections?.['mt-pulaski-b']?.entries || []),
    ...(flyer.sections?.['mt-pulaski-c']?.entries || [])
  ];

  const leftEntries = allEntries.filter(entry => Number.parseInt(entry.number, 10) <= 16);
  const rightEntries = allEntries.filter(entry => Number.parseInt(entry.number, 10) >= 17);
  const regionalBlocks = flyer.sections?.regional?.blocks || [];

  return `
    <article class="flyer-page covh-pamphlet-page covh-page-one" data-page="1">
      <div class="flyer-page-inner covh-page-inner">
			<header class="covh-banner covh-banner-overlay">
			  ${flyer.assets?.headerGraphic ? `
				<div class="covh-banner-strip covh-banner-strip-overlay">
				  <img src="${escapeHtml(flyer.assets.headerGraphic)}" alt="" class="covh-banner-strip-image covh-banner-strip-image-wide" loading="lazy" />
				</div>
			  ` : ''}

			  <div class="covh-banner-copy covh-banner-copy-overlay">
				<div class="covh-banner-date">${escapeHtml(flyer.document?.subtitle || '')}</div>
				<div class="covh-banner-title">Christmas on Vinegar Hill</div>
				<div class="covh-banner-note">${escapeHtml(flyer.callouts?.treeSign || 'Look for the tree sign for participating locations')}</div>
			  </div>
			</header>

        <div class="covh-page-one-grid">
          <section class="covh-column covh-main-list">
            ${leftEntries.map(entry => renderCovhListItem(entry, flyer)).join('')}
          </section>

          <section class="covh-column covh-middle-column">
            ${renderCovhBadgeKey(flyer)}
          </section>

          <section class="covh-column covh-side-list">
            ${rightEntries.map(entry => renderCovhListItem(entry, flyer)).join('')}

            <div class="covh-regional-wrap">
              ${regionalBlocks.map(block => `
                <section class="covh-regional-block">
                  <div class="covh-regional-title">${escapeHtml(block.title)} Location</div>
                  ${(block.entries || []).map(entry => renderCovhRegionalItem(entry, flyer)).join('')}
                </section>
              `).join('')}
            </div>

            <div class="covh-bag-callout">
              <span>Visit a location with the</span>
              ${flyer.assets?.bagIcon
                ? `<img src="${escapeHtml(flyer.assets.bagIcon)}" alt="Bag symbol" class="covh-bag-icon covh-callout-bag-icon" loading="lazy" />`
                : `<span class="covh-bag-text-symbol">bag symbol</span>`}
              <span>symbol and receive a reusable shopping bag with any donation to the Christmas on Vinegar Hill event while supplies last.</span>
            </div>
          </section>
        </div>
      </div>
    </article>
  `;
}

function renderCovhPageTwo(flyer) {
  const maps = flyer.assets?.maps || {};
  const callouts = flyer.callouts || {};
  return `
    <article class="flyer-page covh-pamphlet-page covh-page-two" data-page="2">
      <div class="flyer-page-inner covh-page-inner">
		<header class="covh-banner covh-banner-overlay covh-banner-page-two">
		  ${flyer.assets?.headerGraphic ? `
			<div class="covh-banner-strip covh-banner-strip-overlay">
			  <img src="${escapeHtml(flyer.assets.headerGraphic)}" alt="" class="covh-banner-strip-image covh-banner-strip-image-wide" loading="lazy" />
			</div>
		  ` : ''}

		  <div class="covh-banner-copy covh-banner-copy-overlay">
			<div class="covh-banner-date">${escapeHtml(flyer.document?.subtitle || '')}</div>
			<div class="covh-banner-title">Christmas on Vinegar Hill</div>
		  </div>
		</header>

        <div class="covh-map-layout">
          <div class="covh-map-main-card covh-map-panel">
            <img src="${escapeHtml(maps.mtPulaski || '')}" alt="Mt. Pulaski event map" class="covh-main-map" loading="lazy" />
            <div class="covh-map-tag covh-main-map-tag">Mt. Pulaski</div>
            <div class="covh-compass-card">N<br>✦<br>S</div>
            <div class="covh-map-hotspots">
              ${(state.eventData?.locations || []).filter(location => (location.mapPanel || 'mtPulaski') === 'mtPulaski').map(location => buildMapHotspot(location, state.eventData, 'map-hotspot flyer-hotspot')).join('')}
            </div>
          </div>
          <div class="covh-map-stack">
            <div class="covh-map-card covh-map-panel">
              <img src="${escapeHtml(maps.chestnut || '')}" alt="Chestnut map" loading="lazy" />
              <div class="covh-map-tag">Chestnut</div>
              <div class="covh-map-hotspots">
                ${(state.eventData?.locations || []).filter(location => location.mapPanel === 'chestnut').map(location => buildMapHotspot(location, state.eventData, 'map-hotspot flyer-hotspot')).join('')}
              </div>
            </div>
            <div class="covh-map-card covh-map-panel">
              <img src="${escapeHtml(maps.elkhart || '')}" alt="Elkhart map" loading="lazy" />
              <div class="covh-map-tag">Elkhart</div>
              <div class="covh-map-hotspots">
                ${(state.eventData?.locations || []).filter(location => location.mapPanel === 'elkhart').map(location => buildMapHotspot(location, state.eventData, 'map-hotspot flyer-hotspot')).join('')}
              </div>
            </div>
            <div class="covh-map-card covh-map-panel">
              <img src="${escapeHtml(maps.latham || '')}" alt="Latham map" loading="lazy" />
              <div class="covh-map-tag">Latham</div>
              <div class="covh-map-hotspots">
                ${(state.eventData?.locations || []).filter(location => location.mapPanel === 'latham').map(location => buildMapHotspot(location, state.eventData, 'map-hotspot flyer-hotspot')).join('')}
              </div>
            </div>
          </div>
        </div>

        <div class="covh-footer-layout">
          <section class="covh-thanks-block">
            <div class="covh-script-heading">${escapeHtml(callouts.thankYouTitle || 'Thank You')}</div>
            <p>${escapeHtml(callouts.thankYouText || 'Thank you for your patronage and to our Christmas on Vinegar Hill grant benefactors:')}</p>
            <div class="covh-benefactor-list">
              ${(callouts.benefactors || []).map(item => `<div>${escapeHtml(item)}</div>`).join('')}
            </div>
          </section>

          <section class="covh-qr-block">
            <div class="covh-qr-title">${escapeHtml(callouts.scanText || 'Scan for Google Map of Event')}</div>
            ${flyer.assets?.qrMap ? `<img src="${escapeHtml(flyer.assets.qrMap)}" alt="QR code for event map" class="covh-qr-image" loading="lazy" />` : ''}
          </section>

          <section class="covh-sponsor-block">
            <div class="covh-script-heading">${escapeHtml(callouts.sponsorsTitle || 'Sponsors')}</div>
            <div class="covh-sponsor-list">
              ${(callouts.sponsors || []).map(item => `<div>${escapeHtml(item)}</div>`).join('')}
            </div>
          </section>

          <section class="covh-art-block">
            ${flyer.assets?.treeSign ? `<img src="${escapeHtml(flyer.assets.treeSign)}" alt="Christmas on Vinegar Hill sign" class="covh-art-image" loading="lazy" />` : ''}
            <div class="covh-footer-lines">
              ${(callouts.footer || []).map(line => `<div>${escapeHtml(line)}</div>`).join('')}
            </div>
          </section>
        </div>
      </div>
    </article>
  `;
}

function renderCovhPamphlet(flyer) {
  return `
    <div class="flyer-preview-shell covh-preview-shell">
      ${renderCovhPageOne(flyer)}
      ${renderCovhPageTwo(flyer)}
    </div>
  `;
}

function flyerActionsMarkup() {
  return `
    <div class="flyer-toolbar">
      <button type="button" class="flyer-action" data-flyer-action="share">Share flyer</button>
      <button type="button" class="flyer-action" data-flyer-action="print">Print</button>
      <button type="button" class="flyer-action" data-flyer-action="pdf">Save as PDF</button>
    </div>
  `;
}

function renderFlyerEntry(entry) {
  return `
    <article class="flyer-entry">
      <div class="flyer-entry-top">
        <span class="flyer-number">${entry.number}</span>
        <div class="flyer-name-block">
          <h4>${entry.name}</h4>
          <div class="flyer-meta">${entry.address} • ${entry.hours}</div>
        </div>
      </div>
      <p>${entry.description}</p>
      ${(entry.badges || []).length ? `<div class="badge-row">${entry.badges.map(b => `<span class="mini-badge">${b}</span>`).join('')}</div>` : ''}
    </article>
  `;
}

function renderFlyerSection(section, showTitle = true) {
  if (!section) return '';
  const titleMarkup = showTitle && section.title ? `<div class="flyer-section-heading">${section.title}</div>` : '';
  return `
    <section class="flyer-section">
      ${titleMarkup}
      <div class="flyer-entry-list">
        ${(section.entries || []).map(renderFlyerEntry).join('')}
      </div>
    </section>
  `;
}

function openFlyerFromHash() {
  const hash = window.location.hash?.replace('#', '');
  if (!hash) return;

  if (hash === 'flyer' || hash === 'flyer-panel') {
    const flyerTab = document.querySelector('[data-tab="flyer"]');
    flyerTab?.click();

    setTimeout(() => {
      const flyerTarget =
        document.getElementById(hash) ||
        document.getElementById('flyer-panel');

      flyerTarget?.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    }, 150);
  }
}

function renderRegionalBlock(block, flyer) {
  const mapSrc = flyer.assets?.maps?.[block.mapKey];
  return `
    <section class="flyer-section regional-block">
      <div class="card-header-line flyer-region-top">
        <div class="flyer-section-heading">${block.title}</div>
        ${mapSrc ? `<img class="flyer-mini-map" src="${mapSrc}" alt="${block.title} map" loading="lazy" />` : ''}
      </div>
      <div class="flyer-entry-list compact">
        ${(block.entries || []).map(renderFlyerEntry).join('')}
      </div>
    </section>
  `;
}

function renderFlyerPage(pageConfig, flyer, index) {
  const leftSection = flyer.sections?.[pageConfig.leftSection];
  const rightSection = flyer.sections?.[pageConfig.rightSection];
  const regionalBlocks = rightSection?.blocks || [];
  const callouts = flyer.callouts || {};
  const isSecondPage = index === 1;

  return `
    <article class="flyer-page" data-page="${index + 1}">
      <div class="flyer-page-inner">
        <header class="flyer-page-header">
          <div class="flyer-title-wrap">
            <p class="eyebrow">${flyer.document?.eyebrow || 'Printable flyer'}</p>
            <h2>${flyer.document?.title || 'Event Flyer'}</h2>
            <p class="subtle">${flyer.document?.subtitle || ''}</p>
          </div>
          <div class="legend-row flyer-legend">
            ${(flyer.legend || []).map(item => `<span class="legend-pill"><strong>${item.label}</strong> ${item.meaning}</span>`).join('')}
          </div>
        </header>

        <div class="flyer-page-columns ${isSecondPage ? 'page-two' : ''}">
          <section class="flyer-column flyer-column-main">
            ${renderFlyerSection(leftSection, true)}
          </section>

          <section class="flyer-column flyer-column-side">
            ${!isSecondPage ? renderFlyerSection(rightSection, false) : `
              <section class="flyer-section">
                <div class="flyer-section-heading">Regional Stops</div>
                ${regionalBlocks.map(block => renderRegionalBlock(block, flyer)).join('')}
              </section>

              <section class="flyer-section flyer-callout-grid">
                <div class="flyer-note-card">
                  <div class="flyer-note-top">
                    ${flyer.assets?.treeSign ? `<img class="flyer-tree-sign" src="${flyer.assets.treeSign}" alt="Christmas on Vinegar Hill tree sign" loading="lazy" />` : ''}
                    <div>
                      <h3>Look for the Tree Sign</h3>
                      <p>${callouts.treeSign || ''}</p>
                    </div>
                  </div>
                  <p>${callouts.bagNotice || ''}</p>
                </div>

                <div class="flyer-note-card qr-card">
                  <div>
                    <h3>${callouts.scanText || 'Scan for map'}</h3>
                    <p>Use the QR code for the public event map.</p>
                  </div>
                  ${flyer.assets?.qrMap ? `<img class="flyer-qr" src="${flyer.assets.qrMap}" alt="QR code for event map" loading="lazy" />` : ''}
                </div>
              </section>

              <section class="flyer-section flyer-thanks-grid">
                <div class="flyer-note-card">
                  <h3>${callouts.thankYouTitle || 'Thank You'}</h3>
                  <p>${callouts.thankYouText || ''}</p>
                  <ul class="flyer-list">
                    ${(callouts.benefactors || []).map(item => `<li>${item}</li>`).join('')}
                  </ul>
                </div>

                <div class="flyer-note-card">
                  <h3>${callouts.sponsorsTitle || 'Sponsors'}</h3>
                  <div class="sponsor-grid">
                    ${(callouts.sponsors || []).map(name => `<span class="sponsor-pill">${name}</span>`).join('')}
                  </div>
                  <div class="flyer-footer-lines">
                    ${(callouts.footer || []).map(line => `<div>${line}</div>`).join('')}
                  </div>
                </div>
              </section>
            `}
          </section>
        </div>
      </div>
    </article>
  `;
}

function buildFlyerPrintDocument(flyer) {
  const baseHref = window.location.href.replace(/[^/]*$/, '');
  const flyerMarkup = isCovhFlyer(flyer)
    ? `${renderCovhPageOne(flyer)}${renderCovhPageTwo(flyer)}`
    : (flyer.pageFlow || []).map((page, index) => renderFlyerPage(page, flyer, index)).join('');

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <base href="${baseHref}" />
      <title>${flyer.document?.title || 'Event Flyer'}</title>
      <link rel="stylesheet" href="assets/css/styles.css" />
    </head>
    <body class="flyer-print-page covh-print-page">
      <main class="flyer-print-shell">
        ${flyerMarkup}
      </main>
    </body>
    </html>
  `;
}

async function shareFlyerLink() {
	const shareUrl = `${window.location.origin}${window.location.pathname}#flyer`;

  const shareData = {
    title: `${state.eventData?.eventName || 'Event'} Flyer`,
    text: 'Printable event flyer',
    url: shareUrl
  };

  if (navigator.share) {
    await navigator.share(shareData);
    return;
  }

  await navigator.clipboard.writeText(shareUrl);
  alert('Flyer link copied.');
}

function openFlyerPrintView(mode = 'print') {
  const flyer = state.eventData?.flyer;
  if (!flyer) return;

  const printWindow = window.open('', '_blank', 'noopener,noreferrer');
  if (!printWindow) {
    alert('Allow pop-ups for this site to print or save the flyer.');
    return;
  }

  const html = buildFlyerPrintDocument(flyer);

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();

  const triggerPrint = () => {
    try {
      printWindow.focus();
      printWindow.print();
    } catch (error) {
      console.error('Print failed:', error);
      alert('Print dialog could not be opened.');
    }
  };

  printWindow.addEventListener('load', () => {
    setTimeout(triggerPrint, mode === 'pdf' ? 700 : 400);
  });

  setTimeout(triggerPrint, mode === 'pdf' ? 1200 : 900);
}

function setupFlyerActions() {
  if (!el.flyerPanel) return;

  el.flyerPanel.querySelectorAll('[data-flyer-action]').forEach(button => {
    button.addEventListener('click', (event) => {
      const action = button.dataset.flyerAction;

      if (action === 'share') {
        shareFlyerLink().catch(error => {
          console.error(error);
        });
        return;
      }

      if (action === 'print') {
        openFlyerPrintView('print');
        return;
      }

      if (action === 'pdf') {
        openFlyerPrintView('pdf');
      }
    });
  });
}

function renderFlyer(data) {
  if (!el.flyerPanel) return;
  const canShowDebug = typeof shouldShowFlyerDebug === 'function' && shouldShowFlyerDebug();
  const sourceLabel = typeof getFlyerSourceLabel === 'function'
    ? getFlyerSourceLabel(data && data._flyerSource)
    : 'Unavailable';
  const debugBanner = canShowDebug
    ? `<div class="flyer-source-note">Flyer source: ${sourceLabel}</div>`
    : '';

  if (!data.flyer) {
    el.flyerPanel.innerHTML = `
      ${debugBanner}
      <div class="empty-state">Flyer content coming soon.</div>
    `;
    return;
  }

  const flyer = data.flyer;
  const flyerMarkup = isCovhFlyer(flyer, data)
    ? renderCovhPamphlet(flyer)
    : `
      <div class="flyer-preview-shell">
        ${(flyer.pageFlow || []).map((page, index) => renderFlyerPage(page, flyer, index)).join('')}
      </div>
    `;

  el.flyerPanel.innerHTML = `
    ${debugBanner}
    ${flyerActionsMarkup()}
    ${flyerMarkup}
  `;

  bindMapHotspots(el.flyerPanel, data);
  setupFlyerActions();
}

function setupTabs() {
  const tabs = document.querySelectorAll('[data-tab]');
  const panels = document.querySelectorAll('.tab-panel');
  const allowedTabs = state.eventData?.tabs || [];

  tabs.forEach(tab => {
    const name = tab.dataset.tab;
    const isAllowed = !allowedTabs.length || allowedTabs.includes(name);
    const tabContainer = tab.closest('li') || tab;

    tabContainer.style.display = isAllowed ? '' : 'none';
    tab.classList.remove('active');
  });

  panels.forEach(panel => {
    const name = panel.id;
    const isAllowed = !allowedTabs.length || allowedTabs.includes(name);
    panel.style.display = isAllowed ? '' : 'none';
    panel.classList.remove('active');
  });

  tabs.forEach(tab => {
    tab.onclick = () => {
      const name = tab.dataset.tab;
      const isAllowed = !allowedTabs.length || allowedTabs.includes(name);
      if (!isAllowed) return;

      tabs.forEach(t => t.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));

      tab.classList.add('active');

      const panel = document.getElementById(name);
      if (panel) {
        panel.classList.add('active');
      }
    };
  });

  const firstVisibleTab = Array.from(tabs).find(tab => {
    const tabContainer = tab.closest('li') || tab;
    return tabContainer.style.display !== 'none';
  });

  if (firstVisibleTab) {
    firstVisibleTab.click();
  }
}

function openScheduleFromHash() {
  const hash = window.location.hash?.replace('#', '');
  if (!hash || !state.eventData?.schedule?.length) return;
  const item = state.eventData.schedule.find(entry => entry.id === hash);
  if (!item) return;

  if (item.dayId) {
    state.selectedDate = item.dayId;
    renderDayFilter(state.eventData);
    renderSchedule(state.eventData);
  }

  const location = getLocationById(item.locationId);
  const vendorText = item.vendorIds?.length
    ? state.eventData.vendors.filter(v => item.vendorIds.includes(v.id)).map(v => v.name).join(', ')
    : 'No linked vendors';

  setTimeout(() => {
    document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    openModal(
      'Schedule Item',
      item.title,
      `
        <p><strong>Time:</strong> ${formatTimeRange(item.startTime, item.endTime)}</p>
        <p><strong>Location:</strong> ${location?.name || 'TBD'}</p>
        <p><strong>Category:</strong> ${item.category}</p>
        <p>${item.description}</p>
        <p><strong>Linked Vendors:</strong> ${vendorText}</p>
      `
    );
  }, 60);
}

function mapDayRow(row) {
  const raw = row.raw || {};
  return {
    ...raw,
    id: row.external_id,
    label: row.label,
    date: row.event_date
  };
}

function mapLocationRow(row) {
  const raw = row.raw || {};
  return {
    ...raw,
    id: row.external_id,
    name: row.name,
    address: row.address,
    mapX: row.map_x,
    mapY: row.map_y,
    description: row.description,
    notes: row.notes,
    directionsText: row.directions_text,
    pinIcon: row.pin_icon,
    hours: row.hours,
    tags: Array.isArray(row.tags) ? row.tags : [],
    multiVendor: !!row.multi_vendor,
    group: row.location_group
  };
}

function mapScheduleRow(row) {
  const raw = row.raw || {};
  return {
    ...raw,
    id: row.external_id,
    dayId: row.day_external_id,
    title: row.title,
    startTime: row.start_time,
    endTime: row.end_time,
    locationId: row.location_external_id,
    category: row.category,
    description: row.description,
    vendorIds: Array.isArray(row.vendor_ids) ? row.vendor_ids : [],
    date: row.event_date
  };
}

function mapVendorRow(row) {
  const raw = row.raw || {};
  return {
    ...raw,
    id: row.external_id,
    name: row.name,
    locationId: row.location_external_id,
    category: row.category,
    description: row.description,
    booth: row.booth,
    hours: row.hours
  };
}

function buildEventData(pageRow, dayRows, locationRows, scheduleRows, vendorRows) {
  const raw = pageRow.raw || {};
  return {
    ...raw,
    eventName: pageRow.event_name,
    eventType: pageRow.event_type,
    summary: pageRow.summary,
    dateLabel: pageRow.date_label,
    areaLabel: pageRow.area_label,
    category: pageRow.category,
    tabs: Array.isArray(pageRow.tabs) ? pageRow.tabs : (raw.tabs || []),
    dates: Array.isArray(pageRow.dates) ? pageRow.dates : (raw.dates || []),
    theme: pageRow.theme ?? raw.theme,
    featuredBranding: pageRow.featured_branding ?? raw.featuredBranding,
    flyer: pageRow.flyer ?? raw.flyer,
    resources: Array.isArray(pageRow.resources) ? pageRow.resources : (raw.resources || []),
    days: dayRows.map(mapDayRow),
    locations: locationRows.map(mapLocationRow),
    schedule: scheduleRows.map(mapScheduleRow),
    vendors: vendorRows.map(mapVendorRow)
  };
}

function resolveRelativeDataPath(baseFile, relativePath) {
  if (!baseFile || !relativePath) return relativePath || '';
  if (/^https?:\/\//i.test(relativePath) || relativePath.startsWith('/')) return relativePath;

  const normalizedBase = String(baseFile).replace(/\\/g, '/');
  const baseDir = normalizedBase.includes('/')
    ? normalizedBase.slice(0, normalizedBase.lastIndexOf('/') + 1)
    : '';

  return `${baseDir}${relativePath}`;
}

function shouldShowFlyerDebug() {
  const params = new URLSearchParams(window.location.search);
  return params.get('flyerDebug') === '1' || params.get('debug') === '1';
}

function getFlyerSourceLabel(source) {
  if (source === 'supabase') return 'Supabase';
  if (source === 'static-fallback') return 'Static fallback';
  return 'Unavailable';
}

function shouldUseStaticFlyerFallback() {
  const params = new URLSearchParams(window.location.search);
  return params.get('useStaticFlyerFallback') === '1';
}

async function loadFlyerFromStaticFallback(filePath) {
  if (!filePath) return null;

  try {
    const eventRes = await fetch(filePath, { cache: 'no-store' });
    if (!eventRes.ok) return null;

    const eventJson = await eventRes.json();
    if (eventJson?.flyer && typeof eventJson.flyer === 'object') {
      return eventJson.flyer;
    }

    const splitFlyerPath = eventJson?._split?.flyer;
    if (!splitFlyerPath) return null;

    const flyerPath = resolveRelativeDataPath(filePath, splitFlyerPath);
    const flyerRes = await fetch(flyerPath, { cache: 'no-store' });
    if (!flyerRes.ok) return null;

    const flyerJson = await flyerRes.json();
    return flyerJson && typeof flyerJson === 'object' ? flyerJson : null;
  } catch (error) {
    console.warn('Static flyer fallback failed to load.', error);
    return null;
  }
}

async function loadEventData(filePath) {
  const pageSlug = getPageSlug();
  if (!supabaseClient || !pageSlug) {
    throw new Error('Supabase client or page slug is missing.');
  }

  const [pageResult, daysResult, locationsResult, scheduleResult, vendorsResult] = await Promise.all([
    supabaseClient.from('event_pages').select('*').eq('slug', pageSlug).single(),
    supabaseClient.from('event_days').select('*').eq('page_slug', pageSlug).order('sort_order', { ascending: true }),
    supabaseClient.from('event_locations').select('*').eq('page_slug', pageSlug).order('sort_order', { ascending: true }),
    supabaseClient.from('event_schedule').select('*').eq('page_slug', pageSlug).order('event_date', { ascending: true }).order('sort_order', { ascending: true }),
    supabaseClient.from('event_vendors').select('*').eq('page_slug', pageSlug).order('name', { ascending: true })
  ]);

  const results = [pageResult, daysResult, locationsResult, scheduleResult];
  const failed = results.find(result => result.error);
  if (failed) {
    throw failed.error;
  }

  const vendorRows = vendorsResult.error
    ? (console.warn('Vendor query failed; continuing with empty vendors.', vendorsResult.error), [])
    : (vendorsResult.data || []);

  const eventData = buildEventData(
    pageResult.data,
    daysResult.data || [],
    locationsResult.data || [],
    scheduleResult.data || [],
    vendorRows
  );

  eventData._flyerSource = eventData.flyer ? 'supabase' : 'missing';

  if (!eventData.flyer && shouldUseStaticFlyerFallback()) {
  if (!eventData.flyer) {
    const fallbackFlyer = await loadFlyerFromStaticFallback(filePath);
    if (fallbackFlyer) {
      eventData.flyer = fallbackFlyer;
      eventData._flyerSource = 'static-fallback';
    }
  }

  return eventData;
}

async function init() {
  try {
    initThemeToggle();
    const data = await loadEventData(eventFile);

    renderHeader(data);
    renderDayFilter(data);
    renderSchedule(data);
    renderMap(data);
    renderVendors(data);
    renderLocations(data);
    renderFlyer(data);
    setupTabs();
	openFlyerFromHash();

    el.closeModal?.addEventListener('click', closeModal);
    el.modal?.addEventListener('click', (event) => {
      if (event.target === el.modal) closeModal();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeModal();
    });

    openScheduleFromHash();
  } catch (error) {
    console.error(error);
    showLoadError('Event data failed to load. If you opened the HTML directly from a ZIP or local folder, start a local web server or use GitHub Pages.');
  }
}

init();
