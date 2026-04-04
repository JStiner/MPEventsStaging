const eventFile = document.documentElement.dataset.eventFile;
const pageSlug = document.documentElement.dataset.pageSlug;
function getSupabaseClient() {
  return window.supabaseClient;
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

function getCurrentOrNextDayId(data) {
  const days = data.days || [];
  if (!days.length) return null;

  const today = todayYmd();
  const current = days.find(day => day.date === today);
  if (current) return current.date;

  const upcoming = days.find(day => day.date > today);
  if (upcoming) return upcoming.date;

  return days[0].date;
}

function getCurrentOrNextMonthId(data) {
  const months = getMonthOptions(data);
  if (!months.length) return null;
  const today = new Date();
  const currentKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const current = months.find(month => month.id === currentKey);
  if (current) return current.id;
  const upcoming = months.find(month => month.id > currentKey);
  if (upcoming) return upcoming.id;
  return months[0].id;
}

function setSelectedFilterValue(data) {
  state.filterMode = getFilterMode(data);
  if (state.filterMode === 'month') {
    state.selectedDate = state.selectedDate || getCurrentOrNextMonthId(data);
  } else {
    state.selectedDate = state.selectedDate || getCurrentOrNextDayId(data);
  }
}

function getSelectedSchedule(data) {
  const schedule = data.schedule || [];
  if (!state.selectedDate) return schedule;
  if (state.filterMode === 'month') {
    return schedule.filter(item => String(item.date || '').startsWith(state.selectedDate));
  }
  return schedule.filter(item => item.date === state.selectedDate);
}

function formatDateForChip(dateStr) {
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });
}

function renderDayFilter(data) {
  if (!el.dayFilter) return;
  setSelectedFilterValue(data);
  el.dayFilter.innerHTML = '';

  if (state.filterMode === 'month') {
    getMonthOptions(data).forEach(month => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `filter-chip${state.selectedDate === month.id ? ' active' : ''}`;
      button.textContent = month.label;
      button.addEventListener('click', () => {
        state.selectedDate = month.id;
        renderDayFilter(data);
        renderSchedule(data);
      });
      el.dayFilter.appendChild(button);
    });
    return;
  }

  (data.days || []).forEach(day => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `filter-chip${state.selectedDate === day.date ? ' active' : ''}`;
    button.textContent = day.label || formatDateForChip(day.date);
    button.addEventListener('click', () => {
      state.selectedDate = day.date;
      renderDayFilter(data);
      renderSchedule(data);
    });
    el.dayFilter.appendChild(button);
  });
}

function showLocationModal(location, data = state.eventData) {
  const vendors = getVendorsByLocation(location.id, data);
  const schedule = getScheduleByLocation(location.id, data);
  const directionsUrl = getDirectionsUrl(location);
  openModal(
    'Location Details',
    location.name,
    `
      <p><strong>Address:</strong> ${location.address || 'TBD'}</p>
      ${location.hours ? `<p><strong>Hours:</strong> ${location.hours}</p>` : ''}
      ${location.description ? `<p>${location.description}</p>` : ''}
      ${location.notes ? `<p>${location.notes}</p>` : ''}
      <p><a href="${directionsUrl}" target="_blank" rel="noopener">Open in Google Maps</a></p>
      ${vendors.length ? `<p><strong>Vendors:</strong> ${vendors.map(v => v.name).join(', ')}</p>` : ''}
      ${schedule.length ? `<p><strong>Schedule:</strong> ${schedule.map(item => `${formatTimeRange(item.startTime, item.endTime)} ${item.title}`).join('<br>')}</p>` : ''}
    `
  );
}

function showVendorModal(vendor, data = state.eventData) {
  const location = getLocationById(vendor.locationId, data);
  openModal(
    'Vendor Details',
    vendor.name,
    `
      ${vendor.category ? `<p><strong>Category:</strong> ${vendor.category}</p>` : ''}
      ${vendor.booth ? `<p><strong>Booth:</strong> ${vendor.booth}</p>` : ''}
      ${vendor.hours ? `<p><strong>Hours:</strong> ${vendor.hours}</p>` : ''}
      ${location ? `<p><strong>Location:</strong> ${location.name}</p>` : ''}
      ${vendor.description ? `<p>${vendor.description}</p>` : ''}
    `
  );
}

function renderSchedule(data) {
  if (!el.scheduleList) return;
  const schedule = getSelectedSchedule(data);
  el.scheduleList.innerHTML = '';

  if (!schedule.length) {
    el.scheduleList.innerHTML = '<div class="empty-state">No schedule items are available for this selection.</div>';
    return;
  }

  schedule.forEach(item => {
    const card = document.createElement('article');
    card.className = 'schedule-card';
    card.id = `schedule-${item.id}`;
    const location = getLocationById(item.locationId, data);
    card.innerHTML = `
      <div class="schedule-time">${formatTimeRange(item.startTime, item.endTime)}</div>
      <div>
        <h4>${item.title}</h4>
        <p>${location?.name || 'Location TBD'}</p>
        ${item.description ? `<p>${item.description}</p>` : ''}
      </div>
      <div class="schedule-actions">
        <button type="button" class="secondary-button">Details</button>
      </div>
    `;

    card.querySelector('button')?.addEventListener('click', () => {
      const vendorText = item.vendorIds?.length
        ? data.vendors.filter(v => item.vendorIds.includes(v.id)).map(v => v.name).join(', ')
        : 'No linked vendors';
      openModal(
        'Schedule Item',
        item.title,
        `
          <p><strong>Time:</strong> ${formatTimeRange(item.startTime, item.endTime)}</p>
          <p><strong>Location:</strong> ${location?.name || 'TBD'}</p>
          <p><strong>Category:</strong> ${item.category || 'General'}</p>
          ${item.description ? `<p>${item.description}</p>` : ''}
          <p><strong>Linked Vendors:</strong> ${vendorText}</p>
        `
      );
    });

    el.scheduleList.appendChild(card);
  });
}

function renderMap(data) {
  if (!el.mapSurface) return;
  el.mapSurface.innerHTML = data.mapImage
    ? `<img src="${data.mapImage}" alt="${data.eventName || 'Event map'}" class="map-image" />`
    : '<div class="empty-state">No map is available for this event yet.</div>';
}

function renderVendors(data) {
  if (!el.vendorList) return;
  const vendors = data.vendors || [];
  el.vendorList.innerHTML = vendors.length
    ? vendors.map(vendor => `
        <article class="vendor-card">
          <div>
            <h4>${vendor.name}</h4>
            ${vendor.category ? `<p>${vendor.category}</p>` : ''}
            ${vendor.description ? `<p>${vendor.description}</p>` : ''}
          </div>
        </article>
      `).join('')
    : '<div class="empty-state">No vendors are listed yet.</div>';
}

function renderLocations(data) {
  if (!el.locationList) return;
  const locations = data.locations || [];
  el.locationList.innerHTML = locations.length
    ? locations.map(location => `
        <article class="location-card" id="${getLocationCardId(location.id)}">
          <div>
            <h4>${location.name}</h4>
            <p>${location.address || 'Address coming soon.'}</p>
            ${location.description ? `<p>${location.description}</p>` : ''}
            ${badgeMarkup(location.tags)}
          </div>
        </article>
      `).join('')
    : '<div class="empty-state">No locations are listed yet.</div>';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderFlyerBadges(entry) {
  const badges = Array.isArray(entry?.badges) ? entry.badges : [];
  if (!badges.length) return '';
  return `<span class="covh-item-badges">${badges.map(b => `<span class="covh-inline-badge">${escapeHtml(b)}</span>`).join('')}</span>`;
}

function renderCovhEntry(entry, bagIcon) {
  const bagMarkup = entry?.bagLocation
    ? `<img class="covh-bag-icon covh-inline-bag-icon covh-title-bag-icon" src="${escapeHtml(bagIcon || '')}" alt="Bag location">`
    : '';

  return `
    <article class="covh-list-item">
      <div class="covh-item-head">
        <div class="covh-item-title-line">
          ${entry?.entry_code || entry?.number ? `<span class="covh-item-number">${escapeHtml(entry.entry_code || entry.number)}</span>` : ''}
          <h4>${escapeHtml(entry?.name || 'Untitled')}</h4>
          ${bagMarkup}
        </div>
        ${entry?.hours ? `<div class="covh-item-hours">(${escapeHtml(entry.hours)})</div>` : ''}
      </div>
      <div class="covh-item-meta">
        ${renderFlyerBadges(entry)}
        ${entry?.address ? `<span class="covh-item-address">${escapeHtml(entry.address)}</span>` : ''}
      </div>
      ${entry?.description ? `<p>${escapeHtml(entry.description)}</p>` : ''}
    </article>
  `;
}

function renderCovhRegionalBlock(block, maps = {}) {
  const entries = Array.isArray(block?.entries) ? block.entries : [];
  const mapSrc = block?.mapKey ? maps[block.mapKey] : '';
  return `
    <section class="covh-regional-block">
      <div class="covh-regional-title">${escapeHtml(block?.title || '')}</div>
      ${mapSrc ? `<img class="flyer-mini-map" src="${escapeHtml(mapSrc)}" alt="${escapeHtml(block?.title || 'Regional map')}">` : ''}
      <div class="covh-regional-wrap">
        ${entries.map(entry => `
          <article class="covh-regional-item">
            <div class="covh-regional-head">
              <div class="covh-item-title-line">
                ${entry?.entry_code || entry?.number ? `<span class="covh-item-number">${escapeHtml(entry.entry_code || entry.number)}</span>` : ''}
                <h4 class="covh-regional-name">${escapeHtml(entry?.name || 'Untitled')}</h4>
              </div>
              ${entry?.hours ? `<div class="covh-regional-hours">${escapeHtml(entry.hours)}</div>` : ''}
            </div>
            <div class="covh-regional-meta">${entry?.address ? `<span>${escapeHtml(entry.address)}</span>` : ''}</div>
            ${entry?.description ? `<p>${escapeHtml(entry.description)}</p>` : ''}
          </article>
        `).join('')}
      </div>
    </section>
  `;
}

function renderCovhFlyer(data, flyer) {
  const sections = flyer.sections || {};
  const sectionList = Array.isArray(sections) ? sections : Object.values(sections);
  const legend = Array.isArray(flyer.legend) ? flyer.legend : [];
  const assets = flyer.assets || {};
  const maps = assets.maps || {};
  const callouts = flyer.callouts || {};
  const bagIcon = assets.bagIcon || '';

  const mtPulaskiSections = sectionList.filter(section =>
    /mt\.?\s*pulaski/i.test(String(section?.title || ''))
  );
  const regionalEntriesSection = sectionList.find(section =>
    /regional/i.test(String(section?.title || ''))
  );
  const regionalBlockSection = sectionList.find(section =>
    Array.isArray(section?.blocks) && section.blocks.length
  );

  const pageOneTopLeft =
    sections['mt-pulaski-a'] || mtPulaskiSections[0] || sectionList[0] || null;

  const pageOneBottomLeft =
    sections['mt-pulaski-b'] || mtPulaskiSections[1] || sectionList[1] || null;

  const pageOneTopRight =
    sections['mt-pulaski-c'] || mtPulaskiSections[2] || sectionList[2] || null;

  const regional =
    sections['regional'] ||
    regionalBlockSection ||
    regionalEntriesSection ||
    sectionList.find(section =>
      /chestnut|elkhart|latham/i.test(String(section?.title || ''))
    ) ||
    null;

  const derivedRegionalBlocks =
    !Array.isArray(regional?.blocks) || !regional.blocks.length
      ? [
          {
            title: 'Chestnut',
            mapKey: 'chestnut',
            entries: (regional?.entries || []).filter(entry =>
              String(entry?.entry_code || entry?.number || '')
                .toUpperCase()
                .startsWith('C')
            )
          },
          {
            title: 'Elkhart',
            mapKey: 'elkhart',
            entries: (regional?.entries || []).filter(entry =>
              String(entry?.entry_code || entry?.number || '')
                .toUpperCase()
                .startsWith('E')
            )
          },
          {
            title: 'Latham',
            mapKey: 'latham',
            entries: (regional?.entries || []).filter(entry =>
              String(entry?.entry_code || entry?.number || '')
                .toUpperCase()
                .startsWith('L')
            )
          }
        ].filter(block => block.entries.length)
      : regional.blocks;

  const headerGraphic = assets.headerGraphic || '';
  const mainMap = maps.mtPulaski || '';

  return `
    <div class="flyer-preview-shell covh-preview-shell">
      <article class="flyer-page covh-pamphlet-page">
        <div class="flyer-page-inner covh-page-inner">
          <header class="covh-banner">
            <div class="covh-banner-overlay">
              ${
                headerGraphic
                  ? `<div class="covh-banner-strip-overlay">
                      <img
                        class="covh-banner-strip-image-wide"
                        src="${escapeHtml(headerGraphic)}"
                        alt="${escapeHtml(flyer.document?.title || data.eventName || 'Flyer header')}"
                      >
                    </div>`
                  : ''
              }
              <div class="covh-banner-copy covh-banner-copy-overlay">
                ${
                  flyer.document?.eyebrow
                    ? `<div class="covh-banner-date">${escapeHtml(flyer.document.eyebrow)}</div>`
                    : ''
                }
                <div class="covh-banner-title">${escapeHtml(flyer.document?.title || data.eventName || 'Christmas on Vinegar Hill')}</div>
                ${
                  flyer.document?.subtitle
                    ? `<div class="covh-banner-note">${escapeHtml(flyer.document.subtitle)}</div>`
                    : ''
                }
              </div>
            </div>
          </header>

          <section class="covh-page-one-grid covh-page-one-grid-stacked">
            <div class="covh-column covh-column-stacked">
              ${
                pageOneTopLeft
                  ? `
                    <section class="covh-page-one-block">
					  ${(pageOneTopLeft.entries || []).map(entry => renderCovhEntry(entry, bagIcon)).join('')}
					</section>
                  `
                  : ''
              }

              ${
                pageOneBottomLeft
                  ? `
                   <section class="covh-page-one-block">
					  ${(pageOneBottomLeft.entries || []).map(entry => renderCovhEntry(entry, bagIcon)).join('')}
					</section>
                  `
                  : ''
              }
            </div>

            <aside class="covh-key-card">
              <div class="covh-key-title">Key</div>
              ${legend
                .map(
                  item => `
                    <div class="covh-key-row">
                      <div class="covh-key-label">${escapeHtml(item.label || '')}</div>
                      <div>${escapeHtml(item.meaning || '')}</div>
                    </div>
                  `
                )
                .join('')}
            
            </aside>

            <div class="covh-column covh-column-stacked">
              ${
                pageOneTopRight
                  ? `
                   <section class="covh-page-one-block">
					  ${(pageOneTopRight.entries || []).map(entry => renderCovhEntry(entry, bagIcon)).join('')}
					</section>
                  `
                  : ''
              }

              ${
                regional
                  ? `
                    <section class="covh-page-one-block covh-page-one-regional-block">
                      <div class="covh-regional-title">${escapeHtml(regional.title || '')}</div>
                      ${(regional.entries || []).map(entry => renderCovhEntry(entry, bagIcon)).join('')}
                    </section>
                  `
                  : ''
              }
			  
			    ${
                callouts.bagNotice
                  ? `
                    <div class="covh-bag-callout">
                      ${
                        bagIcon
                          ? `<img class="covh-bag-icon covh-callout-bag-icon" src="${escapeHtml(bagIcon)}" alt="Bag icon">`
                          : '<span class="covh-bag-text-symbol">Bag</span>'
                      }
                      ${escapeHtml(callouts.bagNotice)}
                    </div>
                  `
                  : ''
              }
            </div>
          </section>
        </div>
      </article>

      <article class="flyer-page covh-pamphlet-page">
        <div class="flyer-page-inner covh-page-inner">
          <section class="covh-map-layout">
            <div class="covh-map-main-card">
              <div class="covh-map-tag">Mt. Pulaski</div>
              ${mainMap ? `<img class="covh-main-map" src="${escapeHtml(mainMap)}" alt="Mt. Pulaski map">` : ''}
            </div>
            <div class="covh-map-stack">
              ${derivedRegionalBlocks.map(block => renderCovhRegionalBlock(block, maps)).join('')}
            </div>
          </section>

          <section class="covh-footer-layout">
            <div class="covh-thanks-block">
              ${callouts.thankYouTitle ? `<div class="covh-script-heading">${escapeHtml(callouts.thankYouTitle)}</div>` : ''}
              ${callouts.thankYouText ? `<p>${escapeHtml(callouts.thankYouText)}</p>` : ''}
              ${
                Array.isArray(callouts.benefactors)
                  ? `<ul class="covh-benefactor-list">${callouts.benefactors.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
                  : ''
              }
            </div>
            <div class="covh-qr-block">
              ${callouts.scanText ? `<div class="covh-qr-title">${escapeHtml(callouts.scanText)}</div>` : ''}
              ${assets.qrMap ? `<img class="covh-qr-image" src="${escapeHtml(assets.qrMap)}" alt="QR code map">` : ''}
            </div>
            <div class="covh-art-block">
              ${assets.treeSign ? `<img class="covh-art-image" src="${escapeHtml(assets.treeSign)}" alt="Tree sign">` : ''}
              ${
                Array.isArray(callouts.footer)
                  ? `<div class="covh-footer-lines">${callouts.footer.map(line => `<div>${escapeHtml(line)}</div>`).join('')}</div>`
                  : ''
              }
            </div>
            <div class="covh-sponsor-block">
              ${callouts.sponsorsTitle ? `<div class="covh-script-heading">${escapeHtml(callouts.sponsorsTitle)}</div>` : ''}
              ${
                Array.isArray(callouts.sponsors)
                  ? `<ul class="covh-sponsor-list">${callouts.sponsors.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
                  : ''
              }
            </div>
          </section>
        </div>
      </article>
    </div>
  `;
}

function renderFlyer(data) {
  if (!el.flyerPanel) return;
  const flyer = data.flyer;
  if (!flyer) {
    el.flyerPanel.innerHTML = '<div class="empty-state">No printable flyer has been configured yet.</div>';
    return;
  }

  const escape = escapeHtml;

  if ((pageSlug || eventFile) === 'christmas-on-vinegar-hill') {
    el.flyerPanel.innerHTML = renderCovhFlyer(data, flyer);
    return;
  }

  const renderMetaLine = (entry) => {
    const parts = [entry?.address, entry?.hours].filter(Boolean);
    return parts.length ? `<p class="flyer-meta">${escape(parts.join(' • '))}</p>` : '';
  };

  const renderEntry = (entry, compact = false) => `
    <article class="flyer-entry${compact ? ' compact' : ''}">
      <div class="flyer-entry-top">
        ${entry?.entry_code || entry?.number ? `<span class="flyer-number">${escape(entry.entry_code || entry.number)}</span>` : ''}
        <div class="flyer-name-block">
          <h4>${escape(entry?.name || 'Untitled')}</h4>
          ${renderMetaLine(entry)}
        </div>
      </div>
      ${entry?.description ? `<p>${escape(entry.description)}</p>` : ''}
    </article>
  `;

  const renderBlock = (block) => {
    if (!block || typeof block !== 'object') return '';
    const title = block.title || block.heading || '';
    const items = Array.isArray(block.items) ? block.items : [];
    const lines = Array.isArray(block.lines) ? block.lines : [];
    const entries = Array.isArray(block.entries) ? block.entries : [];
    return `
      <article class="flyer-note-card">
        ${title ? `<h3>${escape(title)}</h3>` : ''}
        ${items.length ? `<div class="flyer-list">${items.map(item => `<div>${escape(item)}</div>`).join('')}</div>` : ''}
        ${entries.length ? `<div class="flyer-entry-list compact">${entries.map(entry => renderEntry(entry, true)).join('')}</div>` : ''}
        ${lines.length ? `<div class="flyer-footer-lines">${lines.map(line => `<div>${escape(line)}</div>`).join('')}</div>` : ''}
      </article>
    `;
  };

  const renderSection = (sectionKey) => {
    const section = flyer.sections?.[sectionKey];
    if (!section) return '';

    const hasEntries = Array.isArray(section.entries) && section.entries.length;
    const hasBlocks = Array.isArray(section.blocks) && section.blocks.length;
    if (!hasEntries && !hasBlocks) return '';

    return `
      <section class="flyer-section">
        <h3 class="flyer-section-heading">${escape(section.title || 'Section')}</h3>
        ${hasEntries ? `<div class="flyer-entry-list${section.entries.length > 7 ? ' compact' : ''}">${section.entries.map(entry => renderEntry(entry, section.entries.length > 7)).join('')}</div>` : ''}
        ${hasBlocks ? `<div class="flyer-callout-grid">${section.blocks.map(renderBlock).join('')}</div>` : ''}
      </section>
    `;
  };

  const legend = Array.isArray(flyer.legend) ? flyer.legend : [];
  const pageFlow = Array.isArray(flyer.pageFlow) ? flyer.pageFlow : [];
  const sponsors = Array.isArray(flyer.callouts?.sponsors) ? flyer.callouts.sponsors : [];
  const footer = Array.isArray(flyer.callouts?.footer) ? flyer.callouts.footer : [];

  const pagesMarkup = pageFlow.length
    ? pageFlow.map((page, index) => `
        <article class="flyer-page">
          <div class="flyer-page-inner">
            <header class="flyer-page-header">
              <div class="flyer-title-wrap">
                <p class="eyebrow">${escape(flyer.document?.eyebrow || 'Printable flyer')}</p>
                <h2>${escape(flyer.document?.title || data.eventName || 'Event Flyer')}</h2>
                ${flyer.document?.subtitle ? `<p class="subtle">${escape(flyer.document.subtitle)}</p>` : ''}
              </div>
              ${legend.length && index === 0 ? `
                <div class="flyer-legend">
                  ${legend.map(item => `<div>${escape(item.label || item.code || '')}${item.meaning ? ` — ${escape(item.meaning)}` : ''}</div>`).join('')}
                </div>
              ` : ''}
            </header>
            <div class="flyer-page-columns${index === 1 ? ' page-two' : ''}">
              <div class="flyer-column">${renderSection(page.leftSection)}</div>
              <div class="flyer-column">${page.rightSection ? renderSection(page.rightSection) : ''}</div>
            </div>
            ${(sponsors.length || footer.length) && index === pageFlow.length - 1 ? `
              <section class="flyer-note-card">
                ${sponsors.length ? `<h3>Sponsors</h3><div class="flyer-list">${sponsors.map(item => `<div>${escape(item)}</div>`).join('')}</div>` : ''}
                ${footer.length ? `<div class="flyer-footer-lines">${footer.map(item => `<div>${escape(item)}</div>`).join('')}</div>` : ''}
              </section>
            ` : ''}
          </div>
        </article>
      `).join('')
    : '<div class="empty-state">Flyer layout is not configured yet.</div>';

  el.flyerPanel.innerHTML = `<div class="flyer-preview-shell">${pagesMarkup}</div>`;
}

function setupTabs() {
  const buttons = document.querySelectorAll('[data-tab]');
  const panels = document.querySelectorAll('[data-panel], .tab-panel');
  if (!buttons.length || !panels.length) return;

  const openTab = tab => {
    buttons.forEach(button => button.classList.toggle('active', button.dataset.tab === tab));
    panels.forEach(panel => {
      const panelKey = panel.dataset.panel || panel.id;
      const isActive = panelKey === tab;
      panel.classList.toggle('active', isActive);
      panel.classList.toggle('hidden', !isActive && panel.hasAttribute('data-panel'));
    });
  };

  buttons.forEach(button => {
    button.addEventListener('click', () => openTab(button.dataset.tab));
  });

  const active = Array.from(buttons).find(button => button.classList.contains('active'));
  openTab(active?.dataset.tab || buttons[0].dataset.tab);
}

function openFlyerFromHash() {
  const hash = window.location.hash?.replace('#', '');
  if (!hash) return;

  if (hash === 'flyer' || hash === 'flyer-panel') {
    const flyerTab = document.querySelector('[data-tab="flyer"]');
    flyerTab?.click();

    const flyerTarget = document.getElementById(hash) || document.getElementById('flyer-panel');
    flyerTarget?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function openScheduleFromHash() {
  const hash = window.location.hash?.replace('#', '');
  if (!hash || !hash.startsWith('schedule-')) return;

  const itemId = hash.replace('schedule-', '');
  const item = (state.eventData?.schedule || []).find(entry => String(entry.id) === itemId);
  if (!item) return;

  if (state.filterMode === 'month') {
    state.selectedDate = String(item.date || '').slice(0, 7);
    renderDayFilter(state.eventData);
    renderSchedule(state.eventData);
  } else if (item.date) {
    state.selectedDate = item.date;
    renderDayFilter(state.eventData);
    renderSchedule(state.eventData);
  }
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

function slugifyFlyerSectionKey(value = '') {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeFlyerSection(section, index) {
  const title = section?.title || `Section ${index + 1}`;
  const key = section?.key || slugifyFlyerSectionKey(title) || `section-${index + 1}`;

  return {
    key,
    title,
    entries: Array.isArray(section?.entries) ? section.entries : [],
    blocks: Array.isArray(section?.blocks) ? section.blocks : []
  };
}

function buildDefaultFlyerPageFlow(sectionKeys = []) {
  if (!sectionKeys.length) return [];

  const pages = [];
  for (let i = 0; i < sectionKeys.length; i += 2) {
    pages.push({
      leftSection: sectionKeys[i],
      rightSection: sectionKeys[i + 1] || null
    });
  }

  return pages;
}

function normalizeFlyer(flyer, pageRow = {}, raw = {}) {
  if (!flyer || typeof flyer !== 'object') return null;

  const normalizedSections = {};
  const sourceSections = Array.isArray(flyer.sections)
    ? flyer.sections
    : Object.values(flyer.sections || {});

  sourceSections.forEach((section, index) => {
    const normalized = normalizeFlyerSection(section, index);
    normalizedSections[normalized.key] = normalized;
  });

  const sectionKeys = Object.keys(normalizedSections);

  const title =
    flyer?.document?.title ||
    flyer?.title ||
    pageRow?.event_name ||
    raw?.eventName ||
    'Event Flyer';

  const subtitle =
    flyer?.document?.subtitle ||
    flyer?.subtitle ||
    pageRow?.date_label ||
    raw?.dateLabel ||
    '';

  const eyebrow =
    flyer?.document?.eyebrow ||
    flyer?.eyebrow ||
    'Printable flyer';

  return {
    ...flyer,
    document: {
      eyebrow,
      title,
      subtitle
    },
    legend: Array.isArray(flyer.legend)
      ? flyer.legend
      : Array.isArray(flyer.iconLegend)
        ? flyer.iconLegend
        : [],
    sections: normalizedSections,
    pageFlow: Array.isArray(flyer.pageFlow) && flyer.pageFlow.length
      ? flyer.pageFlow
      : buildDefaultFlyerPageFlow(sectionKeys),
    callouts: {
      ...(flyer.callouts || {}),
      footer: Array.isArray(flyer.callouts?.footer)
        ? flyer.callouts.footer
        : Array.isArray(flyer.footerNotes)
          ? flyer.footerNotes
          : [],
      sponsors: Array.isArray(flyer.callouts?.sponsors)
        ? flyer.callouts.sponsors
        : Array.isArray(flyer.sponsors)
          ? flyer.sponsors
          : []
    }
  };
}

function mapFlyerEntryRow(row) {
  const raw = row.raw || row.raw_payload || {};
  return {
    ...raw,
    entry_code: row.entry_code,
    number: row.entry_code,
    name: row.name,
    address: row.address,
    hours: row.hours,
    description: row.description,
    badges: Array.isArray(row.badges) ? row.badges : [],
    bagLocation: !!(row.bag_location ?? raw.bagLocation ?? raw.bag_location),
    sort_order: row.sort_order
  };
}

function buildFlyerFromTables(pageRow, flyerTables) {
  const raw = pageRow.raw || {};
  const pageFlyer = pageRow.flyer && typeof pageRow.flyer === 'object' ? pageRow.flyer : {};
const rawFlyer = raw.flyer && typeof raw.flyer === 'object' ? raw.flyer : {};

const combinedFlyer = {
  ...rawFlyer,
  ...pageFlyer,
  document: {
    ...(rawFlyer.document || {}),
    ...(pageFlyer.document || {})
  },
  assets: {
    ...(rawFlyer.assets || {}),
    ...(pageFlyer.assets || {})
  },
  callouts: {
    ...(rawFlyer.callouts || {}),
    ...(pageFlyer.callouts || {})
  },
  sections: rawFlyer.sections || pageFlyer.sections,
  pageFlow: pageFlyer.pageFlow || rawFlyer.pageFlow
};

const baseFlyer = normalizeFlyer(combinedFlyer, pageRow, raw) || {};
  const sectionRows = Array.isArray(flyerTables?.sections) ? flyerTables.sections : [];
  const entryRows = Array.isArray(flyerTables?.entries) ? flyerTables.entries : [];
  const legendRows = Array.isArray(flyerTables?.legend) ? flyerTables.legend : [];
  const footerRows = Array.isArray(flyerTables?.footerNotes) ? flyerTables.footerNotes : [];
  const sponsorRows = Array.isArray(flyerTables?.sponsors) ? flyerTables.sponsors : [];

  if (!sectionRows.length && !legendRows.length && !footerRows.length && !sponsorRows.length) {
    return baseFlyer && Object.keys(baseFlyer).length ? baseFlyer : null;
  }

  const baseSectionKeys = Object.keys(baseFlyer.sections || {});
  const entryMap = new Map();
  entryRows.forEach((row) => {
    const key = row.section_id;
    if (!entryMap.has(key)) entryMap.set(key, []);
    entryMap.get(key).push(mapFlyerEntryRow(row));
  });

  const mergedSections = {};
  sectionRows
    .slice()
    .sort((a, b) => (Number(a.sort_order || 0) - Number(b.sort_order || 0)))
    .forEach((sectionRow, index) => {
	const title = sectionRow.section_title || sectionRow.title || `Section ${index + 1}`;

let key = null;

// Special mapping for Christmas on Vinegar Hill flyer layout
if ((pageSlug || eventFile) === 'christmas-on-vinegar-hill') {
  if (title === 'Mt. Pulaski') {
    if (index === 0) key = 'mt-pulaski-a';
    else if (index === 1) key = 'mt-pulaski-b';
    else if (index === 2) key = 'mt-pulaski-c';
  } else if (title === 'Regional Stops') {
    key = 'regional';
  }
}

// Fallback for all other flyers
if (!key) {
  key = slugifyFlyerSectionKey(title) || `section-${index + 1}`;
}
      const baseSection = baseFlyer.sections?.[key] || {};
      const dbEntries = (entryMap.get(sectionRow.id) || []).sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
      const baseEntries = Array.isArray(baseSection.entries) ? baseSection.entries : [];
      const mergedEntries = dbEntries.map((entry, entryIndex) => {
        const baseEntry = baseEntries.find((candidate) => String(candidate.entry_code || candidate.number || '') === String(entry.entry_code || entry.number || '')) || baseEntries[entryIndex] || {};
        return {
          ...baseEntry,
          ...entry,
          badges: Array.isArray(entry.badges) && entry.badges.length ? entry.badges : (Array.isArray(baseEntry.badges) ? baseEntry.badges : []),
          bagLocation: entry.bagLocation || !!baseEntry.bagLocation
        };
      });
      mergedSections[key] = {
        key,
        title,
        entries: mergedEntries,
        blocks: Array.isArray(baseSection.blocks) ? baseSection.blocks : []
      };
    });

  // keep any base sections not represented in DB, e.g. regional block-only sections
Object.entries(baseFlyer.sections || {}).forEach(([key, section]) => {
  if (!mergedSections[key]) {
    mergedSections[key] = {
      ...section,
      key
    };
  }
});

  const legend = legendRows.length
    ? legendRows.slice().sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)).map(item => ({ label: item.label, meaning: item.meaning }))
    : (baseFlyer.legend || []);

  const footer = footerRows.length
    ? footerRows.slice().sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)).map(item => item.note)
    : (baseFlyer.callouts?.footer || []);

  const sponsors = sponsorRows.length
    ? sponsorRows.slice().sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)).map(item => item.sponsor_name)
    : (baseFlyer.callouts?.sponsors || []);

  return {
    ...baseFlyer,
    sections: mergedSections,
    legend,
    pageFlow: Array.isArray(baseFlyer.pageFlow) && baseFlyer.pageFlow.length
      ? baseFlyer.pageFlow
      : buildDefaultFlyerPageFlow(Object.keys(mergedSections)),
    callouts: {
      ...(baseFlyer.callouts || {}),
      footer,
      sponsors
    }
  };
}

function buildEventData(pageRow, dayRows, locationRows, scheduleRows, vendorRows, flyerTables = {}) {
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
    flyer: buildFlyerFromTables(pageRow, flyerTables),
    resources: Array.isArray(pageRow.resources) ? pageRow.resources : (raw.resources || []),
    days: dayRows.map(mapDayRow),
    locations: locationRows.map(mapLocationRow),
    schedule: scheduleRows.map(mapScheduleRow),
    vendors: vendorRows.map(mapVendorRow)
  };
}

async function loadEventData(requestedPageSlug) {
  const effectivePageSlug = requestedPageSlug || pageSlug || eventFile;
  if (!effectivePageSlug) {
    throw new Error('Page slug is required to load event data.');
  }

  const [pageResult, daysResult, locationsResult, scheduleResult, vendorsResult, flyerSectionsResult, flyerEntriesResult, flyerLegendResult, flyerFooterResult, flyerSponsorsResult] = await Promise.all([
    getSupabaseClient().from('event_pages').select('*').eq('slug', effectivePageSlug).single(),
    getSupabaseClient().from('event_days').select('*').eq('page_slug', effectivePageSlug),
    getSupabaseClient().from('event_locations').select('*').eq('page_slug', effectivePageSlug),
    getSupabaseClient().from('event_schedule').select('*').eq('page_slug', effectivePageSlug).or('is_active.is.null,is_active.eq.true'),
    getSupabaseClient().from('event_vendors').select('*').eq('page_slug', effectivePageSlug),
    getSupabaseClient().from('event_flyer_sections').select('*').eq('page_slug', effectivePageSlug),
    getSupabaseClient().from('event_flyer_entries').select('*, event_flyer_sections!inner(page_slug)').eq('event_flyer_sections.page_slug', effectivePageSlug),
    getSupabaseClient().from('event_flyer_legend').select('*').eq('page_slug', effectivePageSlug),
    getSupabaseClient().from('event_flyer_footer_notes').select('*').eq('page_slug', effectivePageSlug),
    getSupabaseClient().from('event_flyer_sponsors').select('*').eq('page_slug', effectivePageSlug)
  ]);

  const results = [pageResult, daysResult, locationsResult, scheduleResult, flyerSectionsResult, flyerEntriesResult, flyerLegendResult, flyerFooterResult, flyerSponsorsResult];
  const failed = results.find(result => result.error);
  if (failed) {
    throw failed.error;
  }

  const dayRows = (daysResult.data || []).slice().sort((a, b) => {
    const aDate = String(a?.event_date || '');
    const bDate = String(b?.event_date || '');
    if (aDate && bDate && aDate !== bDate) return aDate.localeCompare(bDate);
    const aSort = Number.isFinite(Number(a?.sort_order)) ? Number(a.sort_order) : null;
    const bSort = Number.isFinite(Number(b?.sort_order)) ? Number(b.sort_order) : null;
    if (aSort !== null && bSort !== null && aSort !== bSort) return aSort - bSort;
    return String(a?.label || '').localeCompare(String(b?.label || ''));
  });

  const locationRows = (locationsResult.data || []).slice().sort((a, b) => {
    const aSort = Number.isFinite(Number(a?.sort_order)) ? Number(a.sort_order) : null;
    const bSort = Number.isFinite(Number(b?.sort_order)) ? Number(b.sort_order) : null;
    if (aSort !== null && bSort !== null && aSort !== bSort) return aSort - bSort;
    if (aSort !== null && bSort === null) return -1;
    if (aSort === null && bSort !== null) return 1;
    return String(a?.name || '').localeCompare(String(b?.name || ''));
  });

  const scheduleRows = (scheduleResult.data || []).slice().sort((a, b) => {
    const aDate = String(a?.event_date || '');
    const bDate = String(b?.event_date || '');
    if (aDate && bDate && aDate !== bDate) return aDate.localeCompare(bDate);
    const aSort = Number.isFinite(Number(a?.sort_order)) ? Number(a.sort_order) : null;
    const bSort = Number.isFinite(Number(b?.sort_order)) ? Number(b.sort_order) : null;
    if (aSort !== null && bSort !== null && aSort !== bSort) return aSort - bSort;
    return String(a?.start_time || '').localeCompare(String(b?.start_time || ''));
  });

  const vendorRows = vendorsResult.error
    ? (console.warn('Vendor query failed; continuing with empty vendors.', vendorsResult.error), [])
    : (vendorsResult.data || []).slice().sort((a, b) => {
      const aSort = Number.isFinite(Number(a?.sort_order)) ? Number(a.sort_order) : null;
      const bSort = Number.isFinite(Number(b?.sort_order)) ? Number(b.sort_order) : null;
      if (aSort !== null && bSort !== null && aSort !== bSort) return aSort - bSort;
      if (aSort !== null && bSort === null) return -1;
      if (aSort === null && bSort !== null) return 1;
      return String(a?.name || a?.vendor_name || '').localeCompare(String(b?.name || b?.vendor_name || ''));
    });

  return buildEventData(
    pageResult.data,
    dayRows,
    locationRows,
    scheduleRows,
    vendorRows,
    {
      sections: flyerSectionsResult.error ? [] : (flyerSectionsResult.data || []),
      entries: flyerEntriesResult.error ? [] : (flyerEntriesResult.data || []),
      legend: flyerLegendResult.error ? [] : (flyerLegendResult.data || []),
      footerNotes: flyerFooterResult.error ? [] : (flyerFooterResult.data || []),
      sponsors: flyerSponsorsResult.error ? [] : (flyerSponsorsResult.data || [])
    }
  );
}

async function init() {
  if (!eventFile && !pageSlug) return;

  try {
    initThemeToggle();
    const data = await loadEventData(pageSlug || eventFile);

    state.eventData = data;
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
