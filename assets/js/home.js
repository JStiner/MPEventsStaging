const eventSources = [
  { page: 'fall-fest.html', slug: 'fall-fest', bucket: 'Fall Fest' },
  { page: 'second-fridays.html', slug: 'second-fridays', bucket: '2nd Fridays' },
  { page: 'christmas-on-vinegar-hill.html', slug: 'christmas-on-vinegar-hill', bucket: 'COVH' },
  { page: 'community-events.html', slug: 'community-events', bucket: 'Community' },
  { page: 'high-school-events.html', slug: 'high-school-events', bucket: 'School' },
  { page: 'town-services.html', slug: 'town-services', bucket: 'Town Services' }
];
const supabaseClient = window.supabaseClient;

const homeState = {
  view: 'month',
  anchorDate: new Date(),
  events: [],
  datasets: [],
  selectedFilters: new Set(['All']),
  selectedDate: startOfDay(new Date())
};

const homeEl = {
  title: document.getElementById('calendar-title'),
  weekdays: document.getElementById('calendar-weekdays'),
  grid: document.getElementById('calendar-grid'),
  prev: document.getElementById('prev-period'),
  next: document.getElementById('next-period'),
  viewButtons: Array.from(document.querySelectorAll('.view-button')),
  summaryCards: document.getElementById('event-summary-cards'),
  filters: document.getElementById('calendar-filters'),
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
  if (homeEl.themeToggle) {
    homeEl.themeToggle.setAttribute('aria-pressed', String(isDark));
    const label = homeEl.themeToggle.querySelector('.theme-toggle-label');
    if (label) label.textContent = isDark ? 'Light mode' : 'Dark mode';
  }
}

function initThemeToggle() {
  applyTheme(getStoredTheme());
  if (!homeEl.themeToggle) return;
  homeEl.themeToggle.addEventListener('click', () => {
    const nextTheme = document.body.classList.contains('theme-dark') ? 'light' : 'dark';
    applyTheme(nextTheme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch (error) {
      console.warn('Theme preference could not be saved.', error);
    }
  });
}

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

function buildHomeData(pageRow, scheduleRows, locationRows, dayRows) {
  const raw = pageRow.raw || {};
  return {
    ...raw,
    eventName: pageRow.event_name,
    eventType: pageRow.event_type,
    summary: pageRow.summary,
    dateLabel: pageRow.date_label,
    areaLabel: pageRow.area_label,
    days: (dayRows || []).map(day => ({ ...(day.raw || {}), id: day.external_id, label: day.label, date: day.event_date })),
    locations: (locationRows || []).map(loc => ({ ...(loc.raw || {}), id: loc.external_id, name: loc.name })),
    schedule: (scheduleRows || []).map(item => ({
      ...(item.raw || {}),
      id: item.external_id,
      title: item.title,
      category: item.category,
      startTime: item.start_time,
      endTime: item.end_time,
      date: item.event_date,
      dayId: item.day_external_id,
      locationId: item.location_external_id,
      description: item.description,
      vendorIds: Array.isArray(item.vendor_ids) ? item.vendor_ids : []
    }))
  };
}

async function loadSourceData(source) {
  if (!supabaseClient) {
    throw new Error('Supabase client is not available.');
  }

  const [pageResult, scheduleResult, locationResult, dayResult] = await Promise.all([
    supabaseClient.from('event_pages').select('*').eq('slug', source.slug).single(),
    supabaseClient.from('event_schedule').select('*').eq('page_slug', source.slug).order('event_date', { ascending: true }).order('sort_order', { ascending: true }),
    supabaseClient.from('event_locations').select('*').eq('page_slug', source.slug),
    supabaseClient.from('event_days').select('*').eq('page_slug', source.slug).order('sort_order', { ascending: true })
  ]);

  const failed = [pageResult, scheduleResult, locationResult, dayResult].find(result => result.error);
  if (failed) {
    throw failed.error;
  }

  return buildHomeData(pageResult.data, scheduleResult.data || [], locationResult.data || [], dayResult.data || []);
}

function createExpandedDayRow(date, events) {
  const wrapper = document.createElement('section');
  wrapper.className = 'agenda-day-card expanded-day-row';

  wrapper.innerHTML = `
    <div class="agenda-day-header">
      <div>
        <div class="agenda-day-title">${date.toLocaleDateString(undefined, { weekday: 'long' })}</div>
        <div class="agenda-day-subtitle">${date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</div>
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

  wrapper.appendChild(list);
  return wrapper;
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
    showHomeLoadError('Calendar data failed to load from Supabase. Check the browser console for the first query error.');
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

function createMonthDot(event) {
  const dot = document.createElement('span');
  dot.className = `calendar-event-chip bucket-${event.bucket.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  dot.setAttribute('aria-hidden', 'true');
  return dot;
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
  const selectedDate = homeState.selectedDate ? startOfDay(homeState.selectedDate) : null;

  const dayCells = [];
  for (let cursor = new Date(start); cursor <= end; cursor = addDays(cursor, 1)) {
    dayCells.push(new Date(cursor));
  }

  for (let i = 0; i < dayCells.length; i += 7) {
    const weekDays = dayCells.slice(i, i + 7);

    weekDays.forEach(currentDate => {
      const isMuted = currentDate.getMonth() !== anchor.getMonth();
      const isToday = isSameDate(currentDate, new Date());
      const isSelected = selectedDate && isSameDate(currentDate, selectedDate);

      const dayCell = document.createElement('article');
      dayCell.className = `calendar-day-card proper-grid ${isMuted ? 'muted' : ''} ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}`;

      const header = document.createElement('div');
      header.className = 'calendar-day-header';
      header.innerHTML = `<span class="calendar-day-number">${currentDate.getDate()}</span>`;
      dayCell.appendChild(header);

      const list = document.createElement('div');
      list.className = 'calendar-day-events';

      const dayEvents = events.filter(event =>
        isSameDate(new Date(`${event.date}T12:00:00`), currentDate)
      );

      if (!dayEvents.length) {
        const empty = document.createElement('div');
        empty.className = 'calendar-empty';
        empty.textContent = '';
        list.appendChild(empty);
      } else {
        dayEvents.slice(0, 4).forEach(event => list.appendChild(createMonthDot(event)));
        if (dayEvents.length > 4) {
          const more = document.createElement('div');
          more.className = 'more-events-label';
          more.textContent = `+${dayEvents.length - 4} more`;
          list.appendChild(more);
        }
      }

      dayCell.appendChild(list);

      dayCell.addEventListener('click', () => {
        homeState.selectedDate = startOfDay(currentDate);
        renderHome();
      });

      homeEl.grid.appendChild(dayCell);
    });

    const weekHasSelectedDay = selectedDate && weekDays.some(day => isSameDate(day, selectedDate));
    if (weekHasSelectedDay) {
      const selectedEvents = events.filter(event =>
        isSameDate(new Date(`${event.date}T12:00:00`), selectedDate)
      );
      const expandedRow = createExpandedDayRow(selectedDate, selectedEvents);
      expandedRow.style.gridColumn = '1 / -1';
      homeEl.grid.appendChild(expandedRow);
    }
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

initThemeToggle();
initHomeControls();
loadData();
