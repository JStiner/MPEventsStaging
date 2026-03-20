const eventFile = document.documentElement.dataset.eventFile;

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
  mapPins: document.getElementById('map-pins'),
  mapLocationList: document.getElementById('map-location-list'),
  vendorList: document.getElementById('vendor-list'),
  locationList: document.getElementById('location-list'),
  flyerPanel: document.getElementById('flyer-panel'),
  resourceLinks: document.getElementById('resource-links'),
  modal: document.getElementById('detail-modal'),
  modalKicker: document.getElementById('modal-kicker'),
  modalTitle: document.getElementById('modal-title'),
  modalContent: document.getElementById('modal-content'),
  closeModal: document.getElementById('close-modal')
};

function formatTimeRange(start, end) {
  return `${start} – ${end}`;
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

function openModal(kicker, title, html) {
  el.modalKicker.textContent = kicker;
  el.modalTitle.textContent = title;
  el.modalContent.innerHTML = html;
  el.modal.classList.remove('hidden');
}

function closeModal() {
  el.modal.classList.add('hidden');
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

function renderHeader(data) {
  if (el.eventEyebrow) el.eventEyebrow.textContent = data.eventType || 'Community Event';
  if (el.eventName) el.eventName.textContent = data.eventName;
  if (el.eventSummary) el.eventSummary.textContent = data.summary;
  if (el.eventDates) el.eventDates.textContent = data.dateLabel;
  if (el.eventLocation) el.eventLocation.textContent = data.areaLabel;

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


function renderDayFilter(data) {
  if (!el.dayFilter) return;
  el.dayFilter.innerHTML = '';
  if (!data.days?.length && !(data.schedule || []).length) return;

  state.filterMode = getFilterMode(data);

  if (state.filterMode === 'month') {
    const monthOptions = getMonthOptions(data);
    const today = new Date();
    const defaultMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    const fallbackMonth = monthOptions[0]?.id || defaultMonth;
    state.selectedDate = state.selectedDate || 'all';

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

  state.selectedDate = state.selectedDate || data.days[0].id;

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
      ${badgeMarkup(location.tags)}
      ${renderVendorSection(location, locationVendors)}
      <hr class="modal-divider" />
      <h3>Scheduled items</h3>
      ${eventsHtml}
      <hr class="modal-divider" />
      <p><strong>Directions:</strong> ${location.directionsText || 'Add Google Maps link later.'}</p>
    `
  );
}

function renderMap(data) {
  if (!el.mapPins || !el.mapLocationList) return;
  el.mapPins.innerHTML = '';
  el.mapLocationList.innerHTML = '';

  data.locations.forEach(location => {
    const pin = document.createElement('button');
    pin.type = 'button';
    pin.className = 'map-pin';
    pin.style.left = `${location.mapX}%`;
    pin.style.top = `${location.mapY}%`;
    pin.textContent = location.pinIcon || '📍';
    pin.title = location.name;
    pin.addEventListener('click', () => showLocationModal(location, data));
    el.mapPins.appendChild(pin);

    const card = document.createElement('article');
    card.className = 'item-card';
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

function flyerActionsMarkup() {
  return `
    <div class="flyer-toolbar">
      <button type="button" class="flyer-action" data-flyer-action="share">Share flyer</button>
      <button type="button" class="flyer-action" data-flyer-action="print">Print</button>
      <button type="button" class="flyer-action" data-flyer-action="pdf">Download PDF</button>
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
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <title>${flyer.document?.title || 'Event Flyer'}</title>
      <link rel="stylesheet" href="assets/css/styles.css" />
    </head>
    <body class="flyer-print-page">
      <main class="flyer-print-shell">
        ${(flyer.pageFlow || []).map((page, index) => renderFlyerPage(page, flyer, index)).join('')}
      </main>
    </body>
    </html>
  `;
}

async function shareFlyerLink() {
  const shareData = {
    title: `${state.eventData?.eventName || 'Event'} Flyer`,
    text: 'Printable event flyer',
    url: window.location.href
  };

  if (navigator.share) {
    await navigator.share(shareData);
    return;
  }

  await navigator.clipboard.writeText(window.location.href);
  alert('Flyer link copied.');
}

function openFlyerPrintView(mode = 'print') {
  const flyer = state.eventData?.flyer;
  if (!flyer) return;

  const printWindow = window.open('', '_blank', 'noopener,noreferrer');
  if (!printWindow) return;

  printWindow.document.open();
  printWindow.document.write(buildFlyerPrintDocument(flyer));
  printWindow.document.close();

  const runPrint = () => {
    if (mode === 'print' || mode === 'pdf') {
      printWindow.focus();
      printWindow.print();
    }
  };

  if (printWindow.document.readyState === 'complete') {
    runPrint();
  } else {
    printWindow.addEventListener('load', runPrint, { once: true });
  }
}

function setupFlyerActions() {
  if (!el.flyerPanel) return;
  el.flyerPanel.querySelectorAll('[data-flyer-action]').forEach(button => {
    button.addEventListener('click', async () => {
      const action = button.dataset.flyerAction;

      if (action === 'share') {
        try {
          await shareFlyerLink();
        } catch (error) {
          console.error(error);
        }
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
  if (!data.flyer?.pageFlow?.length) {
    el.flyerPanel.innerHTML = '<div class="empty-state">Flyer content coming soon.</div>';
    return;
  }

  const flyer = data.flyer;

  el.flyerPanel.innerHTML = `
    ${flyerActionsMarkup()}
    <div class="flyer-preview-shell">
      ${(flyer.pageFlow || []).map((page, index) => renderFlyerPage(page, flyer, index)).join('')}
    </div>
  `;

  setupFlyerActions();
}
  
function setupTabs() {
  const tabs = document.querySelectorAll('[data-tab]');
  const panels = document.querySelectorAll('[data-panel]');
  const allowedTabs = state.eventData?.tabs || [];

  // Hide/show tabs
  tabs.forEach(tab => {
    const name = tab.dataset.tab;
    if (!allowedTabs.includes(name)) {
      tab.style.display = 'none';
    } else {
      tab.style.display = '';
    }
  });

  // Hide/show panels
  panels.forEach(panel => {
    const name = panel.dataset.panel;
    if (!allowedTabs.includes(name)) {
      panel.style.display = 'none';
    } else {
      panel.style.display = '';
    }
  });

  // Tab click behavior
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const name = tab.dataset.tab;

      // skip hidden tabs
      if (!allowedTabs.includes(name)) return;

      tabs.forEach(t => t.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));

      tab.classList.add('active');
      const panel = document.querySelector(`[data-panel="${name}"]`);
      if (panel) panel.classList.add('active');
    });
  });

  // Activate first visible tab
  const firstVisible = Array.from(tabs).find(t => t.style.display !== 'none');
  if (firstVisible) firstVisible.click();
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

async function loadEventData(filePath) {
  const response = await fetch(filePath);
  if (!response.ok) {
    throw new Error(`Failed to load ${filePath} (${response.status})`);
  }

  const data = await response.json();
  if (!data?._split) return data;

  const basePath = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/') + 1) : '';
  const entries = await Promise.all(
    Object.entries(data._split).map(async ([key, relativePath]) => {
      const partResponse = await fetch(`${basePath}${relativePath}`);
      if (!partResponse.ok) {
        throw new Error(`Failed to load ${basePath}${relativePath} (${partResponse.status})`);
      }
      return [key, await partResponse.json()];
    })
  );

  return Object.assign({}, data, Object.fromEntries(entries));
}

async function init() {
  if (!eventFile) return;

  try {
    const data = await loadEventData(eventFile);
    state.eventData = data;

    renderHeader(data);
    renderDayFilter(data);
    renderSchedule(data);
    renderMap(data);
    renderVendors(data);
    renderLocations(data);
    renderFlyer(data);
    setupTabs();

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
