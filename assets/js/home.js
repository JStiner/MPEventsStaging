const eventSources = [
  { file: 'data/fallfest/fall-fest-2026.json', page: 'fall-fest.html', slug: 'fall-fest', bucket: 'Fall Fest' },
  { file: 'data/2ndfriday/second-fridays-2026.json', page: 'second-fridays.html', slug: 'second-fridays', bucket: '2nd Fridays' },
  { file: 'data/covh/event.json', page: 'christmas-on-vinegar-hill.html', slug: 'christmas-on-vinegar-hill', bucket: 'COVH' },
  { file: 'data/community-events/community-events-2026.json', page: 'community-events.html', slug: 'community-events', bucket: 'Community' },
  { file: 'data/high-school-events/high-school-events-2026.json', page: 'high-school-events.html', slug: 'high-school-events', bucket: 'School' },
  { file: 'data/town-services/town-services-2026.json', page: 'town-services.html', slug: 'town-services', bucket: 'Town Services' }
];

const homeState = {
  view: 'month',
  anchorDate: new Date(),
  events: [],
  datasets: [],
  selectedFilters: new Set(['All'])
};

const homeEl = {
  title: document.getElementById('calendar-title'),
  weekdays: document.getElementById('calendar-weekdays'),
  grid: document.getElementById('calendar-grid'),
  prev: document.getElementById('prev-period'),
  next: document.getElementById('next-period'),
  viewButtons: Array.from(document.querySelectorAll('.view-button')),
  summaryCards: document.getElementById('event-summary-cards'),
  filters: document.getElementById('calendar-filters')
};

function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function parseEventDate(dateStr, timeStr) {
  const iso = `${dateStr}T${convertTimeTo24(timeStr)}:00`;
  return new Date(iso);
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

function formatDateLabel(date) {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatMonthTitle(date) {
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function formatWeekTitle(start, end) {
  const startLabel = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const endLabel = end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return `${startLabel} – ${endLabel}`;
}

function getStartOfWeek(date) {
  const copy = startOfDay(date);
  const day = copy.getDay();
  copy.setDate(copy.getDate() - day);
  return copy;
}

function getEndOfWeek(date) {
  const copy = getStartOfWeek(date);
  copy.setDate(copy.getDate() + 6);
  return copy;
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function isSameDate(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function inRange(date, start, end) {
  return startOfDay(date) >= startOfDay(start) && startOfDay(date) <= startOfDay(end);
}

function currentFilters() {
  if (homeState.selectedFilters.has('All') || homeState.selectedFilters.size === 0) return null;
  return Array.from(homeState.selectedFilters);
}

function filteredEvents() {
  const filters = currentFilters();
  if (!filters) return homeState.events;
  return homeState.events.filter(event => filters.includes(event.bucket));
}

function showHomeLoadError(message) {
  if (homeEl.grid) {
    homeEl.grid.innerHTML = `<div class="empty-state error-state">${message}</div>`;
  }
}

async function loadSourceData(source) {
  const response = await fetch(source.file);
  if (!response.ok) {
    throw new Error(`Failed to load ${source.file} (${response.status})`);
  }

  const data = await response.json();
  if (!data?._split) return data;

  const basePath = source.file.includes('/') ? source.file.slice(0, source.file.lastIndexOf('/') + 1) : '';
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

async function loadData() {
  let loaded;
  try {
    loaded = await Promise.all(
      eventSources.map(async source => {
        const data = await loadSourceData(source);
        return { source, data };
      })
    );
  } catch (error) {
    console.error(error);
    showHomeLoadError('Calendar data failed to load. If you opened the site directly from a ZIP or local folder, serve it from a local web server or GitHub Pages.');
    return;
  }

  homeState.datasets = loaded;
  homeState.events = loaded.flatMap(({ source, data }) => {
    const dayMap = new Map((data.days || []).map(day => [day.id, day]));
    const firstDate = (data.dates || [])[0] || (data.days || [])[0]?.date;

    return (data.schedule || []).map(item => {
      let actualDate = item.date || dayMap.get(item.dayId)?.date || firstDate;
      if (!actualDate) actualDate = new Date().toISOString().slice(0, 10);
      const location = (data.locations || []).find(loc => loc.id === item.locationId);
      return {
        id: item.id,
        title: item.title,
        category: item.category,
        startTime: item.startTime,
        endTime: item.endTime,
        date: actualDate,
        locationName: location?.name || 'TBD',
        eventName: data.eventName,
        eventType: data.eventType,
        eventPage: source.page,
        sourceFile: source.file,
        pageSlug: source.slug,
        description: item.description,
        bucket: source.bucket
      };
    });
  }).sort((a, b) => parseEventDate(a.date, a.startTime) - parseEventDate(b.date, b.startTime));

  const today = new Date();
  homeState.anchorDate = today;
  renderHome();
}

function renderFilterChips() {
  if (!homeEl.filters) return;
  homeEl.filters.innerHTML = '';
  const filters = ['All', 'Community', 'School', 'Town Services', 'Fall Fest', '2nd Fridays', 'COVH'];

  filters.forEach(name => {
    const btn = document.createElement('button');
    btn.type = 'button';
    const active = homeState.selectedFilters.has(name);
    btn.className = `filter-chip ${active ? 'active' : ''}`;
    btn.textContent = name;
    btn.dataset.filter = name;
    btn.addEventListener('click', () => {
      if (name === 'All') {
        homeState.selectedFilters = new Set(['All']);
      } else {
        homeState.selectedFilters.delete('All');
        if (homeState.selectedFilters.has(name)) {
          homeState.selectedFilters.delete(name);
        } else {
          homeState.selectedFilters.add(name);
        }
        if (homeState.selectedFilters.size === 0) {
          homeState.selectedFilters = new Set(['All']);
        }
      }
      renderHome();
    });
    homeEl.filters.appendChild(btn);
  });
}

function renderWeekdays() {
  homeEl.weekdays.innerHTML = '';
  if (homeState.view !== 'month') {
    homeEl.weekdays.classList.add('hidden');
    return;
  }
  homeEl.weekdays.classList.remove('hidden');
  ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(label => {
    const div = document.createElement('div');
    div.className = 'weekday-pill';
    div.textContent = label;
    homeEl.weekdays.appendChild(div);
  });
}

function periodEvents(start, end) {
  return filteredEvents().filter(event => inRange(new Date(`${event.date}T12:00:00`), start, end));
}

function updateCalendarTitle() {
  const anchor = homeState.anchorDate;
  if (homeState.view === 'month') {
    homeEl.title.textContent = formatMonthTitle(anchor);
  } else if (homeState.view === 'week') {
    const start = getStartOfWeek(anchor);
    const end = getEndOfWeek(anchor);
    homeEl.title.textContent = formatWeekTitle(start, end);
  } else {
    homeEl.title.textContent = anchor.toLocaleDateString(undefined, {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
    });
  }
}

function createEventChip(event) {
  const a = document.createElement('a');
  a.className = `calendar-event-chip bucket-${event.bucket.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  a.href = `${event.eventPage}#${event.id}`;
  a.innerHTML = `
    <span class="event-time">${event.startTime}</span>
    <span class="event-text">${event.title}</span>
  `;
  return a;
}

function renderMonthView() {
  homeEl.grid.className = 'calendar-grid month-grid';
  homeEl.grid.innerHTML = '';

  const anchor = homeState.anchorDate;
  const firstOfMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = getStartOfWeek(firstOfMonth);
  const lastOfMonth = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  const end = getEndOfWeek(lastOfMonth);

  const events = periodEvents(start, end);

  for (let cursor = new Date(start); cursor <= end; cursor = addDays(cursor, 1)) {
    const currentDate = new Date(cursor);
    const isMuted = currentDate.getMonth() !== anchor.getMonth();
    const isToday = isSameDate(currentDate, new Date());
    const dayCell = document.createElement('article');
    dayCell.className = `calendar-day-card proper-grid ${isMuted ? 'muted' : ''} ${isToday ? 'today' : ''}`;

    const header = document.createElement('div');
    header.className = 'calendar-day-header';
    header.innerHTML = `<span class="calendar-day-number">${currentDate.getDate()}</span>`;
    dayCell.appendChild(header);

    const list = document.createElement('div');
    list.className = 'calendar-day-events';

    const dayEvents = events.filter(event => isSameDate(new Date(`${event.date}T12:00:00`), currentDate));
    if (!dayEvents.length) {
      const empty = document.createElement('div');
      empty.className = 'calendar-empty';
      empty.textContent = '';
      list.appendChild(empty);
    } else {
      dayEvents.slice(0, 4).forEach(event => list.appendChild(createEventChip(event)));
      if (dayEvents.length > 4) {
        const more = document.createElement('div');
        more.className = 'more-events-label';
        more.textContent = `+${dayEvents.length - 4} more`;
        list.appendChild(more);
      }
    }

    dayCell.appendChild(list);
    homeEl.grid.appendChild(dayCell);
  }
}

function renderWeekView() {
  homeEl.grid.className = 'calendar-grid stacked-grid';
  homeEl.grid.innerHTML = '';

  const start = getStartOfWeek(homeState.anchorDate);
  const end = getEndOfWeek(homeState.anchorDate);
  const events = periodEvents(start, end);

  for (let cursor = new Date(start); cursor <= end; cursor = addDays(cursor, 1)) {
    const currentDate = new Date(cursor);
    const section = document.createElement('section');
    section.className = `agenda-day-card ${isSameDate(currentDate, new Date()) ? 'today' : ''}`;

    const dayEvents = events.filter(event => isSameDate(new Date(`${event.date}T12:00:00`), currentDate));
    section.innerHTML = `
      <div class="agenda-day-header">
        <div>
          <div class="agenda-day-title">${currentDate.toLocaleDateString(undefined, { weekday: 'long' })}</div>
          <div class="agenda-day-subtitle">${currentDate.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}</div>
        </div>
        <div class="agenda-day-count">${dayEvents.length} event${dayEvents.length === 1 ? '' : 's'}</div>
      </div>
    `;

    const list = document.createElement('div');
    list.className = 'agenda-events';
    if (!dayEvents.length) {
      const empty = document.createElement('div');
      empty.className = 'calendar-empty';
      empty.textContent = 'No events scheduled.';
      list.appendChild(empty);
    } else {
      dayEvents.forEach(event => list.appendChild(createEventChip(event)));
    }
    section.appendChild(list);
    homeEl.grid.appendChild(section);
  }
}

function renderDayView() {
  homeEl.grid.className = 'calendar-grid stacked-grid';
  homeEl.grid.innerHTML = '';

  const currentDate = startOfDay(homeState.anchorDate);
  const events = periodEvents(currentDate, currentDate);
  const section = document.createElement('section');
  section.className = `agenda-day-card solo ${isSameDate(currentDate, new Date()) ? 'today' : ''}`;
  section.innerHTML = `
    <div class="agenda-day-header">
      <div>
        <div class="agenda-day-title">${currentDate.toLocaleDateString(undefined, { weekday: 'long' })}</div>
        <div class="agenda-day-subtitle">${currentDate.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</div>
      </div>
      <div class="agenda-day-count">${events.length} event${events.length === 1 ? '' : 's'}</div>
    </div>
  `;

  const list = document.createElement('div');
  list.className = 'agenda-events';
  if (!events.length) {
    const empty = document.createElement('div');
    empty.className = 'calendar-empty';
    empty.textContent = 'No events scheduled.';
    list.appendChild(empty);
  } else {
    events.forEach(event => list.appendChild(createEventChip(event)));
  }

  section.appendChild(list);
  homeEl.grid.appendChild(section);
}

function renderSummaryCards() {
  homeEl.summaryCards.innerHTML = '';
  homeState.datasets.forEach(({ source, data }) => {
    const count = (data.schedule || []).length;
    const card = document.createElement('a');
    card.className = 'event-launch-card';
    card.href = source.page;
    card.innerHTML = `
      <span class="pill">${source.bucket}</span>
      <h2>${data.eventName}</h2>
      <p>${data.summary}</p>
      <div class="detail-row"><strong>${data.dateLabel}</strong></div>
      <div class="detail-row">${count} scheduled item${count === 1 ? '' : 's'}</div>
    `;
    homeEl.summaryCards.appendChild(card);
  });
}

function renderHome() {
  updateCalendarTitle();
  renderFilterChips();
  renderWeekdays();
  renderSummaryCards();

  if (homeState.view === 'month') renderMonthView();
  else if (homeState.view === 'week') renderWeekView();
  else renderDayView();
}

function shiftPeriod(direction) {
  const multiplier = direction === 'next' ? 1 : -1;
  const nextDate = new Date(homeState.anchorDate);

  if (homeState.view === 'month') nextDate.setMonth(nextDate.getMonth() + multiplier);
  else if (homeState.view === 'week') nextDate.setDate(nextDate.getDate() + (7 * multiplier));
  else nextDate.setDate(nextDate.getDate() + multiplier);

  homeState.anchorDate = nextDate;
  renderHome();
}

function initHomeControls() {
  homeEl.prev.addEventListener('click', () => shiftPeriod('prev'));
  homeEl.next.addEventListener('click', () => shiftPeriod('next'));

  homeEl.viewButtons.forEach(button => {
    button.addEventListener('click', () => {
      homeEl.viewButtons.forEach(btn => btn.classList.remove('active'));
      button.classList.add('active');
      homeState.view = button.dataset.view;
      renderHome();
    });
  });
}

initHomeControls();
loadData();
