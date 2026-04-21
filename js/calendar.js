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

/**
 * Chronicle week number based on a financial-year start.
 * Week 1 starts on the first Monday on or after the FY start date.
 * @param {Date}   date          - The date to find the week number for
 * @param {number} fyStartMonth  - FY start month, 0-indexed (default 3 = April)
 * @param {number} fyStartDay    - FY start day-of-month (default 6 = 6th)
 */
export function getChronicleWeekNumber(date, fyStartMonth = 3, fyStartDay = 6) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const m = d.getMonth();
  const day = d.getDate();

  // Which calendar year does the FY start in for this date?
  const fyYear = (m > fyStartMonth || (m === fyStartMonth && day >= fyStartDay))
    ? d.getFullYear()
    : d.getFullYear() - 1;

  const fyDate = new Date(fyYear, fyStartMonth, fyStartDay);

  // First Monday on or after fyDate
  const fyDow = fyDate.getDay(); // 0=Sun
  const toMon = fyDow === 1 ? 0 : fyDow === 0 ? 1 : 8 - fyDow;
  const week1Start = new Date(fyDate);
  week1Start.setDate(fyDate.getDate() + toMon);

  // If date is before week1Start it falls in the last week of the prior FY
  if (d < week1Start) {
    return getChronicleWeekNumber(new Date(fyYear - 1, fyStartMonth, fyStartDay), fyStartMonth, fyStartDay);
  }

  return Math.floor((d - week1Start) / (7 * 864e5)) + 1;
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

/** 3-letter lowercase day name used for CSS grid-area (e.g. "mon") */
export function getDayAreaName(date) {
  return ['sun','mon','tue','wed','thu','fri','sat'][date.getDay()];
}
