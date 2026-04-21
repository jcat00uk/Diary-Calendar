/** Chronicle — UK Bank Holidays (England & Wales) */

function toKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function sub(date) {
  const dow = date.getDay();
  if (dow === 6) return addDays(date, 2);
  if (dow === 0) return addDays(date, 1);
  return date;
}

function firstMonday(year, month) {
  const d = new Date(year, month, 1);
  while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
  return d;
}

function lastMonday(year, month) {
  const d = new Date(year, month + 1, 0);
  while (d.getDay() !== 1) d.setDate(d.getDate() - 1);
  return d;
}

// Meeus/Jones/Butcher algorithm
function easter(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day   = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function bankHolidaysForYear(year) {
  const list = [];
  const add  = (date, name) => list.push({ dateKey: toKey(date), name });

  add(sub(new Date(year, 0, 1)), "New Year's Day");

  const easterSunday = easter(year);
  add(addDays(easterSunday, -2), 'Good Friday');
  add(addDays(easterSunday,  1), 'Easter Monday');

  add(firstMonday(year, 4), 'Early May Bank Holiday');
  add(lastMonday(year,  4), 'Spring Bank Holiday');
  add(lastMonday(year,  7), 'Summer Bank Holiday');

  const xmasDow = new Date(year, 11, 25).getDay();
  if (xmasDow === 6) {
    add(new Date(year, 11, 27), 'Christmas Day');
    add(new Date(year, 11, 28), 'Boxing Day');
  } else if (xmasDow === 0) {
    add(new Date(year, 11, 27), 'Christmas Day');
    add(new Date(year, 11, 26), 'Boxing Day');
  } else {
    add(new Date(year, 11, 25), 'Christmas Day');
    add(sub(new Date(year, 11, 26)), 'Boxing Day');
  }

  return list.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

export function getAllHolidays(startYear, endYear) {
  const all = [];
  for (let y = startYear; y <= endYear; y++) {
    all.push(...bankHolidaysForYear(y));
  }
  return all;
}

export function ensureHolidaySettings(data) {
  if (!data.settings.holidays) {
    data.settings.holidays = { enabled: true, hidden: [] };
  }
  if (!Array.isArray(data.settings.holidays.hidden)) {
    data.settings.holidays.hidden = [];
  }
}

export function getHolidayForDate(data, dateKey) {
  const h = data.settings?.holidays;
  if (!h?.enabled) return null;
  if (h.hidden?.includes(dateKey)) return null;
  const year = parseInt(dateKey.slice(0, 4), 10);
  const match = bankHolidaysForYear(year).find(hol => hol.dateKey === dateKey);
  return match?.name ?? null;
}
