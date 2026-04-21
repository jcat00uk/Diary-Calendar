/** Chronicle — iCal (.ics) export */

const DAYS_ICS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const FREQ_MAP  = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY', yearly: 'YEARLY' };

function stripTags(html) {
  return html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
}

function fold(line) {
  // iCal line folding: max 75 octets, continuation lines begin with a space
  const out = [];
  while (line.length > 75) {
    out.push(line.slice(0, 75));
    line = ' ' + line.slice(75);
  }
  out.push(line);
  return out.join('\r\n');
}

function escText(str) {
  return str.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function dtStamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Format a YYYY-MM-DD + optional HH:MM time to iCal DTSTART/DTEND */
function dtStart(dateKey, time) {
  const [y, m, d] = dateKey.split('-');
  if (time) {
    const [hh, mm] = time.split(':');
    return { val: `${y}${m}${d}T${hh}${mm}00`, isDate: false };
  }
  return { val: `${y}${m}${d}`, isDate: true };
}

function buildRRule(repeat) {
  const freq = FREQ_MAP[repeat.freq];
  if (!freq) return null;
  let rrule = `FREQ=${freq}`;
  if (repeat.interval > 1) rrule += `;INTERVAL=${repeat.interval}`;
  if (repeat.freq === 'weekly' && repeat.byWeekday?.length) {
    rrule += `;BYDAY=${repeat.byWeekday.map(d => DAYS_ICS[d]).join(',')}`;
  }
  if (repeat.end?.type === 'after' && repeat.end.count) {
    rrule += `;COUNT=${repeat.end.count}`;
  } else if (repeat.end?.type === 'on' && repeat.end.date) {
    const until = repeat.end.date.replace(/-/g, '');
    rrule += `;UNTIL=${until}`;
  }
  return rrule;
}

function buildVEvent(uid, summary, dtstart, isDate, rrule, description) {
  const lines = [
    'BEGIN:VEVENT',
    fold(`UID:${uid}@chronicle`),
    fold(`DTSTAMP:${dtStamp()}`),
    fold(`SUMMARY:${escText(summary)}`),
  ];
  if (isDate) {
    lines.push(fold(`DTSTART;VALUE=DATE:${dtstart}`));
    lines.push(fold(`DTEND;VALUE=DATE:${dtstart}`));
  } else {
    lines.push(fold(`DTSTART:${dtstart}`));
    lines.push(fold(`DTEND:${dtstart}`));   // same time — duration unknown
  }
  if (rrule) lines.push(fold(`RRULE:${rrule}`));
  if (description) lines.push(fold(`DESCRIPTION:${escText(description)}`));
  lines.push('END:VEVENT');
  return lines.join('\r\n');
}

/** Build a full .ics string from the app data model */
export function buildICS(data) {
  const vevents = [];

  // One-off events and todos stored per-day
  for (const [dateKey, day] of Object.entries(data.days ?? {})) {
    for (const ev of day.events ?? []) {
      const { val, isDate } = dtStart(dateKey, ev.time);
      const summary = stripTags(ev.title || '(no title)');
      const desc    = ev.notes ? stripTags(ev.notes) : '';
      vevents.push(buildVEvent(ev.id, summary, val, isDate, null, desc));
    }
  }

  // Recurring series — one VEVENT with RRULE
  for (const s of data.series ?? []) {
    const { val, isDate } = dtStart(s.startDate, s.time);
    const summary = stripTags(s.title || '(no title)');
    const desc    = s.notes ? stripTags(s.notes) : '';
    const rrule   = buildRRule(s.repeat);
    vevents.push(buildVEvent(s.id, summary, val, isDate, rrule, desc));
  }

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Chronicle//Chronicle PWA//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...vevents,
    'END:VCALENDAR',
  ].join('\r\n');
}
