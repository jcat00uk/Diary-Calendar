/** Chronicle — Date logic, week/month calculations */

/** Format a Date as 'YYYY-MM-DD' */
export function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Parse a 'YYYY-MM-DD' string to a local midnight Date */
export function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Return the week-start Date (Monday or Sunday) for the week containing `date` */
export function getWeekStart(date, weekStartDay = 'mon') {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay(); // 0=Sun … 6=Sat
  const offset = weekStartDay === 'mon'
    ? (dow === 0 ? -6 : 1 - dow)
    : -dow;
  d.setDate(d.getDate() + offset);
  return d;
}

/** Return an array of 7 Date objects starting from weekStart */
export function getDaysOfWeek(weekStart) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });
}

/** Return the ISO week number for a date */
export function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

/** Shift a week start by `delta` weeks (+1 or -1) */
export function navigateWeek(weekStart, delta) {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + delta * 7);
  return d;
}

/** Navigate to the same relative week in the next/previous month */
export function navigateMonth(weekStart, delta, weekStartDay = 'mon') {
  const d = new Date(weekStart);
  d.setMonth(d.getMonth() + delta);
  return getWeekStart(d, weekStartDay);
}

/** Number of days in a given month */
export function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

/** Day-of-week index (0=Sun) for the first of a month */
export function getFirstDayOfMonth(year, month) {
  return new Date(year, month, 1).getDay();
}

/** Full month name for a date using the default locale */
export function getMonthName(date) {
  return date.toLocaleString('default', { month: 'long' });
}

/** Short upper-case day abbreviation (e.g. "MON") */
export function getDayName(date) {
  return date.toLocaleString('default', { weekday: 'short' }).toUpperCase();
}

/** True if two dates fall on the same calendar day */
export function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}
