/** Chronicle — Web Notifications scheduling */

import { generateOccurrencesForSeries } from './events.js';

let _timers = [];

export async function requestNotificationPermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  return Notification.requestPermission();
}

export function scheduleReminders(data) {
  _timers.forEach(id => clearTimeout(id));
  _timers = [];

  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  if (!data.settings.notifications) return;

  const now    = Date.now();
  const cutoff = now + 24 * 60 * 60 * 1000;

  for (const [dateKey, day] of Object.entries(data.days || {})) {
    for (const evt of (day.events || [])) {
      if (evt.reminderMinutes == null || !evt.time) continue;
      _maybeSchedule(evt.title, dateKey, evt.time, evt.reminderMinutes, evt.notes, now, cutoff);
    }
  }

  for (const dateKey of _datesInWindow(now, cutoff)) {
    for (const series of (data.series || [])) {
      if (series.reminderMinutes == null || !series.time) continue;
      const occ = generateOccurrencesForSeries(series, dateKey);
      if (!occ) continue;
      _maybeSchedule(series.title, dateKey, series.time, series.reminderMinutes, series.notes, now, cutoff);
    }
  }
}

function _maybeSchedule(title, dateKey, timeStr, reminderMinutes, notes, now, cutoff) {
  const fireAt = _fireTime(dateKey, timeStr, reminderMinutes);
  if (fireAt <= now || fireAt > cutoff) return;
  const id = setTimeout(() => {
    new Notification(title, { body: timeStr + (notes ? ' \u2014 ' + notes : '') });
  }, fireAt - now);
  _timers.push(id);
}

function _fireTime(dateKey, timeStr, reminderMinutes) {
  const [y, m, d]   = dateKey.split('-').map(Number);
  const [h, min]    = timeStr.split(':').map(Number);
  return new Date(y, m - 1, d, h, min, 0, 0).getTime() - reminderMinutes * 60000;
}

function _datesInWindow(now, cutoff) {
  const dates = [];
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const end = new Date(cutoff);
  while (d <= end) {
    dates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    d.setDate(d.getDate() + 1);
  }
  return dates;
}
