/** Chronicle — Add/edit/delete events, todos, reminders */

/** Generate a collision-resistant ID */
export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** Return the events array for a date key (never null) */
export function getEvents(data, dateKey) {
  return data.days[dateKey]?.events ?? [];
}

/** Ensure a day entry exists and return it */
function ensureDay(data, dateKey) {
  if (!data.days[dateKey]) {
    data.days[dateKey] = { diary: '', events: [], images: [] };
  }
  return data.days[dateKey];
}

/** Add a new event/todo/reminder to a day; returns the created event */
export function addEvent(data, dateKey, eventData) {
  // If this is a repeating event → store in series instead
  if (eventData.repeat) {
    return addSeries(data, {
      type: eventData.type,
      title: eventData.title,
      time: eventData.time,
      notes: eventData.notes,
      reminderMinutes: eventData.reminderMinutes,
      startDate: dateKey,
      repeat: eventData.repeat,
    });
  }
  const day = ensureDay(data, dateKey);
  const event = {
    id: generateId(),
    type: eventData.type || 'event',
    title: eventData.title,
    time: eventData.time || null,
    done: false,
    repeat: eventData.repeat || null,
    notes: eventData.notes || '',
    created: Date.now(),
    modified: Date.now(),
  };
  day.events.push(event);
  return event;
}

/** Update fields on an existing event; returns the updated event or null */
export function updateEvent(data, dateKey, eventId, updates) {
  const events = data.days[dateKey]?.events;
  if (!events) return null;
  const idx = events.findIndex(e => e.id === eventId);
  if (idx === -1) return null;
  events[idx] = { ...events[idx], ...updates, modified: Date.now() };
  return events[idx];
}

/** Remove an event by ID */
export function deleteEvent(data, dateKey, eventId) {
  if (!data.days[dateKey]?.events) return;
  data.days[dateKey].events = data.days[dateKey].events.filter(e => e.id !== eventId);
}

/** Toggle the done state of a todo */
export function toggleTodo(data, dateKey, eventId) {
  const evt = data.days[dateKey]?.events?.find(e => e.id === eventId);
  if (evt && evt.type === 'todo') {
    evt.done = !evt.done;
    evt.modified = Date.now();
  }
}

export function createRepeatRule(freq, interval = 1, byWeekday = null, endType = 'never', endCount = null, endDate = null) {
  return {
    freq,                    // 'daily' | 'weekly' | 'monthly' | 'yearly'
    interval,                // number
    byWeekday,               // array or null
    end: {
      type: endType,         // 'never' | 'after' | 'on'
      count: endCount,       // number or null
      date: endDate          // 'YYYY-MM-DD' or null
    }
  };
}

export function validateRepeatRule(rule) {
  if (!rule) return false;

  const validFreq = ['daily', 'weekly', 'monthly', 'yearly'];
  if (!validFreq.includes(rule.freq)) return false;

  if (typeof rule.interval !== 'number' || rule.interval < 1) return false;

  if (rule.freq === 'weekly') {
    if (!Array.isArray(rule.byWeekday) || rule.byWeekday.some(d => d < 0 || d > 6)) {
      return false;
    }
  }

  const end = rule.end;
  if (!end || !['never', 'after', 'on'].includes(end.type)) return false;

  if (end.type === 'after' && (typeof end.count !== 'number' || end.count < 1)) {
    return false;
  }

  if (end.type === 'on' && !/^\d{4}-\d{2}-\d{2}$/.test(end.date)) {
    return false;
  }

  return true;
}

export function addSeries(data, seriesData) {
  const series = {
    id: generateId(),
    type: seriesData.type || 'event',
    title: seriesData.title,
    time: seriesData.time || null,
    startDate: seriesData.startDate,     // YYYY-MM-DD
    repeat: seriesData.repeat,           // validated repeat rule
    notes: seriesData.notes || '',
    reminderMinutes: seriesData.reminderMinutes ?? null,
    exceptions: {},                      // dateKey → override or null
    created: Date.now(),
    modified: Date.now(),
  };

  data.series.push(series);
  return series;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function addMonths(date, n) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
}

function addYears(date, n) {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + n);
  return d;
}

export function generateOccurrencesForSeries(series, dateKey) {
  const start = parseDate(series.startDate);
  const target = parseDate(dateKey);

  // Too early
  if (target < start) return null;

  const rule = series.repeat;

  // End by date
  if (rule.end.type === 'on' && dateKey > rule.end.date) return null;

  // NOTE: we temporarily ignore end.type === 'after' here
  // to avoid recursion issues. We'll add it back safely later.

  // Exceptions
  if (series.exceptions[dateKey] === null) return null; // skipped
  if (series.exceptions[dateKey]) return series.exceptions[dateKey]; // modified

  switch (rule.freq) {
    case 'daily':
      return occursDaily(series, start, target, rule, dateKey);

    case 'weekly':
      return occursWeekly(series, start, target, rule, dateKey);

    case 'monthly':
      return occursMonthly(series, start, target, rule, dateKey);

    case 'yearly':
      return occursYearly(series, start, target, rule, dateKey);
  }

  return null;
}



function occursDaily(series, start, target, rule, dateKey) {
  const diff = Math.floor((target - start) / 86400000);
  if (diff % rule.interval !== 0) return null;

  return buildOccurrence(series, dateKey);
}

function occursWeekly(series, start, target, rule, dateKey) {
  const diff = Math.floor((target - start) / 86400000);
  const weeks = Math.floor(diff / 7);

  if (weeks % rule.interval !== 0) return null;

  const weekday = target.getDay();
  if (!rule.byWeekday.includes(weekday)) return null;

  return buildOccurrence(series, dateKey);
}

function occursMonthly(series, start, target, rule, dateKey) {
  const months =
    (target.getFullYear() - start.getFullYear()) * 12 +
    (target.getMonth() - start.getMonth());

  if (months < 0 || months % rule.interval !== 0) return null;

  if (target.getDate() !== start.getDate()) return null;

  return buildOccurrence(series, dateKey);
}

function occursYearly(series, start, target, rule, dateKey) {
  const years = target.getFullYear() - start.getFullYear();

  if (years < 0 || years % rule.interval !== 0) return null;

  if (
    target.getMonth() !== start.getMonth() ||
    target.getDate() !== start.getDate()
  ) return null;

  return buildOccurrence(series, dateKey);
}

function buildOccurrence(series, dateKey) {
  return {
    id: series.id,               // same ID as series
    seriesId: series.id,
    type: series.type,
    title: series.title,
    time: series.time,
    notes: series.notes,
    reminderMinutes: series.reminderMinutes,
    date: dateKey,
    isOccurrence: true
  };
}

function parseDate(dateStr) {
  // Expects YYYY-MM-DD
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function getEventsForDate(data, dateKey) {
  const normal = getEvents(data, dateKey) || [];

  const repeats = data.series
    .map(series => generateOccurrencesForSeries(series, dateKey))
    .filter(x => x !== null);

  const all = [...normal, ...repeats];

  // Sort by time
  all.sort((a, b) => {
    if (!a.time && !b.time) return 0;
    if (!a.time) return 1;
    if (!b.time) return -1;
    return a.time.localeCompare(b.time);
  });

  return all;
}


export function getAllDatesForSeries(data, seriesId){
  const dates = [];
  for (const dateKey in data.days) {
    const events = getEventsForDate(data, dateKey);
    if (events.some(ev => ev.seriesId === seriesId)) {
      dates.push(dateKey);
    }
  }
  return dates;
}


