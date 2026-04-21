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
