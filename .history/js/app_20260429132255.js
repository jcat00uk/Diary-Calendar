/** Chronicle — App initialisation, state management, UI orchestration */

import {
  formatDate, parseDate,
  getWeekStart, getDaysOfWeek,
  getChronicleWeekNumber, navigateWeek, navigateMonth,
  getMonthName, getDayName, isSameDay, getDayAreaName,
  getDaysInMonth, getFirstDayOfMonth,
} from './calendar.js';

import {
  getEvents,
  addEvent,
  updateEvent,
  updateSeries,
  deleteEvent,
  toggleTodo,
  getEventsForDate,
  generateOccurrencesForSeries,
  createRepeatRule,
} from './events.js'
import { getDiaryText, initDiaryArea, initFormatToolbar } from './diary.js';
import { initGestures, SPRING_EASE, SWIPE_HINT_PX, SWIPE_MIN_PX } from './gestures.js';
import { pushUndo, undo, redo, canUndo, canRedo } from './undo.js';
import {
  markDirty, markClean,
  registerDirtyCallback, registerStatusCallback, registerToastCallback,
  gdriveState, initGoogleAuth, signIn, signOut,
  syncNow, bgSync,
  syncToGCal, fullSync, fetchCalendarList,
  resetGCalThrottle, handleNativeToken, restoreToken,
} from './sync.js';
import { scheduleReminders, requestNotificationPermission } from './notifications.js';
import { buildICS } from './ical.js';
import { getAllHolidays, ensureHolidaySettings, getHolidayForDate } from './holidays.js';
import { BUILTIN_UI_THEMES, applyUITheme, injectEventThemeCSS, getEffectiveEventThemes } from './themes.js';
import { openThemeEditor, closeThemeEditor, isThemeEditorOpen } from './themeEditor.js';





function placeCursorAtEnd(el) {
  if (!el) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

// ── All user-visible strings (i18n-ready) ──────────────────────────────────

const STRINGS = {
  appTitle:         'Chronicle',
  back:             'Back',
  today:            'Today',
  addEvent:         'Add event',
  addTodo:          'Add todo',
  expandDay:        'Expand day',
  copyDay:          "Copy day's entries",
  clearDay:         'Clear day',
  save:             'Save',
  cancel:           'Cancel',
  diaryPlaceholder: 'Tap to write…',
  undone:           'Undone',
  redone:           'Redone',
  noUndo:           'Nothing to undo',
  moreEvents:       '+{n} more',
  weekLabel:        'Week {n}',
  eventSection:     'Events & Todos',
  diarySection:     'Diary',
  attachImage:      'Attach image',
  moodTag:          'Mood tag',
  exportDone:       'Data exported',
  exportICalDone:   'Calendar exported',
  importDone:       'Data imported',
  searchPlaceholder:'Search diary and events…',
  search:           'Search',
  searchEmpty:      'No results found.',
  lastSync:         'Last sync: {t}',
  neverSynced:      'Never synced',
  confirmClearDay:  'Clear all entries for this day?',
  confirmClearAll:  'Delete ALL data? This cannot be undone.',
  aboutText:        'Chronicle v1.0 — Personal diary & calendar',
  copiedToast:      'Copied to clipboard',
  nothingToCopy:    'Nothing to copy',
  syncSoon:         'Google Drive sync coming soon',
  invalidImport:    'Import failed: invalid file',
};

const STORAGE_KEY = 'chronicle_data';

// ── IndexedDB persistence ──────────────────────────────────────────────────

const _IDB_NAME    = 'chronicle_db';
const _IDB_STORE   = 'data';
const _IDB_KEY     = 'chronicle_data';
let   _idb         = null;

async function _openIDB() {
  if (_idb) return _idb;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(_IDB_NAME, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(_IDB_STORE);
    req.onsuccess  = e => { _idb = e.target.result; resolve(_idb); };
    req.onerror    = e => reject(e.target.error);
  });
}

async function _loadFromIDB() {
  const db = await _openIDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(_IDB_STORE, 'readonly').objectStore(_IDB_STORE).get(_IDB_KEY);
    req.onsuccess = e => resolve(e.target.result ?? null);
    req.onerror   = e => reject(e.target.error);
  });
}

async function _saveToIDB(data) {
  const db = await _openIDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(_IDB_STORE, 'readwrite').objectStore(_IDB_STORE).put(data, _IDB_KEY);
    req.onsuccess = () => resolve();
    req.onerror   = e => reject(e.target.error);
  });
}

const EVENT_THEMES = {
  birthday:    'Birthday',
  work:        'Work',
  holiday:     'Holiday',
  personal:    'Personal',
  appointment: 'Appointment',
};

function themePillClass(theme) {
  return theme ? ` event-pill--theme-${theme}` : '';
}

// ── App state ──────────────────────────────────────────────────────────────

const state = {
  data: null,
  currentWeekStart: null,
  today: null,
};


let _lastFocusedDate      = null;
let _suppressNextCardClick = false; // set after gesture long-press to eat the trailing click
let _swipeHintEl          = null;
let _navDimEl             = null;

// ── Data layer ─────────────────────────────────────────────────────────────

async function loadData() {
  let data = null;
  try {
    data = await _loadFromIDB();
  } catch (err) {
    console.warn('[Chronicle] IDB load failed, checking localStorage:', err);
  }

  // One-time migration from localStorage → IDB
  if (!data) {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        data = JSON.parse(raw);
        _saveToIDB(data).then(() => localStorage.removeItem(STORAGE_KEY)).catch(() => {});
      } catch { data = null; }
    }
  }

  if (!data) data = buildDefaultData();
  if (!data.series) data.series = [];
  ensureHolidaySettings(data);
  // Ensure theme settings exist
  if (!data.settings.diaryFontSize)       data.settings.diaryFontSize = 'medium';
  if (!data.settings.uiTheme)             data.settings.uiTheme = 'default';
  if (!data.settings.uiThemeCustomVars)   data.settings.uiThemeCustomVars = { light: {}, dark: {} };
  if (!data.settings.customUIThemes)      data.settings.customUIThemes = [];
  if (!data.settings.eventThemeOverrides) data.settings.eventThemeOverrides = {};
  if (!data.settings.customEventThemes)   data.settings.customEventThemes = [];
  // Ensure GCal settings exist
  if (!data.settings.googleAuth)          data.settings.googleAuth = { enabled: false, clientId: '', connectedEmail: '' };
  if (!data.settings.googleCalendars)     data.settings.googleCalendars = [];
  if (!('lastFullSync'        in data.settings)) data.settings.lastFullSync = null;
  if (!('chronicleCalendarId' in data.settings)) data.settings.chronicleCalendarId = null;
  if (!data.readOnlyEvents)               data.readOnlyEvents = {};
  // Migrate legacy 'reminder' type entries to 'event'; ensure GCal fields on events
  for (const day of Object.values(data.days || {})) {
    for (const evt of (day.events || [])) {
      if (evt.type === 'reminder') evt.type = 'event';
      if (!('googleEventId'    in evt)) evt.googleEventId    = null;
      if (!('googleCalendarId' in evt)) evt.googleCalendarId = null;
      if (!('syncStatus'       in evt)) evt.syncStatus       = 'pending';
      if (!('lastSyncedAt'     in evt)) evt.lastSyncedAt     = null;
    }
  }
  if (!data.deletedSeriesGCalIds) data.deletedSeriesGCalIds = [];
  for (const s of data.series) {
    if (s.type === 'reminder') s.type = 'event';
    if (!('googleEventId'    in s)) s.googleEventId    = null;
    if (!('googleCalendarId' in s)) s.googleCalendarId = null;
    if (!('syncStatus'       in s)) s.syncStatus       = 'pending';
    if (!('lastSyncedAt'     in s)) s.lastSyncedAt     = null;
  }
  return data;
}

function getSeriesForOccurrence(evt) {
  return state.data.series.find(s => s.id === (evt.seriesId || evt.id)) || null;
}

function buildDefaultData() {
  return {
    version: 1,
    settings: {
      weekStart:           'mon',
      theme:               'light',
      notifications:       true,
      diaryFontSize:       'medium',
      fyStartMonth:        3,
      fyStartDay:          6,
      agendaBeforeDays:    14,
      agendaAheadDays:     60,
      gdrive:              { enabled: true, lastSync: null },
      googleAuth:          { enabled: false, clientId: '', connectedEmail: '' },
      googleCalendars:     [],
      lastFullSync:        null,
      chronicleCalendarId: null,
      uiTheme:             'default',
      uiThemeCustomVars:   { light: {}, dark: {} },
      customUIThemes:      [],
      eventThemeOverrides: {},
      customEventThemes:   [],
    },
    days:           {},
    series:         [],
    readOnlyEvents: {},
  };
}

let _gcalSyncDebounce = null;

function saveData() {
  state.data._lastModified = new Date().toISOString();
  _saveToIDB(state.data).catch(err => console.warn('[Chronicle] IDB save failed:', err));
  markDirty();
  scheduleReminders(state.data);
  bgSync(state.data, _applyRemoteData, _openConflict).catch(console.warn);
  // Debounced push-only GCal sync (no pull) after saves
  clearTimeout(_gcalSyncDebounce);
  _gcalSyncDebounce = setTimeout(async () => {
    if (!gdriveState.token) return;
    try {
      await syncToGCal(state.data);
      _saveToIDB(state.data).catch(console.warn);
    } catch (err) { console.warn('[Chronicle GCal auto-push]', err.message); }
  }, 10_000);
}

function _applyRemoteData(data) {
  state.data = data;
  state.data.settings.gdrive.lastSync = new Date().toISOString();
  _saveToIDB(state.data).catch(console.warn);
  markClean();
  applyUITheme(state.data.settings);
  injectEventThemeCSS(state.data.settings);
  applyDiaryFontSize(state.data.settings.diaryFontSize);
  renderWeekGrid();
  scheduleReminders(state.data);
}

function _runFullSync() {
  fullSync(state.data, _persistForGCal, showToast, _onGCalSyncStart, _onGCalSyncEnd)
    .catch(console.warn);
}

function _onGCalSyncStart() {
  document.getElementById('btnSync')?.classList.add('icon-btn--syncing');
}

function _onGCalSyncEnd(result) {
  document.getElementById('btnSync')?.classList.remove('icon-btn--syncing');
  const badge = document.getElementById('syncBadge');
  if (!badge) return;
  if (result === 'error') {
    badge.style.background = 'var(--accent-red, #c0392b)';
    badge.hidden = false;
  } else {
    badge.style.background = '';
    badge.hidden = true;
  }
}

function _renderGCalCalendarList(container, cals) {
  if (!cals.length) {
    container.innerHTML = '<div style="padding:8px 14px;font-size:12px;color:var(--text-tertiary)">No calendars found</div>';
    return;
  }

  const saved     = state.data.settings.googleCalendars || [];
  const savedMap  = Object.fromEntries(saved.map(c => [c.id, c]));
  const chronicleId = state.data.settings.chronicleCalendarId;

  container.innerHTML = cals.map(cal => {
    const prev        = savedMap[cal.id] || {};
    const enabled     = prev.enabled ?? (cal.id === chronicleId);
    const isChronicle = cal.id === chronicleId;
    const isReadOnly  = cal.accessRole === 'reader' || cal.accessRole === 'freeBusyReader';
    const isViewOnly  = !isReadOnly && !isChronicle;
    const colour      = cal.backgroundColor || prev.colour || '#4285f4';
    const dimClass = (isReadOnly || isViewOnly) ? ' gcal-cal-row--dim' : '';
    return `
      <div class="settings-row gcal-cal-row${dimClass}" data-cal-id="${esc(cal.id)}" data-cal-readonly="${isReadOnly}"
           data-cal-colour="${esc(colour)}" data-cal-name="${esc(cal.summary || '')}">
        <div style="display:flex;align-items:center;gap:7px;min-width:0;flex:1">
          <span class="gcal-cal-dot" style="background:${esc(colour)}"></span>
          <span class="settings-label" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(cal.summary || '(no name)')}</span>
        </div>
        <div class="toggle-pill" style="flex-shrink:0">
          <div class="toggle-pill-btn ${enabled ? 'active' : ''}" data-cal-toggle="on">On</div>
          <div class="toggle-pill-btn ${!enabled ? 'active' : ''}" data-cal-toggle="off">Off</div>
        </div>
      </div>`;
  }).join('');

  container.querySelectorAll('.gcal-cal-row').forEach(row => {
    row.querySelectorAll('[data-cal-toggle]').forEach(btn => {
      btn.addEventListener('click', () => {
        const calId    = row.dataset.calId;
        const readOnly = row.dataset.calReadonly === 'true';
        const colour   = row.dataset.calColour;
        const name     = row.dataset.calName;
        const enabled  = btn.dataset.calToggle === 'on';

        const cals = state.data.settings.googleCalendars;
        const idx  = cals.findIndex(c => c.id === calId);
        if (idx >= 0) {
          cals[idx].enabled = enabled;
        } else {
          cals.push({ id: calId, name, colour, enabled, readOnly });
        }
        saveData();
        row.querySelectorAll('[data-cal-toggle]').forEach(b => b.classList.toggle('active', b === btn));
      });
    });
  });
}

function _getReadOnlyEventsForDate(dateKey) {
  const result = [];
  const chronicleId = state.data.settings?.chronicleCalendarId;
  const calendars = (state.data.settings?.googleCalendars || []).filter(c => c.enabled && c.id !== chronicleId);
  for (const cal of calendars) {
    for (const gcalEvt of (state.data.readOnlyEvents?.[cal.id] || [])) {
      if (gcalEvt.status === 'cancelled') continue;
      let evtDate = gcalEvt.start?.date || null;
      if (!evtDate && gcalEvt.start?.dateTime) {
        const d = new Date(gcalEvt.start.dateTime);
        evtDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }
      if (evtDate !== dateKey) continue;
      let time = null;
      if (gcalEvt.start?.dateTime) {
        const d = new Date(gcalEvt.start.dateTime);
        time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      }
      result.push({
        _readOnly:   true,
        _calColour:  cal.colour || '#4285f4',
        _calId:      cal.id,
        id:          'ro_' + gcalEvt.id,
        title:       gcalEvt.summary || '(no title)',
        time,
      });
    }
  }
  return result;
}

function _deleteLocalEvent(data, dateKey, evt) {
  if (evt.googleEventId) {
    evt.syncStatus = 'deleted';
  } else {
    deleteEvent(data, dateKey, evt.id);
  }
}

function _persistForGCal(data) {
  state.data = data;
  data._lastModified = new Date().toISOString();
  _saveToIDB(data).catch(console.warn);
  markClean();
  applyUITheme(data.settings);
  injectEventThemeCSS(data.settings);
  applyDiaryFontSize(data.settings.diaryFontSize);
  renderWeekGrid();
  scheduleReminders(data);
}

let _conflictCallbacks = null;

function _openConflict(driveData, keepDrive, keepLocal) {
  _conflictCallbacks = { keepDrive, keepLocal };
  document.getElementById('conflictDriveTime').textContent =
    new Date(driveData._lastModified || 0).toLocaleString();
  document.getElementById('conflictLocalTime').textContent =
    new Date(state.data._lastModified || 0).toLocaleString();
  document.getElementById('conflictModal').classList.add('open');
}

function ensureDay(dateKey) {
  if (!state.data.days[dateKey]) {
    state.data.days[dateKey] = { diary: '', events: [], images: [] };
  }
}

// ── Theme ──────────────────────────────────────────────────────────────────

const DIARY_SIZES = { small: 12, medium: 14, large: 16 };

function applyDiaryFontSize(size) {
  const px = DIARY_SIZES[size] ?? DIARY_SIZES.medium;
  document.documentElement.style.setProperty('--diary-font-size', `${px}px`);
  // Probe the actual rendered font height so --line-height-diary matches even
  // when Android system font scaling overrides the CSS font-size value.
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;visibility:hidden;top:-9999px;left:-9999px;' +
    `font-size:${px}px;line-height:1;white-space:nowrap;` +
    'font-family:system-ui,-apple-system,BlinkMacSystemFont,sans-serif';
  probe.textContent = 'Mg';
  document.body.appendChild(probe);
  const fontH = probe.getBoundingClientRect().height;
  probe.remove();
  if (fontH > 0) {
    document.documentElement.style.setProperty(
      '--line-height-diary', `${Math.ceil(fontH * 1.6)}px`
    );
  }
}

function applyTheme(theme) {
  state.data.settings.theme = theme;
  applyUITheme(state.data.settings);
  injectEventThemeCSS(state.data.settings);
}

// ── Toast ──────────────────────────────────────────────────────────────────

let _toastTimer = null;

function showToast(msg, duration = 2200) {
  let toast = document.getElementById('appToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'appToast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('toast--visible');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => toast.classList.remove('toast--visible'), duration);
}

// ── Ribbon labels ──────────────────────────────────────────────────────────

function updateRibbonLabels() {
  const days = getDaysOfWeek(state.currentWeekStart);
  const mid  = days[3];
  const mon2 = mid.toLocaleString('default', { month: 'short' });
  const yr2  = String(mid.getFullYear() % 100).padStart(2, '0');
  document.getElementById('ribbonMonth').textContent = `${mon2} ${yr2}`;
  const fyMonth = state.data.settings.fyStartMonth ?? 3;
  const fyDay   = state.data.settings.fyStartDay   ?? 6;
  document.getElementById('ribbonWeek').textContent =
    STRINGS.weekLabel.replace('{n}', getChronicleWeekNumber(mid, fyMonth, fyDay));
}

// ── Escape HTML ────────────────────────────────────────────────────────────

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Week grid rendering ────────────────────────────────────────────────────

function _showSwipeHint(dir, context) {
  if (!_swipeHintEl) return;
  if (!dir) {
    _swipeHintEl.classList.remove('swipe-hint--visible');
    return;
  }
  const isExpanded = context === 'expanded';
  const labels = {
    left:  isExpanded ? 'Next day →'   : 'Next week →',
    right: isExpanded ? '← Prev day'   : '← Prev week',
    up:    'Next month ↑',
    down:  '↓ Prev month',
  };
  const label = labels[dir];
  if (!label) return;
  _swipeHintEl.textContent = label;
  const W = window.innerWidth, H = window.innerHeight;
  Object.assign(_swipeHintEl.style, { left: '', right: '', top: '', bottom: '', transform: '' });
  if (dir === 'left')  Object.assign(_swipeHintEl.style, { right: '16px', top: `${H / 2}px`, transform: 'translateY(-50%)' });
  if (dir === 'right') Object.assign(_swipeHintEl.style, { left:  '16px', top: `${H / 2}px`, transform: 'translateY(-50%)' });
  if (dir === 'up')    Object.assign(_swipeHintEl.style, { bottom: '40px', left: `${W / 2}px`, transform: 'translateX(-50%)' });
  if (dir === 'down')  Object.assign(_swipeHintEl.style, { top:   '80px', left: `${W / 2}px`, transform: 'translateX(-50%)' });
  _swipeHintEl.classList.add('swipe-hint--visible');
}

function _getMultidayBarColor(evt) {
  if (evt.theme) {
    const c = getComputedStyle(document.documentElement)
      .getPropertyValue(`--evt-${evt.theme}-text`).trim();
    if (c) return c;
  }
  return getComputedStyle(document.documentElement)
    .getPropertyValue('--accent-blue-text').trim() || '#0C447C';
}

function renderMultidayBars() {
  const grid      = document.getElementById('weekGrid');
  if (!grid) return;
  const container = grid.parentElement; // .grid-with-sides — a flex container, not a grid
  container.querySelector('.multiday-overlay')?.remove();

  // Reset events-strip padding from any previous bar render
  grid.querySelectorAll('.events-strip').forEach(s => { s.style.paddingTop = ''; });

  const weekDays = getDaysOfWeek(state.currentWeekStart);
  const firstKey = formatDate(weekDays[0]);
  const lastKey  = formatDate(weekDays[weekDays.length - 1]);

  const multiday = [];
  const seen = new Set();

  for (const d of weekDays) {
    const dk = formatDate(d);
    for (const evt of (state.data.days[dk]?.events ?? [])) {
      if (seen.has(evt.id) || evt.syncStatus === 'deleted') continue;
      if (!evt.endDate || evt.endDate <= dk) continue;
      seen.add(evt.id);
      multiday.push({ evt, startKey: dk });
    }
  }
  for (let i = 1; i <= 30; i++) {
    const prev = new Date(weekDays[0]);
    prev.setDate(prev.getDate() - i);
    const prevKey = formatDate(prev);
    for (const evt of (state.data.days[prevKey]?.events ?? [])) {
      if (seen.has(evt.id) || evt.syncStatus === 'deleted') continue;
      if (!evt.endDate || evt.endDate < firstKey) continue;
      seen.add(evt.id);
      multiday.push({ evt, startKey: prevKey });
    }
  }

  if (multiday.length === 0) return;

  const gridRect      = grid.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();

  const cardRects = {};
  for (const d of weekDays) {
    const dk = formatDate(d);
    const el = grid.querySelector(`.day-card[data-date="${dk}"]`);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    cardRects[dk] = {
      left:   r.left   - gridRect.left,
      top:    r.top    - gridRect.top,
      right:  r.right  - gridRect.left,
      bottom: r.bottom - gridRect.top,
    };
  }

  const overlay = document.createElement('div');
  overlay.className = 'multiday-overlay';
  // Position the overlay to cover the grid exactly, but parent it on the flex
  // container so it is never a CSS-grid child (avoids auto-placement slot bugs)
  overlay.style.left   = `${gridRect.left   - containerRect.left}px`;
  overlay.style.top    = `${gridRect.top    - containerRect.top}px`;
  overlay.style.width  = `${gridRect.width}px`;
  overlay.style.height = `${gridRect.height}px`;
  container.appendChild(overlay);

  const BAR_H       = 14;
  const BAR_Y_START = 26;
  const BAR_GAP     = 2;
  const rowStacks   = new Map(); // rowKey → nextBarTop
  const barsPerDay  = new Map(); // dateKey → bar count (for events-strip padding)

  // Group days into CSS grid rows by day-of-week — immune to sub-pixel rendering variance
  const ws = state.data.settings.weekStart || 'mon';
  const _DOW_ROW = ws === 'mon'
    ? { sun: 2, mon: 0, tue: 0, wed: 1, thu: 1, fri: 2, sat: 2 }
    : { sun: 0, mon: 1, tue: 1, wed: 2, thu: 2, fri: 3, sat: 3 };
  const _dowAbbr = dk => ['sun','mon','tue','wed','thu','fri','sat'][new Date(dk + 'T00:00').getDay()];

  for (const { evt, startKey } of multiday) {
    const coveredKeys = weekDays
      .map(d => formatDate(d))
      .filter(dk => dk >= startKey && dk <= evt.endDate);
    if (coveredKeys.length === 0) continue;

    const rows = new Map();
    for (const dk of coveredKeys) {
      const r = cardRects[dk];
      if (!r) continue;
      const rowKey = _DOW_ROW[_dowAbbr(dk)] ?? 0;
      if (!rows.has(rowKey)) rows.set(rowKey, []);
      rows.get(rowKey).push(dk);
    }

    for (const [rowKey, keys] of rows) {
      keys.sort((a, b) => (cardRects[a]?.left ?? 0) - (cardRects[b]?.left ?? 0));
      const firstR = cardRects[keys[0]];
      const lastR  = cardRects[keys[keys.length - 1]];
      if (!firstR || !lastR) continue;

      if (!rowStacks.has(rowKey)) rowStacks.set(rowKey, firstR.top + BAR_Y_START);
      const barTop = rowStacks.get(rowKey);
      rowStacks.set(rowKey, barTop + BAR_H + BAR_GAP);

      // Track how many bars each day has so we can push the events-strip down
      for (const dk of keys) barsPerDay.set(dk, (barsPerDay.get(dk) || 0) + 1);

      const barStartsThisWeek = keys[0] === startKey;
      const barEndsThisWeek   = evt.endDate <= lastKey;
      const r1 = barStartsThisWeek ? '6px' : '0';
      const r2 = barEndsThisWeek   ? '6px' : '0';

      const bar = document.createElement('div');
      bar.className = `multiday-bar${evt.theme ? ` multiday-bar--theme-${evt.theme}` : ''}`;
      bar.dataset.evtId    = evt.id;
      bar.dataset.startKey = startKey;
      bar.style.cssText = `top:${barTop}px;left:${firstR.left + 4}px;` +
        `width:${lastR.right - firstR.left - 8}px;height:${BAR_H}px;` +
        `background:${_getMultidayBarColor(evt)};` +
        `border-radius:${r1} ${r2} ${r2} ${r1};`;
      if (barStartsThisWeek) {
        const labelEl = document.createElement('span');
        labelEl.className = 'multiday-bar-label';
        labelEl.innerHTML = sanitizeDiaryHTML(evt.title);
        bar.appendChild(labelEl);
      }
      overlay.appendChild(bar);
    }
  }

  // Push each card's events-strip below its bars so pills don't hide under them
  for (const [dk, count] of barsPerDay) {
    const card = grid.querySelector(`.day-card[data-date="${dk}"]`);
    if (!card) continue;
    const strip = card.querySelector('.events-strip');
    if (strip) strip.style.paddingTop = `${4 + count * (BAR_H + BAR_GAP)}px`;
  }
}

function renderWeekGrid() {
  const grid = document.getElementById('weekGrid');
  if (!grid) return;
  const gws = grid.parentElement; // .grid-with-sides
  gws.style.transform  = '';
  gws.style.transition = '';
  grid.style.transform  = '';
  grid.style.transition = '';
  grid.innerHTML = '';

  const ws = state.data.settings.weekStart;
  grid.dataset.weekStart = ws;

  const days = getDaysOfWeek(state.currentWeekStart);

  days.forEach(date => {
    const dow     = date.getDay();
    const isToday = isSameDay(date, state.today);
    const dateKey = formatDate(date);

    const card = document.createElement('div');
    card.className = 'day-card';
    card.dataset.date = dateKey;
    card.dataset.day  = getDayAreaName(date);
    card.setAttribute('role', 'article');
    card.setAttribute('aria-label', date.toLocaleDateString('default', {
      weekday: 'long', month: 'long', day: 'numeric',
    }));

    if (isToday)              card.classList.add('today');
    if (dow === 0 || dow === 6) card.classList.add('day-card--weekend');

    card.innerHTML = buildCardHTML(date, dateKey);

    const diaryEl = card.querySelector('.diary-area');
    if (diaryEl) {
      initDiaryArea(
        diaryEl,
        () => getDiaryText(state.data, dateKey),
        html => {
          ensureDay(dateKey);
          state.data.days[dateKey].diary = html;
          state.data.days[dateKey].diaryModified = Date.now();
          saveData();
        },
        {
          placeholder: STRINGS.diaryPlaceholder,
          ariaLabel:   `Diary entry for ${dateKey}`,
          onFocus:     () => { _lastFocusedDate = dateKey; },
        }
      );
    }

    card.addEventListener('click', e => {
      if (e.target.closest('.diary-area'))              return;
      if (e.target.closest('.event-pill[data-id]'))     return;
      if (e.target.closest('.todo-item[data-todo-id]')) return;
      if (e.target.closest('.event-detail'))            return;
      if (_suppressNextCardClick) { _suppressNextCardClick = false; return; }
      _lastFocusedDate = dateKey;
      openExpandedDay(dateKey);
    });

    grid.appendChild(card);
  });

  // Fix 1: Wrap Sat + Sun in a flex column for Mon-start layout
  if (ws === 'mon') {
    const satCard = grid.querySelector('.day-card[data-day="sat"]');
    const sunCard = grid.querySelector('.day-card[data-day="sun"]');
    if (satCard && sunCard) {
      const weekendCol = document.createElement('div');
      weekendCol.className = 'weekend-col';
      grid.insertBefore(weekendCol, satCard);
      weekendCol.appendChild(satCard);
      weekendCol.appendChild(sunCard);
    }
  }

  updateRibbonLabels();
  requestAnimationFrame(renderMultidayBars);
}

/** Build the inner HTML for a single day card */
function buildCardHTML(date, dateKey) {
  const events  = getEventsForDate(state.data, dateKey, { includeContinuations: false })
    .filter(e => e.syncStatus !== 'deleted' && !(e.endDate && e.endDate > dateKey));
  const roEvts  = _getReadOnlyEventsForDate(dateKey);
  const allEvts = events.concat(roEvts);
  const shown   = allEvts.slice(0, 3);
  const extra   = allEvts.length - 3;
  const holiday = getHolidayForDate(state.data, dateKey);
  const holidayHTML = holiday ? `<div class="holiday-badge">${esc(holiday)}</div>` : '';

  const itemsHTML = shown.map(evt => {
    if (evt._readOnly) {
      const dot = `<span class="pill-cal-dot" style="background:${esc(evt._calColour)}"></span>`;
      return `<div class="event-pill event-pill--event event-pill--readonly">
        ${dot}<span class="event-pill-text">${evt.time ? evt.time + ' ' : ''}${esc(evt.title)}</span>
      </div>`;
    }
    if (evt.type === 'todo') {
      const todoTheme = evt.theme ? ` todo-item--theme-${esc(evt.theme)}` : '';
      return `<div class="todo-item ${evt.done ? 'todo-item--done' : ''}${todoTheme}"
                   data-todo-id="${esc(evt.id)}" data-date="${esc(dateKey)}">
        <span class="todo-checkbox">${evt.done ? '&#10003;' : ''}</span>
        <span class="todo-label">${evt.title}</span>
      </div>`;
    }
    const timeStr  = evt.time ? `${evt.time} ` : '';
    const bell     = evt.reminderMinutes != null
      ? `<span class="pill-reminder" aria-label="Reminder set">🔔</span>` : '';
    const repeat   = evt.isOccurrence
      ? `<span class="pill-repeat" aria-label="Recurring">↻</span>` : '';
    return `<div class="event-pill event-pill--${esc(evt.type)}${themePillClass(evt.theme)}"
                 data-id="${esc(evt.id)}" data-date="${esc(dateKey)}">
      <span class="event-pill-text">${timeStr}${evt.title}</span>${bell}${repeat}
    </div>`;
  }).join('');

  const moreHTML = extra > 0
    ? `<div class="events-more">${STRINGS.moreEvents.replace('{n}', extra)}</div>`
    : '';

  return `
    <div class="day-header">
      <span class="day-name">${getDayName(date)}</span>
      <span class="day-number">${date.getDate()}<span class="day-month-abbr"> ${date.toLocaleString('default',{month:'short'})}</span></span>
    </div>
    ${holidayHTML}
    <div class="events-strip">${itemsHTML}${moreHTML}</div>
    <div class="diary-area" tabindex="0"></div>
  `;
}

/** Refresh only the events strip of a card, preserving the diary area */
function refreshCardEvents(dateKey) {
  const card = document.querySelector(`.day-card[data-date="${dateKey}"]`);
  if (!card) return;
  const strip = card.querySelector('.events-strip');
  if (!strip) return;

  const events  = getEventsForDate(state.data, dateKey, { includeContinuations: false })
    .filter(e => e.syncStatus !== 'deleted' && !(e.endDate && e.endDate > dateKey));
  const roEvts  = _getReadOnlyEventsForDate(dateKey);
  const allEvts = events.concat(roEvts);
  const shown   = allEvts.slice(0, 3);
  const extra   = allEvts.length - 3;

  strip.innerHTML = shown.map(evt => {
    if (evt._readOnly) {
      const dot = `<span class="pill-cal-dot" style="background:${esc(evt._calColour)}"></span>`;
      return `<div class="event-pill event-pill--event event-pill--readonly">
        ${dot}<span class="event-pill-text">${evt.time ? evt.time + ' ' : ''}${esc(evt.title)}</span>
      </div>`;
    }
    if (evt.type === 'todo') {
      const todoTheme = evt.theme ? ` todo-item--theme-${esc(evt.theme)}` : '';
      return `<div class="todo-item ${evt.done ? 'todo-item--done' : ''}${todoTheme}"
                   data-todo-id="${esc(evt.id)}" data-date="${esc(dateKey)}">
        <span class="todo-checkbox">${evt.done ? '&#10003;' : ''}</span>
        <span class="todo-label">${evt.title}</span>
      </div>`;
    }
    const timeStr  = evt.time ? `${evt.time} ` : '';
    const bell     = evt.reminderMinutes != null
      ? `<span class="pill-reminder" aria-label="Reminder set">🔔</span>` : '';
    const repeat   = evt.isOccurrence
      ? `<span class="pill-repeat" aria-label="Recurring">↻</span>` : '';
    const themeClass = evt.theme ? ` event-pill--theme-${evt.theme}` : '';
    return `<div class="event-pill${themeClass}"
                 data-id="${esc(evt.id)}" data-date="${esc(dateKey)}">
      <span class="event-pill-text">${timeStr}${evt.title}</span>${bell}${repeat}
    </div>`;
  }).join('') + (extra > 0
    ? `<div class="events-more">${STRINGS.moreEvents.replace('{n}', extra)}</div>`
    : '');
}

/** Refresh all 7 day-card event strips currently rendered on screen */
function refreshVisibleWeekCards() {
  getDaysOfWeek(state.currentWeekStart).forEach(d => refreshCardEvents(formatDate(d)));
  requestAnimationFrame(renderMultidayBars);
}

// ── Navigation ─────────────────────────────────────────────────────────────

function goToWeek(date) {
  state.currentWeekStart = getWeekStart(date, state.data.settings.weekStart);
  renderWeekGrid();
}

function goToToday()  { goToWeek(state.today); }
function prevWeek()   { state.currentWeekStart = navigateWeek(state.currentWeekStart, -1); renderWeekGrid(); }
function nextWeek()   { state.currentWeekStart = navigateWeek(state.currentWeekStart,  1); renderWeekGrid(); }
function prevMonth()  { state.currentWeekStart = navigateMonth(state.currentWeekStart, -1, state.data.settings.weekStart); renderWeekGrid(); }
function nextMonth()  { state.currentWeekStart = navigateMonth(state.currentWeekStart,  1, state.data.settings.weekStart); renderWeekGrid(); }

function prevMonthFirst() {
  const mid = getDaysOfWeek(state.currentWeekStart)[3];
  let target = getWeekStart(new Date(mid.getFullYear(), mid.getMonth() - 1, 1), state.data.settings.weekStart);
  if (target.getTime() === state.currentWeekStart.getTime())
    target = getWeekStart(new Date(mid.getFullYear(), mid.getMonth() - 2, 1), state.data.settings.weekStart);
  state.currentWeekStart = target;
  renderWeekGrid();
}
function nextMonthFirst() {
  const mid = getDaysOfWeek(state.currentWeekStart)[3];
  let target = getWeekStart(new Date(mid.getFullYear(), mid.getMonth() + 1, 1), state.data.settings.weekStart);
  if (target.getTime() === state.currentWeekStart.getTime())
  target = getWeekStart(new Date(mid.getFullYear(), mid.getMonth() + 2, 1), state.data.settings.weekStart);
state.currentWeekStart = target;
  renderWeekGrid();
}
function anyModalOpen() {
  return !!(isThemeEditorOpen() || _expandedOverlay || _addEventSheet || _qaSheet ||
            _settingsDropdown || _datepickerOverlay || _searchSheet ||
            document.getElementById('agendaPanel')?.classList.contains('open'));
}

// ── Expanded day view ──────────────────────────────────────────────────────

let _expandedOverlay = null;
let _expandedDateKey  = null;

function _buildExpandedGhost(forDate, side) {
  const dateKey = formatDate(forDate);
  const title   = forDate.toLocaleDateString('default', { weekday: 'long', day: 'numeric', month: 'long' });
  const holiday = getHolidayForDate(state.data, dateKey);

  const ghost = document.createElement('div');
  ghost.style.cssText = [
    'position:fixed', 'top:0', 'bottom:0', 'left:50%', 'width:100%', 'max-width:480px',
    'z-index:199', 'display:flex', 'flex-direction:column', 'background:var(--bg-primary)',
    `transform:translateX(${side === 'prev' ? '-150%' : '50%'})`,
    'padding-top:var(--safe-top)', 'padding-bottom:var(--safe-bottom)',
    'pointer-events:none', 'overflow:hidden',
  ].join(';');
  ghost.innerHTML = `
    <header class="expanded-header">
      <div class="expanded-back"></div>
      <div class="expanded-title">${esc(title)}</div>
      <div></div>
    </header>
    ${holiday ? `<div class="expanded-holiday-label">${esc(holiday)}</div>` : ''}`;
  document.body.appendChild(ghost);
  return ghost;
}

function openExpandedDay(dateKey, { replaceHistory = false, _skipSlideIn = false, _slideFrom = 'right' } = {}) {
  if (_expandedOverlay) closeExpandedDay();

  if (replaceHistory) {
    history.replaceState({ chronicle: 'expanded', dateKey }, '');
  } else {
    history.pushState({ chronicle: 'expanded', dateKey }, '');
  }

  const date  = parseDate(dateKey);
  const title = date.toLocaleDateString('default', { weekday: 'long', day: 'numeric', month: 'long' });

  const overlay = document.createElement('div');
  overlay.className = 'expanded-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', `Day view: ${title}`);

  const prevDate   = new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1);
  const nextDate   = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  const prevLabel  = prevDate.toLocaleDateString('default', { weekday: 'short', day: 'numeric', month: 'short' });
  const nextLabel  = nextDate.toLocaleDateString('default', { weekday: 'short', day: 'numeric', month: 'short' });

  const expandedHoliday = getHolidayForDate(state.data, dateKey);

  overlay.innerHTML = `
    <header class="expanded-header">
      <button class="expanded-back" aria-label="${STRINGS.back}">
        <svg class="icon"><use href="assets/icons.svg#icon-chevron-left"/></svg>
        ${STRINGS.back}
      </button>
      <div class="expanded-title">${esc(title)}</div>
      <button class="expanded-add-btn" aria-label="${STRINGS.addEvent}">+ ${STRINGS.addEvent}</button>
    </header>
    ${expandedHoliday ? `<div class="expanded-holiday-label">${esc(expandedHoliday)}</div>` : ''}
    <div class="expanded-nav-strip expanded-nav-strip--top" aria-hidden="true">
      <svg class="icon"><use href="assets/icons.svg#icon-chevron-left"/></svg>
      <svg class="icon"><use href="assets/icons.svg#icon-chevron-right"/></svg>
    </div>
    <div class="expanded-with-sides">
      <div class="expanded-side-nav expanded-side-nav--left" role="button" tabindex="0" aria-label="Previous day: ${esc(prevLabel)}">
        <svg class="icon" aria-hidden="true"><use href="assets/icons.svg#icon-chevron-left"/></svg>
        <span class="rotated-text">${esc(prevLabel)}</span>
      </div>
      <div class="expanded-body">
      <div class="expanded-section">
        <div class="expanded-section-header">${STRINGS.eventSection}</div>
        <div class="expanded-event-list" id="expandedEventList"></div>
      </div>
      <div class="expanded-section expanded-diary-section">
        <div class="expanded-section-header">
          ${STRINGS.diarySection}
          <span class="diary-saved-indicator"></span>
        </div>
        <div class="expanded-diary-area" tabindex="0"></div>
      </div>
      </div>
      <div class="expanded-side-nav expanded-side-nav--right" role="button" tabindex="0" aria-label="Next day: ${esc(nextLabel)}">
        <span class="rotated-text">${esc(nextLabel)}</span>
        <svg class="icon" aria-hidden="true"><use href="assets/icons.svg#icon-chevron-right"/></svg>
      </div>
    </div>
    <div class="expanded-nav-strip expanded-nav-strip--bottom" aria-hidden="true">
      <svg class="icon"><use href="assets/icons.svg#icon-chevron-left"/></svg>
      <svg class="icon"><use href="assets/icons.svg#icon-chevron-right"/></svg>
    </div>
  `;

  document.body.appendChild(overlay);
  _expandedOverlay = overlay;
  _expandedDateKey  = dateKey;

  // Saved indicator
  const savedInd = overlay.querySelector('.diary-saved-indicator');
  const flashSaved = () => {
    savedInd.textContent = 'Saved';
    savedInd.classList.add('visible');
    setTimeout(() => savedInd.classList.remove('visible'), 1500);
  };

  const diaryEl = overlay.querySelector('.expanded-diary-area');
  if (diaryEl) {
    initDiaryArea(
      diaryEl,
      () => getDiaryText(state.data, dateKey),
      html => {
        ensureDay(dateKey);
        state.data.days[dateKey].diary = html;
        saveData();
      },
      {
        placeholder: STRINGS.diaryPlaceholder,
        ariaLabel:   `Diary entry for ${dateKey}`,
        onSaved:     flashSaved,
      }
    );
  }

  renderExpandedEvents(overlay, dateKey);

  const navigateExpandedDay = (targetDate, slideFrom = 'right') => {
    const targetKey = formatDate(targetDate);
    goToWeek(targetDate);
    if (_expandedOverlay) {
      _expandedOverlay.remove();
      _expandedOverlay = null;
      _expandedDateKey  = null;
    }
    openExpandedDay(targetKey, { replaceHistory: true, _slideFrom: slideFrom });
  };

  // Back button → history.back() → popstate → closeExpandedDay()
  overlay.querySelector('.expanded-back').addEventListener('click', () => history.back());
  overlay.querySelector('.expanded-side-nav--left').addEventListener('click', () => navigateExpandedDay(prevDate, 'left'));
  overlay.querySelector('.expanded-side-nav--right').addEventListener('click', () => navigateExpandedDay(nextDate, 'right'));

  overlay.querySelector('.expanded-add-btn').addEventListener('click', () => {
    history.back();
    setTimeout(() => openAddEventModal(dateKey), 350);
  });

  // ── Swipe navigation with adjacent-day preview ────────────────────────
  let _expStart = null, _expAxis = null;
  let _ghostPrev = null, _ghostNext = null;

  function _cleanupExpGhosts() {
    _ghostPrev?.remove(); _ghostPrev = null;
    _ghostNext?.remove(); _ghostNext = null;
  }

  const _handleExpEnd = dx => {
    _showSwipeHint(null, 'expanded');
    if (_expAxis !== 'h') { _cleanupExpGhosts(); _expStart = null; _expAxis = null; return; }
    _expStart = null; _expAxis = null;

    if (Math.abs(dx) >= window.innerWidth * 0.5) {
      const DUR = 250;
      const tr  = `transform ${DUR}ms ease`;
      overlay.style.transition              = tr;
      if (_ghostPrev) _ghostPrev.style.transition = tr;
      if (_ghostNext) _ghostNext.style.transition = tr;

      if (_navDimEl) {
        _navDimEl.style.transition = 'none';
        _navDimEl.style.opacity    = '0.1';
        setTimeout(() => {
          _navDimEl.style.transition = `opacity ${Math.round(DUR * 0.6)}ms ease`;
          _navDimEl.style.opacity    = '0';
        }, Math.round(DUR * 0.4));
      }

      const targetDate = dx < 0 ? nextDate : prevDate;
      if (dx < 0) {
        overlay.style.transform              = 'translateX(-150%)';
        if (_ghostNext) _ghostNext.style.transform = 'translateX(-50%)';
        if (_ghostPrev) _ghostPrev.style.transform = 'translateX(-250%)';
      } else {
        overlay.style.transform              = 'translateX(50%)';
        if (_ghostPrev) _ghostPrev.style.transform = 'translateX(-50%)';
        if (_ghostNext) _ghostNext.style.transform = 'translateX(150%)';
      }
      setTimeout(() => {
        _cleanupExpGhosts();
        overlay.style.transition = '';
        overlay.style.transform  = '';
        overlay.remove();
        _expandedOverlay = null;
        _expandedDateKey = null;
        goToWeek(targetDate);
        openExpandedDay(formatDate(targetDate), { replaceHistory: true, _skipSlideIn: true });
      }, DUR + 10);
    } else {
      const DUR = 300;
      const tr  = `transform ${DUR}ms ease`;
      overlay.style.transition              = tr;
      if (_ghostPrev) _ghostPrev.style.transition = tr;
      if (_ghostNext) _ghostNext.style.transition = tr;
      overlay.style.transform              = 'translateX(-50%)';
      if (_ghostPrev) _ghostPrev.style.transform = 'translateX(-150%)';
      if (_ghostNext) _ghostNext.style.transform = 'translateX(50%)';
      setTimeout(() => {
        _cleanupExpGhosts();
        overlay.style.transform  = '';
        overlay.style.transition = '';
      }, DUR + 20);
    }
  };

  // Attach swipe detection only to the top and bottom nav strips (zone-based)
  ['.expanded-nav-strip--top', '.expanded-nav-strip--bottom'].forEach(sel => {
    const zone = overlay.querySelector(sel);

    zone.addEventListener('touchstart', e => {
      _expStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      _expAxis  = null;
      overlay.style.transition = 'none';
      zone.classList.add('swipe-zone-active');
    }, { passive: false });

    zone.addEventListener('touchmove', e => {
      if (!_expStart) return;
      const dx  = e.touches[0].clientX - _expStart.x;
      const dy  = e.touches[0].clientY - _expStart.y;
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);

      if (!_expAxis) {
        if (adx >= SWIPE_HINT_PX && adx > ady) {
          _expAxis = 'h';
          if (!_ghostPrev) _ghostPrev = _buildExpandedGhost(prevDate, 'prev');
          if (!_ghostNext) _ghostNext = _buildExpandedGhost(nextDate, 'next');
        } else if (ady >= SWIPE_HINT_PX && ady > adx) {
          _expStart = null; // vertical scroll — cancel swipe
          zone.classList.remove('swipe-zone-active');
          return;
        }
      }
      if (_expAxis !== 'h') return;

      e.preventDefault();
      overlay.style.transform = `translateX(calc(-50% + ${dx}px))`;
      if (_ghostPrev) _ghostPrev.style.transform = `translateX(calc(-150% + ${dx}px))`;
      if (_ghostNext) _ghostNext.style.transform = `translateX(calc(50% + ${dx}px))`;
      if (adx >= SWIPE_HINT_PX) _showSwipeHint(dx < 0 ? 'left' : 'right', 'expanded');
    }, { passive: false });

    zone.addEventListener('touchend', e => {
      zone.classList.remove('swipe-zone-active');
      if (!_expStart) return;
      _handleExpEnd(e.changedTouches[0].clientX - _expStart.x);
    }, { passive: true });

    zone.addEventListener('touchcancel', () => {
      zone.classList.remove('swipe-zone-active');
      _showSwipeHint(null, 'expanded');
      if (_expAxis === 'h') {
        const DUR = 250;
        const tr  = `transform ${DUR}ms ease`;
        overlay.style.transition              = tr;
        if (_ghostPrev) _ghostPrev.style.transition = tr;
        if (_ghostNext) _ghostNext.style.transition = tr;
        overlay.style.transform              = 'translateX(-50%)';
        if (_ghostPrev) _ghostPrev.style.transform = 'translateX(-150%)';
        if (_ghostNext) _ghostNext.style.transform = 'translateX(50%)';
        setTimeout(() => { _cleanupExpGhosts(); overlay.style.transform = ''; overlay.style.transition = ''; }, DUR + 20);
      }
      _expStart = null; _expAxis = null;
    }, { passive: true });
  });

  if (_slideFrom === 'left') overlay.classList.add('slide-from-left');

  if (_skipSlideIn) {
    // Suppress the CSS transition so the overlay appears instantly at centre
    overlay.style.transition = 'none';
    overlay.style.transform  = 'translateX(-50%)';
    overlay.classList.add('open');
    requestAnimationFrame(() => { overlay.style.transition = ''; });
  } else {
    requestAnimationFrame(() => overlay.classList.add('open'));
  }
}


function renderExpandedEvents(overlay, dateKey) {
  const list = overlay.querySelector('#expandedEventList');
  if (!list) return;

  const events  = getEventsForDate(state.data, dateKey).filter(e => e.syncStatus !== 'deleted');
  const roEvts  = _getReadOnlyEventsForDate(dateKey);
  const allEvts = [...events, ...roEvts];

  list.innerHTML = allEvts.length === 0
    ? `<div class="expanded-empty">No entries yet. Tap "+ Add Event" Above.</div>`
    : allEvts.map(evt => {
        if (evt._readOnly) {
          const dot = `<span class="expanded-event-dot" style="background:${esc(evt._calColour)};border-radius:50%"></span>`;
          const time = evt.time ? `<div class="expanded-event-time">${esc(evt.time)}</div>` : '';
          return `
            <div class="expanded-event-item expanded-event-item--readonly">
              ${dot}
              <div class="expanded-event-content">
             
                <div class="expanded-event-title">${esc(evt.title)}</div>
                ${time}
              </div>
            </div>`;
        }

        const bell = evt.reminderMinutes != null
          ? `<span class="reminder-icon" title="${evt.reminderMinutes}min reminder">🔔</span>` : '';

        if (evt.type === 'todo') {
          return `
            <div class="expanded-todo-item ${evt.done ? 'expanded-todo-item--done' : ''}" data-id="${esc(evt.id)}">
              <button class="expanded-todo-check ${evt.done ? 'checked' : ''}"
                      data-check="${esc(evt.id)}" aria-label="${evt.done ? 'Mark incomplete' : 'Mark complete'}">
                ${evt.done ? '✓' : ''}
              </button>
              <span class="expanded-todo-label">${evt.title}${evt.isOccurrence ? ' <span class="item-repeat">↻</span>' : ''}</span>
              <div class="expanded-item-actions">
                ${bell}
                <button class="expanded-event-edit"   data-edit="${esc(evt.id)}"   aria-label="Edit">Edit</button>
                <button class="expanded-event-delete" data-delete="${esc(evt.id)}" aria-label="Delete">✕</button>
              </div>
            </div>`;
        }

        const time = evt.time
          ? `<div class="expanded-event-time">${esc(evt.time)}</div>` : '';
    const expandedTheme = evt.theme ? ` expanded-event-item--theme-${evt.theme}` : '';

    return `
      <div class="expanded-event-item${expandedTheme}" data-id="${esc(evt.id)}">

        <div class="expanded-event-dot"></div>

        <div class="expanded-event-content">
        
          <div class="expanded-event-title">${esc(evt.title)}</div>
          ${evt.time ? `<div class="expanded-event-time">testiv>` : ''}
        </div>

      </div>
    
            <div class="expanded-item-actions">
              ${bell}
              <button class="expanded-event-edit"   data-edit="${esc(evt.id)}"   aria-label="Edit">Edit</button>
              <button class="expanded-event-delete" data-delete="${esc(evt.id)}" aria-label="Delete">✕</button>
            </div>
          </div>`;
      }).join('');

  list.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const evt = events.find(ev => ev.id === btn.dataset.edit);
      if (!evt) return;
      history.back();
      if (evt.isOccurrence && evt.seriesId) {
        setTimeout(() => openRepeatActionSheet(evt, dateKey, 'edit'), 350);
      } else {
        setTimeout(() => openAddEventModal(dateKey, evt), 350);
      }
    });
  });

  list.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const evtToDel = events.find(ev => ev.id === btn.dataset.delete);
      if (!evtToDel) return;
      if (!confirm(`Delete "${evtToDel.title}"?`)) return;
      pushUndo(JSON.parse(JSON.stringify(state.data)));
      if (evtToDel.isOccurrence && evtToDel.seriesId) {
        openRepeatActionSheet(evtToDel, dateKey, 'delete');
      } else {
        _deleteLocalEvent(state.data, dateKey, evtToDel);
        saveData();
        renderExpandedEvents(overlay, dateKey);
        refreshVisibleWeekCards();
      }
    });
  });

  list.querySelectorAll('[data-check]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      pushUndo(JSON.parse(JSON.stringify(state.data)));
      toggleTodo(state.data, dateKey, btn.dataset.check);
      saveData();
      renderExpandedEvents(overlay, dateKey);
      refreshVisibleWeekCards();
    });
  });

}


function closeExpandedDay() {
  if (!_expandedOverlay) return;
  _expandedOverlay.classList.remove('open');
  const el = _expandedOverlay;
  _expandedOverlay = null;
  _expandedDateKey  = null;
  setTimeout(() => el.remove(), 320);
}

// ── Add-event modal ────────────────────────────────────────────────────────

let _addEventSheet    = null;
let _addEventBackdrop = null;

function openAddEventModal(dateKey, existing = null, editMode = 'normal') {
  closeAddEventModal();
  history.pushState({ chronicle: 'modal', modal: 'addEvent' }, '');

  const isEdit = !!existing?.id;
  const type   = existing?.type  ?? 'event';
  const title  = existing?.title ?? '';
  const time   = existing?.time  ?? '';
  const notes  = existing?.notes ?? '';
  const reminder = existing?.reminderMinutes ?? '';
  const theme  = existing?.theme ?? '';
  const reminderPresets  = [0, 15, 60, 1440, 10080];
  const isCustomReminder = reminder !== '' && !reminderPresets.includes(reminder);
  const customDays       = isCustomReminder ? Math.round(reminder / 1440) : '';

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.style.pointerEvents = 'none';
  setTimeout(() => { backdrop.style.pointerEvents = ''; }, 350);
  backdrop.addEventListener('click', () => history.back());

  const sheet = document.createElement('div');
  sheet.className = 'bottom-sheet';

  sheet.innerHTML = `
    <div class="sheet-handle"></div>
    <div class="sheet-header">
      <button class="sheet-cancel" id="sheetCancel">${STRINGS.cancel}</button>
      <span class="sheet-title">${isEdit ? 'Edit' : 'New'} Entry</span>
      <button class="sheet-save" id="sheetSave">${STRINGS.save}</button>
    </div>

    <div class="sheet-body">

      <div class="field-group">
        <label class="field-label" for="evtTitle">Title</label>
        <div class="field-input event-title-input" id="evtTitle"
             contenteditable="true" role="textbox" spellcheck="true"
             data-placeholder="Entry title" aria-label="Entry title"></div>
      </div>

      <div class="field-group">
        <label class="field-label">Theme</label>
        <input type="hidden" id="evtTheme" value="${esc(theme)}">
        <div class="evt-theme-pills" id="evtThemePills">
          <button type="button" class="evt-theme-pill${!theme ? ' active' : ''}" data-theme="">None</button>
        </div>
      </div>

      <div class="field-group">
        <label class="field-label">Type</label>
        <div class="segmented-control" id="typeControl">
          <div class="seg-btn ${type === 'event' ? 'active' : ''}" data-type="event">Event</div>
          <div class="seg-btn ${type === 'todo' ? 'active' : ''}" data-type="todo">Todo</div>
        </div>
      </div>

      <div class="field-group">
        <label class="field-label" for="evtDate">Start date</label>
        <input class="field-input" id="evtDate" type="date" value="${esc(dateKey)}">
      </div>

      <div class="field-group">
        <label class="field-label" for="evtEndDate">End date <span style="color:var(--text-tertiary);font-weight:400">(optional)</span></label>
        <input class="field-input" id="evtEndDate" type="date" value="${esc(existing?.endDate ?? '')}">
      </div>

      <div class="field-group">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
          <label class="field-label" for="evtTime" style="margin-bottom:0">Time</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-secondary);cursor:pointer">
            <input type="checkbox" id="evtAllDay" ${!time ? 'checked' : ''}> All day
          </label>
        </div>
        <input class="field-input" id="evtTime" type="time" value="${esc(time)}" style="${!time ? 'display:none' : ''}">
      </div>

      <div class="field-group" id="reminderGroup">
        <label class="field-label" for="evtReminder">Reminder</label>
        <select class="field-input" id="evtReminder">
          <option value="">None</option>
          <option value="0"     ${reminder === 0     ? 'selected' : ''}>At time of event</option>
          <option value="15"    ${reminder === 15    ? 'selected' : ''}>15 minutes before</option>
          <option value="60"    ${reminder === 60    ? 'selected' : ''}>1 hour before</option>
          <option value="1440"  ${reminder === 1440  ? 'selected' : ''}>1 day before</option>
          <option value="10080" ${reminder === 10080 ? 'selected' : ''}>1 week before</option>
          <option value="custom" ${isCustomReminder  ? 'selected' : ''}>Custom</option>
        </select>
        <input class="field-input" id="evtReminderCustom" type="number" min="1"
               placeholder="Days before event"
               value="${customDays}"
               style="margin-top:6px;${isCustomReminder ? '' : 'display:none'}">
      </div>

      <!-- Repeat Frequency -->
      <div class="field-group">
        <label class="field-label" for="evtRepeat">Repeat</label>
        <select class="field-input" id="evtRepeat">
          <option value="">None</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
        </select>
      </div>

      <!-- Interval -->
      <div class="field-group hidden" id="repeatIntervalGroup">
        <label class="field-label" for="repeatInterval">Every</label>
        <div style="display:flex;gap:8px;align-items:center;">
          <input class="field-input" id="repeatInterval" type="number" min="1" value="1" style="width:80px;">
          <span id="repeatIntervalLabel">days</span>
        </div>
      </div>

      <!-- Weekly weekday picker -->
      <div class="field-group hidden" id="repeatWeekdaysGroup">
        <label class="field-label">On</label>
        <div class="weekday-picker" id="repeatWeekdays">
          <button type="button" data-day="1">Mon</button>
          <button type="button" data-day="2">Tue</button>
          <button type="button" data-day="3">Wed</button>
          <button type="button" data-day="4">Thu</button>
          <button type="button" data-day="5">Fri</button>
          <button type="button" data-day="6">Sat</button>
          <button type="button" data-day="0">Sun</button>
        </div>
      </div>

      <!-- End conditions -->
      <div class="field-group hidden" id="repeatEndGroup">
        <label class="field-label">Ends</label>
        <div class="repeat-end-options">
          <label><input type="radio" name="repeatEnd" value="never" checked> Never</label>
          <label style="display:flex;align-items:center;gap:6px;">
            <input type="radio" name="repeatEnd" value="after">
            After
            <input class="field-input" id="repeatEndCount" type="number" min="1" value="10" style="width:80px;">
            occurrences
          </label>
          <label style="display:flex;align-items:center;gap:6px;">
            <input type="radio" name="repeatEnd" value="on">
            On
            <input class="field-input" id="repeatEndDate" type="date">
          </label>
        </div>
      </div>

      <div class="field-group">
        <label class="field-label" for="evtNotes">Notes (optional)</label>
        <textarea class="field-input field-textarea" id="evtNotes"
                  placeholder="Additional notes…">${esc(notes)}</textarea>
      </div>

    </div>
  `;

  document.body.appendChild(backdrop);
  document.body.appendChild(sheet);
  _addEventBackdrop = backdrop;
  _addEventSheet    = sheet;

  // Populate contenteditable title (must be done after DOM insertion)
  const titleEl = sheet.querySelector('#evtTitle');
  if (title) {
    if (/<[a-z]/i.test(title)) {
      titleEl.innerHTML = title;
    } else {
      titleEl.textContent = title;
    }
  }
  titleEl.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); }
  });

  // ── All day checkbox ─────────────────────────────────────────────────────
  const allDayCheckbox = sheet.querySelector('#evtAllDay');
  const timeInput      = sheet.querySelector('#evtTime');
  allDayCheckbox.addEventListener('change', () => {
    timeInput.style.display = allDayCheckbox.checked ? 'none' : '';
    if (allDayCheckbox.checked) timeInput.value = '';
  });

  // ── Theme pill selector ──────────────────────────────────────────────────
  const evtThemeInput = sheet.querySelector('#evtTheme');
  const pillsContainer = sheet.querySelector('#evtThemePills');
  const effectiveThemes = getEffectiveEventThemes(state.data.settings);

  effectiveThemes.forEach(t => {
    const isDark = state.data.settings.theme === 'dark';
    const bg   = isDark ? t.dark.bg   : t.light.bg;
    const text = isDark ? t.dark.text : t.light.text;
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'evt-theme-pill' + (theme === t.id ? ' active' : '');
    pill.dataset.theme = t.id;
    pill.textContent = t.name;
    pill.style.cssText = `background:${bg};color:${text};`;
    pillsContainer.appendChild(pill);
  });

  const updateTitleTheme = () => {
    const sel = evtThemeInput.value;
    if (!sel) {
      titleEl.style.background = '';
      titleEl.style.color = '';
    } else {
      const t = effectiveThemes.find(x => x.id === sel);
      if (t) {
        const isDark = state.data.settings.theme === 'dark';
        titleEl.style.background = isDark ? t.dark.bg : t.light.bg;
        titleEl.style.color      = isDark ? t.dark.text : t.light.text;
      }
    }
  };

  pillsContainer.addEventListener('click', e => {
    const pill = e.target.closest('.evt-theme-pill');
    if (!pill) return;
    evtThemeInput.value = pill.dataset.theme;
    pillsContainer.querySelectorAll('.evt-theme-pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    updateTitleTheme();
  });

  updateTitleTheme();

  // -----------------------------
  // REPEAT UI JS (correct place)
  // -----------------------------

  const repeatSelect = sheet.querySelector('#evtRepeat');
  const intervalGroup = sheet.querySelector('#repeatIntervalGroup');
  const intervalInput = sheet.querySelector('#repeatInterval');
  const intervalLabel = sheet.querySelector('#repeatIntervalLabel');
  const weekdaysGroup = sheet.querySelector('#repeatWeekdaysGroup');
  const weekdaysButtons = sheet.querySelectorAll('#repeatWeekdays button');
  const endGroup = sheet.querySelector('#repeatEndGroup');
  const endRadios = sheet.querySelectorAll('input[name="repeatEnd"]');
  const endCount = sheet.querySelector('#repeatEndCount');
  const endDate = sheet.querySelector('#repeatEndDate');

  repeatSelect.addEventListener('change', () => {
    const freq = repeatSelect.value;
    const show = freq !== '';

    intervalGroup.classList.toggle('hidden', !show);
    endGroup.classList.toggle('hidden', !show);
    weekdaysGroup.classList.toggle('hidden', freq !== 'weekly');

    intervalLabel.textContent =
      freq === 'daily' ? 'days' :
      freq === 'weekly' ? 'weeks' :
      freq === 'monthly' ? 'months' :
      'years';

    // Auto-select the event's start date weekday when switching to weekly
    // and no days are currently selected
    if (freq === 'weekly') {
      const anyActive = [...weekdaysButtons].some(b => b.classList.contains('active'));
      if (!anyActive) {
        const startWeekday = parseDate(sheet.querySelector('#evtDate').value || dateKey).getDay();
        const btn = sheet.querySelector(`#repeatWeekdays button[data-day="${startWeekday}"]`);
        if (btn) btn.classList.add('active');
      }
    }
  });

  weekdaysButtons.forEach(btn => {
    btn.addEventListener('click', () => btn.classList.toggle('active'));
  });

  // -----------------------------
  // PREFILL WHEN EDITING
  // -----------------------------
  if (existing?.repeat) {
    const r = existing.repeat;

    repeatSelect.value = r.freq;

    // Manually show/hide groups without firing the change event — firing it
    // would trigger the auto-select logic before byWeekday is applied, adding
    // a phantom weekday to the selection.
    const show = r.freq !== '';
    intervalGroup.classList.toggle('hidden', !show);
    endGroup.classList.toggle('hidden', !show);
    weekdaysGroup.classList.toggle('hidden', r.freq !== 'weekly');
    intervalLabel.textContent =
      r.freq === 'daily' ? 'days' : r.freq === 'weekly' ? 'weeks' :
      r.freq === 'monthly' ? 'months' : 'years';

    intervalInput.value = r.interval;

    if (r.freq === 'weekly' && r.byWeekday) {
      r.byWeekday.forEach(d => {
        const btn = sheet.querySelector(`#repeatWeekdays button[data-day="${d}"]`);
        if (btn) btn.classList.add('active');
      });
    }

    if (r.end.type === 'never') {
      sheet.querySelector('input[name="repeatEnd"][value="never"]').checked = true;
    }
    if (r.end.type === 'after') {
      sheet.querySelector('input[name="repeatEnd"][value="after"]').checked = true;
      endCount.value = r.end.count;
    }
    if (r.end.type === 'on') {
      sheet.querySelector('input[name="repeatEnd"][value="on"]').checked = true;
      endDate.value = r.end.date;
    }
  }

  // -----------------------------
  // SAVE HANDLER
  // -----------------------------

  let selectedType = type;

  sheet.querySelectorAll('.seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedType = btn.dataset.type;
      sheet.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b === btn));
    });
  });

  sheet.querySelector('#evtReminder').addEventListener('change', function() {
    const custom = sheet.querySelector('#evtReminderCustom');
    custom.style.display = this.value === 'custom' ? '' : 'none';
    if (this.value === 'custom') custom.focus();
  });

  sheet.querySelector('#sheetCancel').addEventListener('click', () => history.back());

  sheet.querySelector('#sheetSave').addEventListener('click', () => {
    const titleEl  = sheet.querySelector('#evtTitle');
    const titleVal = titleEl.innerHTML.trim();
    if (!titleEl.textContent.trim()) { titleEl.focus(); return; }

    const dateVal    = sheet.querySelector('#evtDate').value || dateKey;
    const endDateRaw = sheet.querySelector('#evtEndDate').value;
    const allDayVal  = sheet.querySelector('#evtAllDay').checked;
    const timeVal    = allDayVal ? null : (sheet.querySelector('#evtTime').value || null);
    const endDateVal = endDateRaw && endDateRaw > dateVal ? endDateRaw : null;
    const notesVal   = sheet.querySelector('#evtNotes').value;
    const themeVal   = sheet.querySelector('#evtTheme').value || null;
    const reminderRaw = sheet.querySelector('#evtReminder').value;
    const reminderVal = reminderRaw === ''       ? null
                      : reminderRaw === 'custom' ? ((Number(sheet.querySelector('#evtReminderCustom').value) || 0) * 1440 || null)
                      : Number(reminderRaw);

    pushUndo(JSON.parse(JSON.stringify(state.data)));

    // Build repeat rule
let repeat = null;
const freq = repeatSelect.value.trim();

// Only build a repeat rule if the user actually selected a frequency
if (freq === 'daily' || freq === 'weekly' || freq === 'monthly' || freq === 'yearly') {
  const interval = Number(intervalInput.value);

  let byWeekday = null;
  if (freq === 'weekly') {
    byWeekday = [...weekdaysButtons]
      .filter(btn => btn.classList.contains('active'))
      .map(btn => Number(btn.dataset.day));
  }

  const endType = [...endRadios].find(r => r.checked).value;
  let endCountVal = null;
  let endDateVal = null;

  if (endType === 'after') endCountVal = Number(endCount.value);
  if (endType === 'on') endDateVal = endDate.value;

  repeat = createRepeatRule(freq, interval, byWeekday, endType, endCountVal, endDateVal);
}


    if (isEdit && editMode === 'series') {
      updateSeries(state.data, existing.id, {
        title: titleVal,
        type: selectedType,
        time: timeVal || null,
        notes: notesVal,
        reminderMinutes: reminderVal,
        theme: themeVal,
        repeat,
      });
    } else if (isEdit && editMode === 'exception') {
      const exSeries = state.data.series.find(s => s.id === existing.seriesId);
      if (exSeries) {
        if (!exSeries.exceptions) exSeries.exceptions = {};
        exSeries.exceptions[dateKey] = {
          ...existing,
          title: titleVal,
          type: selectedType,
          time: timeVal || null,
          notes: notesVal,
          reminderMinutes: reminderVal,
          theme: themeVal,
          modified: Date.now(),
        };
      }
    } else if (isEdit) {
      if (repeat) {
        // Converting a non-recurring event to a recurring series
        const oldEvt = state.data.days[dateKey]?.events?.find(e => e.id === existing.id);
        if (oldEvt?.googleEventId) {
          oldEvt.syncStatus = 'deleted';
        } else if (oldEvt) {
          deleteEvent(state.data, dateKey, existing.id);
        }
        addEvent(state.data, dateVal, {
          title: titleVal,
          type: selectedType,
          time: timeVal,
          notes: notesVal,
          reminderMinutes: reminderVal,
          theme: themeVal,
          repeat,
        });
      } else {
        updateEvent(state.data, dateKey, existing.id, {
          title: titleVal,
          type: selectedType,
          time: timeVal,
          endDate: endDateVal,
          notes: notesVal,
          reminderMinutes: reminderVal,
          theme: themeVal,
          repeat: null,
        });
      }
    } else {
      addEvent(state.data, dateVal, {
        title: titleVal,
        type: selectedType,
        time: timeVal,
        endDate: endDateVal,
        notes: notesVal,
        reminderMinutes: reminderVal,
        theme: themeVal,
        repeat,
      });
    }

    saveData();
    refreshVisibleWeekCards();
    if (_expandedOverlay && _expandedDateKey) {
      renderExpandedEvents(_expandedOverlay, _expandedDateKey);
    }
    closeAddEventModal();
  });

  sheet.addEventListener('focusin', e => {
    const t = e.target;
    if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') {
      setTimeout(() => t.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 300);
    }
  });

  requestAnimationFrame(() => sheet.classList.add('open'));
  setTimeout(() => { const t = sheet.querySelector('#evtTitle'); t?.focus(); placeCursorAtEnd(t); }, 350);
}


function closeAddEventModal() {
  if (_addEventSheet) {
    _addEventSheet.classList.remove('open');
    const el = _addEventSheet;
    _addEventSheet = null;
    setTimeout(() => el.remove(), 320);
  }
  _addEventBackdrop?.remove();
  _addEventBackdrop = null;
}

function openRepeatActionSheet(evt, dateKey, mode) {
  const sheet = document.createElement('div');
  sheet.className = 'bottom-sheet';
  sheet.innerHTML = `
    <div class="sheet-handle"></div>
    <div class="sheet-header">
      <span class="sheet-title">
        ${mode === 'edit' ? 'Edit repeating event' : 'Delete repeating event'}
      </span>
      <button class="sheet-cancel">${STRINGS.cancel}</button>
    </div>
    <div class="sheet-body">
      <div class="quick-action-item" data-action="single">
        ${mode === 'edit' ? 'This event only' : 'Delete this event only'}
      </div>
      <div class="quick-action-item quick-action-item--destructive" data-action="series">
        ${mode === 'edit' ? 'Entire series' : 'Delete entire series'}
      </div>
    </div>
  `;
  document.body.appendChild(sheet);

  const close = () => {
    sheet.classList.remove('open');
    setTimeout(() => sheet.remove(), 200);
  };

  sheet.querySelector('.sheet-cancel').addEventListener('click', close);
  sheet.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      close();
      if (mode === 'edit') handleRepeatEdit(evt, dateKey, action);
      else handleRepeatDelete(evt, dateKey, action);
    });
  });

  requestAnimationFrame(() => sheet.classList.add('open'));
}

function handleRepeatEdit(evt, dateKey, action) {
  const series = getSeriesForOccurrence(evt);
  if (!series) return;

  if (action === "single") {
    if (!series.exceptions) series.exceptions = {};
    if (!series.exceptions[dateKey]) {
      series.exceptions[dateKey] = {
        ...evt,
        isOccurrence: true,
        seriesId: series.id,
        date: dateKey,
      };
      saveData();
    }
    openAddEventModal(dateKey, series.exceptions[dateKey], "exception");
    return;
  }

  if (action === "series") {
    openAddEventModal(series.startDate, {
      id: series.id,
      type: series.type,
      title: series.title,
      time: series.time,
      notes: series.notes,
      reminderMinutes: series.reminderMinutes,
      theme: series.theme || null,
      repeat: series.repeat,
    }, "series");
  }
}

function handleRepeatDelete(evt, dateKey, action) {
  const series = getSeriesForOccurrence(evt);
  if (!series) return;

  if (action === "single") {
    if (!series.exceptions) series.exceptions = {};
    series.exceptions[dateKey] = null;
    saveData();
    refreshVisibleWeekCards();
    if (_expandedOverlay && _expandedDateKey) {
      renderExpandedEvents(_expandedOverlay, _expandedDateKey);
    }
    return;
  }

  if (action === "series") {
    if (series.googleEventId) {
      if (!state.data.deletedSeriesGCalIds) state.data.deletedSeriesGCalIds = [];
      state.data.deletedSeriesGCalIds.push({
        googleEventId:    series.googleEventId,
        googleCalendarId: series.googleCalendarId,
      });
    }
    state.data.series = state.data.series.filter(s => s.id !== series.id);
    saveData();
    refreshVisibleWeekCards();
    if (_expandedOverlay && _expandedDateKey) {
      renderExpandedEvents(_expandedOverlay, _expandedDateKey);
    }
  }
}


// ── Quick actions sheet ────────────────────────────────────────────────────

let _qaSheet    = null;
let _qaBackdrop = null;

function openQuickActions(dateKey) {
  closeQuickActions();
  history.pushState({ chronicle: 'modal', modal: 'qa' }, '');

  const date  = parseDate(dateKey);
  const label = date.toLocaleDateString('default', { weekday: 'long', day: 'numeric', month: 'short' });

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.style.pointerEvents = 'none';
  setTimeout(() => { backdrop.style.pointerEvents = ''; }, 350);
  backdrop.addEventListener('click', () => history.back());

  const sheet = document.createElement('div');
  sheet.className = 'bottom-sheet';
  sheet.innerHTML = `
    <div class="sheet-handle"></div>
    <div class="sheet-header">
      <span class="sheet-title">${esc(label)}</span>
      <button class="sheet-cancel" id="qaCancel">${STRINGS.cancel}</button>
    </div>
    <div class="quick-actions">
      <div class="quick-action-item${canUndo() ? '' : ' quick-action-item--disabled'}" data-action="undo" role="button" tabindex="0">
        <div class="quick-action-icon" style="font-size:16px;">↩</div>
        Undo
      </div>
      <div class="quick-action-item${canRedo() ? '' : ' quick-action-item--disabled'}" data-action="redo" role="button" tabindex="0">
        <div class="quick-action-icon" style="font-size:16px;">↪</div>
        Redo
      </div>
      <div class="quick-action-item" data-action="event" role="button" tabindex="0">
        <div class="quick-action-icon"><svg class="icon"><use href="assets/icons.svg#icon-calendar"/></svg></div>
        ${STRINGS.addEvent}
      </div>
      <div class="quick-action-item" data-action="todo" role="button" tabindex="0">
        <div class="quick-action-icon"><svg class="icon"><use href="assets/icons.svg#icon-check"/></svg></div>
        ${STRINGS.addTodo}
      </div>
      <div class="quick-action-item" data-action="expand" role="button" tabindex="0">
        <div class="quick-action-icon"><svg class="icon"><use href="assets/icons.svg#icon-expand"/></svg></div>
        ${STRINGS.expandDay}
      </div>
      <div class="quick-action-item" data-action="copy" role="button" tabindex="0">
        <div class="quick-action-icon"><svg class="icon"><use href="assets/icons.svg#icon-copy"/></svg></div>
        ${STRINGS.copyDay}
      </div>
      <div class="quick-action-item quick-action-item--destructive" data-action="clear" role="button" tabindex="0">
        <div class="quick-action-icon"><svg class="icon"><use href="assets/icons.svg#icon-trash"/></svg></div>
        ${STRINGS.clearDay}
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);
  document.body.appendChild(sheet);
  _qaBackdrop = backdrop;
  _qaSheet    = sheet;

  

  sheet.querySelector('#qaCancel').addEventListener('click', () => history.back());

  sheet.querySelectorAll('.quick-action-item').forEach(item => {
    const activate = () => {
      const action = item.dataset.action;
      closeQuickActions();
      handleQuickAction(action, dateKey, date);
    };
    item.addEventListener('click', activate);
    item.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') activate(); });
  });

  requestAnimationFrame(() => sheet.classList.add('open'));
}

function handleQuickAction(action, dateKey, date) {
  switch (action) {
    case 'event':    openAddEventModal(dateKey); break;
    case 'todo':     openAddEventModal(dateKey, { type: 'todo', title: '', time: null, notes: '', done: false, reminderMinutes: null }); break;
    case 'expand':   openExpandedDay(dateKey); break;
    case 'copy':     copyDayEntries(dateKey); break;
    case 'clear':
      if (confirm(STRINGS.confirmClearDay)) {
        pushUndo(JSON.parse(JSON.stringify(state.data)));
        if (state.data.days[dateKey]) {
          state.data.days[dateKey].events = [];
          state.data.days[dateKey].diary  = '';
        }
        for (const s of state.data.series) {
          if (generateOccurrencesForSeries(s, dateKey)) {
            if (!s.exceptions) s.exceptions = {};
            s.exceptions[dateKey] = null;
          }
        }
        saveData();
        renderWeekGrid();
      }
      break;
    case 'undo': handleUndo(); break;
    case 'redo': handleRedo(); break;
  }
}

function copyDayEntries(dateKey) {
  const day = state.data.days[dateKey];
  if (!day || (!day.diary && !day.events?.length)) {
    showToast(STRINGS.nothingToCopy);
    return;
  }
  const lines = [];
  if (day.events?.length) {
    lines.push('Events:');
    day.events.forEach(e => lines.push(`  [${e.type}] ${e.time ? e.time + ' ' : ''}${e.title}`));
  }
  if (day.diary) {
    const plain = new DOMParser().parseFromString(day.diary, 'text/html').body.textContent || day.diary;
    lines.push('', 'Diary:', plain);
  }
  navigator.clipboard?.writeText(lines.join('\n'))
    .then(() => showToast(STRINGS.copiedToast))
    .catch(() => showToast('Copy failed'));
}

function closeQuickActions() {
  if (_qaSheet) {
    _qaSheet.classList.remove('open');
    const el = _qaSheet;
    _qaSheet = null;
    setTimeout(() => el.remove(), 320);
  }
  _qaBackdrop?.remove();
  _qaBackdrop = null;
}

// ── Settings dropdown ──────────────────────────────────────────────────────

let _settingsDropdown = null;
let _settingsBackdrop = null;

const MONTH_NAMES = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];

function openSettingsDropdown() {
  if (_settingsDropdown) { closeSettingsDropdown(); return; }
  history.pushState({ chronicle: 'modal', modal: 'settings' }, '');

  const { theme, weekStart, notifications, gdrive, fyStartMonth = 3, fyStartDay = 6,
          agendaBeforeDays = 14, agendaAheadDays = 60, diaryFontSize = 'medium',
          holidays: holidaySettings = { enabled: true, hidden: [] } } = state.data.settings;
  const lastSyncStr = gdrive.lastSync
    ? STRINGS.lastSync.replace('{t}', new Date(gdrive.lastSync).toLocaleString())
    : STRINGS.neverSynced;

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.style.pointerEvents = 'none';
  setTimeout(() => { backdrop.style.pointerEvents = ''; }, 350);
  backdrop.addEventListener('click', () => history.back());

  const dropdown = document.createElement('div');
  dropdown.className = 'settings-dropdown';

  const fyMonthOptions = MONTH_NAMES.map((n, i) =>
    `<option value="${i}" ${i === fyStartMonth ? 'selected' : ''}>${n.slice(0,3)}</option>`
  ).join('');

  const { uiTheme = 'default', customUIThemes = [], uiThemeCustomVars = {} } = state.data.settings;
  const isDarkMode = state.data.settings.theme === 'dark';
  const allUIThemes = [...BUILTIN_UI_THEMES, ...customUIThemes];
  const swatchRowHTML = `
    <div class="te-swatch-row" style="padding:4px 0 2px">
      ${allUIThemes.map(t => {
        const modeVars = t.id === uiTheme
          ? { ...t[isDarkMode ? 'dark' : 'light'], ...(uiThemeCustomVars[isDarkMode ? 'dark' : 'light'] || {}) }
          : t[isDarkMode ? 'dark' : 'light'];
        const swatchColor = modeVars['--day-header-bg'] || t.swatch || '#888';
        return `<div class="te-swatch-mini ${t.id === uiTheme ? 'active' : ''}"
             style="background:${swatchColor}"
             data-swatch-theme="${t.id}"
             title="${t.name}"></div>`;
      }).join('')}
    </div>
  `;

  dropdown.innerHTML = `
    <div class="settings-group open" id="sg-undo">
      <div class="settings-group-body" style="display:block">
        <div class="settings-section">
          <div class="settings-row${canUndo() ? '' : ' quick-action-item--disabled'}" data-action="undo" style="cursor:${canUndo() ? 'pointer' : 'default'}">
            <span class="settings-action" style="font-size:14px">↩ Undo</span>
          </div>
          <div class="settings-row${canRedo() ? '' : ' quick-action-item--disabled'}" data-action="redo" style="cursor:${canRedo() ? 'pointer' : 'default'}">
            <span class="settings-action" style="font-size:14px">↪ Redo</span>
          </div>
        </div>
      </div>
    </div>
    <div class="settings-group" id="sg-appearance">
      <div class="settings-group-header" data-toggle="sg-appearance">
        <span class="settings-group-label">Appearance</span>
        <svg class="icon settings-chevron"><use href="assets/icons.svg#icon-chevron-right"/></svg>
      </div>
      <div class="settings-group-body">
        <div class="settings-section">
          <div class="settings-row">
            <div class="settings-label">Theme</div>
            <div class="toggle-pill">
              <div class="toggle-pill-btn ${theme === 'light' ? 'active' : ''}" data-theme="light">Light</div>
              <div class="toggle-pill-btn ${theme === 'dark'  ? 'active' : ''}" data-theme="dark">Dark</div>
            </div>
          </div>
          <div class="settings-row">
            <div class="settings-label">Diary text size</div>
            <div class="toggle-pill">
              <div class="toggle-pill-btn ${diaryFontSize === 'small'  ? 'active' : ''}" data-diary-size="small">S</div>
              <div class="toggle-pill-btn ${diaryFontSize === 'medium' ? 'active' : ''}" data-diary-size="medium">M</div>
              <div class="toggle-pill-btn ${diaryFontSize === 'large'  ? 'active' : ''}" data-diary-size="large">L</div>
            </div>
          </div>
          <div class="settings-row" style="flex-direction:column;align-items:flex-start;gap:6px">
            <div class="settings-label">Colour theme</div>
            ${swatchRowHTML}
          </div>
          <div class="settings-row" data-action="openThemeEditor"><span class="settings-action">Customise themes…</span></div>
        </div>
      </div>
    </div>
    <div class="settings-group" id="sg-calendar">
      <div class="settings-group-header" data-toggle="sg-calendar">
        <span class="settings-group-label">Calendar</span>
        <svg class="icon settings-chevron"><use href="assets/icons.svg#icon-chevron-right"/></svg>
      </div>
      <div class="settings-group-body">
        <div class="settings-section">
          <div class="settings-row">
            <div class="settings-label">Week starts</div>
            <div class="toggle-pill">
              <div class="toggle-pill-btn ${weekStart === 'mon' ? 'active' : ''}" data-week="mon">Mon</div>
              <div class="toggle-pill-btn ${weekStart === 'sun' ? 'active' : ''}" data-week="sun">Sun</div>
            </div>
          </div>
          <div class="settings-row" style="gap:6px">
            <div>
              <div class="settings-label">FY Week 1 start</div>
              <div class="settings-sublabel">Financial year week numbering</div>
            </div>
            <div style="display:flex;gap:4px;align-items:center;flex-shrink:0">
              <select id="settingsFyMonth" style="font-size:11px;padding:3px 5px;border:0.5px solid var(--color-border-strong);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary)">
                ${fyMonthOptions}
              </select>
              <input id="settingsFyDay" type="number" min="1" max="31" value="${fyStartDay}"
                     style="width:42px;font-size:11px;padding:3px 5px;border:0.5px solid var(--color-border-strong);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);text-align:center">
            </div>
          </div>
          <div class="settings-row" style="gap:6px">
            <div>
              <div class="settings-label">Agenda date range</div>
              <div class="settings-sublabel">Recurring events shown in agenda</div>
            </div>
            <div style="display:flex;gap:8px;align-items:flex-end;flex-shrink:0">
              <div style="display:flex;flex-direction:column;align-items:center;gap:2px">
                <span style="font-size:10px;color:var(--text-tertiary)">Before</span>
                <select id="settingsAgendaBefore" style="font-size:11px;padding:3px 5px;border:0.5px solid var(--color-border-strong);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary)">
                  <option value="0"  ${agendaBeforeDays === 0  ? 'selected' : ''}>None</option>
                  <option value="7"  ${agendaBeforeDays === 7  ? 'selected' : ''}>1 wk</option>
                  <option value="14" ${agendaBeforeDays === 14 ? 'selected' : ''}>2 wks</option>
                </select>
              </div>
              <div style="display:flex;flex-direction:column;align-items:center;gap:2px">
                <span style="font-size:10px;color:var(--text-tertiary)">After</span>
                <select id="settingsAgendaAhead" style="font-size:11px;padding:3px 5px;border:0.5px solid var(--color-border-strong);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary)">
                  <option value="7"   ${agendaAheadDays === 7   ? 'selected' : ''}>1 wk</option>
                  <option value="14"  ${agendaAheadDays === 14  ? 'selected' : ''}>2 wks</option>
                  <option value="30"  ${agendaAheadDays === 30  ? 'selected' : ''}>1 mo</option>
                  <option value="60"  ${agendaAheadDays === 60  ? 'selected' : ''}>2 mo</option>
                  <option value="180" ${agendaAheadDays === 180 ? 'selected' : ''}>6 mo</option>
                  <option value="365" ${agendaAheadDays === 365 ? 'selected' : ''}>1 yr</option>
                </select>
              </div>
            </div>
          </div>
          <div class="settings-row">
            <div class="settings-label">UK Bank Holidays</div>
            <div class="toggle-pill">
              <div class="toggle-pill-btn ${holidaySettings.enabled  ? 'active' : ''}" data-holidays="on">On</div>
              <div class="toggle-pill-btn ${!holidaySettings.enabled ? 'active' : ''}" data-holidays="off">Off</div>
            </div>
          </div>
          <div class="settings-row" data-action="manageHolidays"><span class="settings-action">Manage bank holidays</span></div>
          <div class="settings-row" data-action="about"><span class="settings-action">About / Help</span></div>
        </div>
      </div>
    </div>
    <div class="settings-group" id="sg-data">
      <div class="settings-group-header" data-toggle="sg-data">
        <span class="settings-group-label">Data</span>
        <svg class="icon settings-chevron"><use href="assets/icons.svg#icon-chevron-right"/></svg>
      </div>
      <div class="settings-group-body">
        <div class="settings-section">
          <div class="settings-row" data-action="export"><span class="settings-action">Export JSON</span></div>
          <div class="settings-row" data-action="exportIcal"><span class="settings-action">Export iCal (.ics)</span></div>
          <div class="settings-row" data-action="import"><span class="settings-action">Import JSON</span></div>
          <div class="settings-row" data-action="clearall"><span class="settings-action settings-action--destructive">Clear all data</span></div>
        </div>
      </div>
    </div>
    <div class="settings-group" id="sg-sync">
      <div class="settings-group-header" data-toggle="sg-sync">
        <span class="settings-group-label">Sync</span>
        <svg class="icon settings-chevron"><use href="assets/icons.svg#icon-chevron-right"/></svg>
      </div>
      <div class="settings-group-body">
        <div class="settings-section">
          <div class="settings-row">
            <div>
              <div class="settings-label">Notifications</div>
              ${typeof Notification !== 'undefined' && Notification.permission === 'denied'
                ? '<div class="settings-sublabel settings-sublabel--warn">Blocked by browser — allow in site settings</div>'
                : ''}
            </div>
            <div class="toggle-pill">
              <div class="toggle-pill-btn ${notifications  ? 'active' : ''}" data-notif="on">On</div>
              <div class="toggle-pill-btn ${!notifications ? 'active' : ''}" data-notif="off">Off</div>
            </div>
          </div>
          <div class="settings-row">
            <div>
              <div class="settings-label">Google Drive Backup</div>
              <div class="settings-sublabel">${esc(lastSyncStr)}</div>
            </div>
            ${gdriveState.userEmail
              ? `<button class="settings-gdrive-btn" data-gdrive-action="signout">${esc(gdriveState.userEmail)}</button>`
              : `<button class="settings-gdrive-btn" data-gdrive-action="signin">Sign in</button>`}
          </div>
          <div class="settings-row">
            <div class="settings-label">Background sync</div>
            <div class="toggle-pill">
              <div class="toggle-pill-btn ${gdrive.enabled  ? 'active' : ''}" data-gdrive="on">On</div>
              <div class="toggle-pill-btn ${!gdrive.enabled ? 'active' : ''}" data-gdrive="off">Off</div>
            </div>
          </div>
        </div>
        <div class="settings-section" style="border-top:0.5px solid var(--color-border)">
          <div class="settings-row">
            <div>
              <div class="settings-label">Google Calendar</div>
              ${gdriveState.userEmail
                ? `<div class="settings-sublabel">${esc(gdriveState.userEmail)}</div>`
                : '<div class="settings-sublabel">Sign in above to enable</div>'}
            </div>
            <div style="display:flex;flex-direction:column;gap:5px;flex-shrink:0">
              ${gdriveState.userEmail
                ? `<button class="settings-gdrive-btn" data-gcal-action="sync">Sync</button>
                   <button class="settings-gdrive-btn" data-gcal-action="signout">Sign out</button>`
                : ''}
            </div>
          </div>
          <div id="gcalCalendarList"></div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);
  document.body.appendChild(dropdown);
  _settingsBackdrop = backdrop;
  _settingsDropdown = dropdown;

  dropdown.querySelectorAll('[data-theme]').forEach(btn => {
    btn.addEventListener('click', () => {
      applyTheme(btn.dataset.theme);
      saveData();
      dropdown.querySelectorAll('[data-theme]').forEach(b => b.classList.toggle('active', b === btn));
    });
  });

  dropdown.querySelectorAll('[data-swatch-theme]').forEach(swatch => {
    swatch.addEventListener('click', () => {
      state.data.settings.uiTheme = swatch.dataset.swatchTheme;
      state.data.settings.uiThemeCustomVars = { light: {}, dark: {} };
      applyUITheme(state.data.settings);
      saveData();
      dropdown.querySelectorAll('[data-swatch-theme]').forEach(s => s.classList.toggle('active', s === swatch));
    });
  });

  dropdown.querySelectorAll('[data-diary-size]').forEach(btn => {
    btn.addEventListener('click', () => {
      const size = btn.dataset.diarySize;
      state.data.settings.diaryFontSize = size;
      applyDiaryFontSize(size);
      saveData();
      dropdown.querySelectorAll('[data-diary-size]').forEach(b => b.classList.toggle('active', b === btn));
    });
  });

  dropdown.querySelectorAll('[data-week]').forEach(btn => {
    btn.addEventListener('click', () => {
      const ws = btn.dataset.week;
      state.data.settings.weekStart = ws;
      state.currentWeekStart = getWeekStart(state.currentWeekStart, ws);
      saveData();
      renderWeekGrid();
      dropdown.querySelectorAll('[data-week]').forEach(b => b.classList.toggle('active', b === btn));
    });
  });

  dropdown.querySelector('#settingsAgendaBefore').addEventListener('change', e => {
    state.data.settings.agendaBeforeDays = Number(e.target.value);
    saveData();
  });

  dropdown.querySelector('#settingsAgendaAhead').addEventListener('change', e => {
    state.data.settings.agendaAheadDays = Number(e.target.value);
    saveData();
  });

  dropdown.querySelector('#settingsFyMonth').addEventListener('change', e => {
    state.data.settings.fyStartMonth = Number(e.target.value);
    saveData();
    updateRibbonLabels();
  });

  dropdown.querySelector('#settingsFyDay').addEventListener('change', e => {
    const d = Math.max(1, Math.min(31, Number(e.target.value)));
    state.data.settings.fyStartDay = d;
    e.target.value = d;
    saveData();
    updateRibbonLabels();
  });

  dropdown.querySelectorAll('[data-notif]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const turningOn = btn.dataset.notif === 'on';
      if (turningOn) {
        const perm = await requestNotificationPermission();
        if (perm === 'denied') {
          showToast('Notifications blocked — allow in browser site settings');
          return;
        }
      }
      state.data.settings.notifications = turningOn;
      saveData();
      dropdown.querySelectorAll('[data-notif]').forEach(b => b.classList.toggle('active', b === btn));
    });
  });

  dropdown.querySelector('[data-gdrive-action]')?.addEventListener('click', e => {
    const action = e.currentTarget.dataset.gdriveAction;
    closeSettingsDropdown();
    if (action === 'signin') signIn().catch(err => showToast('Sign-in failed: ' + err.message));
    else signOut();
  });

  dropdown.querySelectorAll('[data-gdrive]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.data.settings.gdrive.enabled = btn.dataset.gdrive === 'on';
      saveData();
      dropdown.querySelectorAll('[data-gdrive]').forEach(b => b.classList.toggle('active', b === btn));
    });
  });

  dropdown.querySelectorAll('[data-gcal-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.gcalAction;
      if (action === 'signout') {
        closeSettingsDropdown();
        signOut();
        state.data.settings.googleAuth.connectedEmail = '';
        state.data.settings.googleCalendars = [];
        state.data.settings.chronicleCalendarId = null;
        state.data.readOnlyEvents = {};
        saveData();
        renderWeekGrid();
      } else if (action === 'sync') {
        closeSettingsDropdown();
        _runFullSync();
      }
    });
  });

  // Populate calendar list if signed in
  if (gdriveState.token) {
    const listEl = dropdown.querySelector('#gcalCalendarList');
    if (listEl) {
      listEl.innerHTML = '<div class="settings-row" style="opacity:0.5;font-size:12px">Loading calendars…</div>';
      fetchCalendarList().then(cals => {
        if (!_settingsDropdown) return; // closed before fetch returned
        _renderGCalCalendarList(listEl, cals);
      });
    }
  }

  dropdown.querySelectorAll('[data-holidays]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.data.settings.holidays.enabled = btn.dataset.holidays === 'on';
      saveData();
      dropdown.querySelectorAll('[data-holidays]').forEach(b => b.classList.toggle('active', b === btn));
      renderWeekGrid();
    });
  });

  dropdown.querySelectorAll('[data-action]').forEach(row => {
    row.addEventListener('click', () => {
      const action = row.dataset.action;
      closeSettingsDropdown();
      handleSettingsAction(action);
    });
  });

  dropdown.querySelectorAll('[data-toggle]').forEach(header => {
    header.addEventListener('click', () => {
      document.getElementById(header.dataset.toggle)?.classList.toggle('open');
    });
  });

  requestAnimationFrame(() => dropdown.classList.add('open'));
}

function handleSettingsAction(action) {
  switch (action) {
    case 'export':           exportJSON();         break;
    case 'exportIcal':       exportIcal();         break;
    case 'manageHolidays':   openHolidaysModal();  break;
    case 'openThemeEditor':  openThemeEditorUI();  break;

    case 'import': {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = '.json'; input.style.display = 'none';
      document.body.appendChild(input);
      input.click();
      input.addEventListener('change', () => {
        const file = input.files[0];
        if (!file) { input.remove(); return; }
        const reader = new FileReader();
        reader.onload = ev => {
          try {
            const imported = JSON.parse(ev.target.result);
            // Structural validation
            if (!imported || typeof imported !== 'object') throw new Error('not an object');
            if (!imported.days || typeof imported.days !== 'object' || Array.isArray(imported.days)) throw new Error('missing days');
            if (!imported.settings || typeof imported.settings !== 'object') throw new Error('missing settings');
            if (!Array.isArray(imported.series ?? [])) throw new Error('series must be array');
            // Validate day keys are YYYY-MM-DD and events are arrays
            for (const [k, v] of Object.entries(imported.days)) {
              if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) throw new Error(`invalid day key: ${k}`);
              if (!v || typeof v !== 'object') throw new Error(`invalid day entry: ${k}`);
              if (v.events !== undefined && !Array.isArray(v.events)) throw new Error(`events not array: ${k}`);
              // Sanitize diary HTML to strip XSS
              if (typeof v.diary === 'string') v.diary = sanitizeDiaryHTML(v.diary);
            }
            const replace = confirm('Replace all existing data? Press Cancel to merge instead.');
            if (replace) {
              state.data = { ...state.data, ...imported, settings: { ...state.data.settings, ...imported.settings } };
            } else {
              Object.assign(state.data.days, imported.days);
              if (Array.isArray(imported.series)) {
                const existingIds = new Set((state.data.series || []).map(s => s.id));
                imported.series.filter(s => s.id && !existingIds.has(s.id)).forEach(s => state.data.series.push(s));
              }
            }
            saveData(); renderWeekGrid();
            showToast(STRINGS.importDone);
          } catch (err) { showToast(STRINGS.invalidImport); }
          input.remove();
        };
        reader.readAsText(file);
      });
      break;
    }

    case 'clearall':
      if (confirm(STRINGS.confirmClearAll)) {
        state.data.days   = {};
        state.data.series = [];
        saveData(); renderWeekGrid();
        showToast('All data cleared');
      }
      break;

    case 'about': showToast(STRINGS.aboutText); break;
    case 'undo':  handleUndo(); break;
    case 'redo':  handleRedo(); break;
  }
}

function openHolidaysModal() {
  const thisYear = new Date().getFullYear();
  const holidays = getAllHolidays(thisYear, thisYear + 2);
  const hidden   = state.data.settings.holidays.hidden;
  const enabled  = state.data.settings.holidays.enabled;

  history.pushState({ chronicle: 'modal', modal: 'holidays' }, '');

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.addEventListener('click', () => history.back());

  const sheet = document.createElement('div');
  sheet.className = 'bottom-sheet';

  const byYear = {};
  holidays.forEach(h => {
    const y = h.dateKey.slice(0, 4);
    (byYear[y] = byYear[y] || []).push(h);
  });

  const listHTML = Object.entries(byYear).map(([year, list]) => `
    <div class="holidays-year-header">${year}</div>
    ${list.map(h => {
      const isHidden = hidden.includes(h.dateKey);
      const d = new Date(h.dateKey + 'T00:00:00');
      const fmt = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
      return `<div class="holiday-row">
        <div class="holiday-row-info">
          <div class="holiday-row-name">${esc(h.name)}</div>
          <div class="holiday-row-date">${esc(fmt)}</div>
        </div>
        <button class="holiday-row-btn ${isHidden ? 'is-hidden' : ''}"
                data-hkey="${esc(h.dateKey)}">${isHidden ? 'Hidden' : 'Shown'}</button>
      </div>`;
    }).join('')}
  `).join('');

  sheet.innerHTML = `
    <div class="sheet-handle"></div>
    <div class="sheet-header">
      <button class="sheet-cancel" id="holidaysClose">Close</button>
      <span class="sheet-title">UK Bank Holidays</span>
      <span></span>
    </div>
    <div class="holidays-toggle-row">
      <span class="holidays-toggle-label">Show on calendar</span>
      <div class="toggle-pill">
        <div class="toggle-pill-btn ${enabled  ? 'active' : ''}" data-hol-global="on">On</div>
        <div class="toggle-pill-btn ${!enabled ? 'active' : ''}" data-hol-global="off">Off</div>
      </div>
    </div>
    <div class="sheet-body" style="padding:0">
      ${listHTML}
    </div>
  `;

  document.body.appendChild(backdrop);
  document.body.appendChild(sheet);

  requestAnimationFrame(() => sheet.classList.add('open'));

  const close = () => history.back();
  sheet.querySelector('#holidaysClose').addEventListener('click', close);

  sheet.querySelectorAll('[data-hol-global]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.data.settings.holidays.enabled = btn.dataset.holGlobal === 'on';
      saveData();
      sheet.querySelectorAll('[data-hol-global]').forEach(b => b.classList.toggle('active', b === btn));
      renderWeekGrid();
    });
  });

  sheet.querySelectorAll('[data-hkey]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.hkey;
      const idx = state.data.settings.holidays.hidden.indexOf(key);
      if (idx === -1) {
        state.data.settings.holidays.hidden.push(key);
        btn.textContent = 'Hidden';
        btn.classList.add('is-hidden');
      } else {
        state.data.settings.holidays.hidden.splice(idx, 1);
        btn.textContent = 'Shown';
        btn.classList.remove('is-hidden');
      }
      saveData();
      renderWeekGrid();
    });
  });

  const onPop = () => {
    sheet.classList.remove('open');
    setTimeout(() => { sheet.remove(); backdrop.remove(); }, 300);
    window.removeEventListener('popstate', onPop);
  };
  window.addEventListener('popstate', onPop);
}

function exportJSON() {
  const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `chronicle-export-${formatDate(new Date())}.json`;
  a.click(); URL.revokeObjectURL(url);
  showToast(STRINGS.exportDone);
}

function exportIcal() {
  const ics  = buildICS(state.data);
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `chronicle-${formatDate(new Date())}.ics`;
  a.click(); URL.revokeObjectURL(url);
  showToast(STRINGS.exportICalDone);
}

function openThemeEditorUI() {
  // Work on a live settings reference — themeEditor mutates it for live preview.
  // On save it calls onSave; on cancel the editor reverts via its own snapshot.
  openThemeEditor(state.data.settings, () => {
    applyUITheme(state.data.settings);
    injectEventThemeCSS(state.data.settings);
    saveData();
    renderWeekGrid();
  });
}

function closeSettingsDropdown() {
  if (_settingsDropdown) {
    _settingsDropdown.classList.remove('open');
    const el = _settingsDropdown;
    _settingsDropdown = null;
    setTimeout(() => el.remove(), 180);
  }
  _settingsBackdrop?.remove();
  _settingsBackdrop = null;
}

// ── Agenda panel ───────────────────────────────────────────────────────────

let _agendaFilter   = 'all';
let _agendaBackdrop = null;

function openAgendaPanel() {
  const panel = document.getElementById('agendaPanel');
  if (!panel) return;
  history.pushState({ chronicle: 'modal', modal: 'agenda' }, '');

  _agendaBackdrop = document.createElement('div');
  _agendaBackdrop.className = 'modal-backdrop';
  _agendaBackdrop.style.pointerEvents = 'none';
  setTimeout(() => { _agendaBackdrop.style.pointerEvents = ''; }, 350);
  _agendaBackdrop.addEventListener('click', () => history.back());
  document.body.insertBefore(_agendaBackdrop, panel);

  renderAgendaList(_agendaFilter);
  panel.classList.add('open');
}

function closeAgendaPanel() {
  document.getElementById('agendaPanel')?.classList.remove('open');
  _agendaBackdrop?.remove();
  _agendaBackdrop = null;
}

function renderAgendaList(filter) {
  _agendaFilter = filter;

  document.querySelectorAll('#agendaFilterBar .filter-pill').forEach(pill => {
    pill.classList.toggle('active', pill.dataset.filter === filter);
  });

  const list = document.getElementById('agendaList');
  if (!list) return;

  // Non-recurring events: every date stored in data.days
  const dateSet = new Set(Object.keys(state.data.days));

  // Recurring series: scan a window around today using the user's chosen range
  if (state.data.series.length > 0) {
    const beforeDays = state.data.settings.agendaBeforeDays ?? 14;
    const aheadDays  = state.data.settings.agendaAheadDays  ?? 60;
    const now = new Date(state.today);
    const winStart = new Date(now); winStart.setDate(winStart.getDate() - beforeDays);
    const winEnd   = new Date(now); winEnd.setDate(winEnd.getDate() + aheadDays);
    let d = new Date(winStart);
    while (d <= winEnd) {
      dateSet.add(formatDate(d));
      d.setDate(d.getDate() + 1);
    }
  }

  const items = [];
  Array.from(dateSet).sort().forEach(dateKey => {
    getEventsForDate(state.data, dateKey).forEach(evt => {
      if (filter === 'all' || evt.type === filter) items.push({ dateKey, evt });
    });
  });

  if (items.length === 0) {
    const label = filter === 'all' ? 'events or todos' : filter + 's';
    list.innerHTML = `<div class="agenda-empty">
      <div class="agenda-empty__icon">📅</div>
      <div class="agenda-empty__title">Nothing here yet</div>
      <div class="agenda-empty__sub">Add ${label} from the calendar to see them here.</div>
    </div>`;
    return;
  }

  const typeIcon = { event: 'icon-calendar', todo: 'icon-check' };

  list.innerHTML = items.map(({ dateKey, evt }) => {
    const date     = parseDate(dateKey);
    const dateStr  = date.toLocaleDateString('default', { weekday: 'short', day: 'numeric', month: 'short' });
    const doneClass = evt.done ? 'agenda-item__title--done' : '';
    const agendaTheme = evt.theme ? ` agenda-item--theme-${evt.theme}` : '';
    const icon     = typeIcon[evt.type] ?? 'icon-calendar';
    const bellIcon = evt.reminderMinutes != null
      ? `<span class="agenda-item__bell" aria-label="Reminder set">🔔</span>` : '';
    const todoBtn  = evt.type === 'todo'
      ? `<button class="agenda-todo-check ${evt.done ? 'checked' : ''}"
                 data-todo-toggle="${esc(evt.id)}"
                 aria-label="${evt.done ? 'Mark incomplete' : 'Mark complete'}">${evt.done ? '✓' : ''}</button>`
      : '';
    return `
      <div class="agenda-item${agendaTheme}" data-date="${esc(dateKey)}" data-id="${esc(evt.id)}">
        <div class="agenda-item__icon agenda-item__icon--${esc(evt.type)}">
          <svg class="icon"><use href="assets/icons.svg#${icon}"/></svg>
        </div>
        <div class="agenda-item__body">
          <div class="agenda-item__title ${doneClass}">${evt.title}</div>
          <div class="agenda-item__date">${esc(dateStr)}${evt.time ? ' · ' + esc(evt.time) : ''}${evt.isOccurrence ? ' <span class="item-repeat">↻</span>' : ''}${bellIcon}</div>
        </div>
        ${todoBtn}
        <svg class="icon agenda-item__chevron"><use href="assets/icons.svg#icon-chevron-right"/></svg>
      </div>`;
  }).join('');

  list.querySelectorAll('[data-todo-toggle]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const dateKey = btn.closest('.agenda-item').dataset.date;
      pushUndo(JSON.parse(JSON.stringify(state.data)));
      toggleTodo(state.data, dateKey, btn.dataset.todoToggle);
      saveData();
      refreshVisibleWeekCards();
      renderAgendaList(_agendaFilter);
    });
  });

  list.querySelectorAll('.agenda-item').forEach(item => {
    item.addEventListener('click', () => {
      const dateKey = item.dataset.date;
      history.back();
      setTimeout(() => {
        goToWeek(parseDate(dateKey));
        openExpandedDay(dateKey);
      }, 320);
    });
  });
}

// ── Date picker ────────────────────────────────────────────────────────────

let _datepickerOverlay = null;
let _dpState = null;

function openDatePicker() {
  if (_datepickerOverlay) { closeDatePicker(); return; }
  history.pushState({ chronicle: 'modal', modal: 'datepicker' }, '');

  _dpState = { year: state.today.getFullYear(), month: state.today.getMonth() };

  const overlay = document.createElement('div');
  overlay.className = 'datepicker-overlay';
  overlay.addEventListener('click', e => { if (e.target === overlay) history.back(); });

  const modal = document.createElement('div');
  modal.className = 'datepicker-modal';
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  _datepickerOverlay = overlay;

  renderDatePickerModal(modal);
  requestAnimationFrame(() => modal.classList.add('open'));
}

function renderDatePickerModal(modal) {
  const { year, month } = _dpState;
  const ws          = state.data.settings.weekStart;
  const daysInMonth = getDaysInMonth(year, month);
  const monthLabel  = new Date(year, month, 1).toLocaleString('default', { month: 'long' });
  const todayKey    = formatDate(state.today);

  const dayNames = ws === 'mon'
    ? ['Mo','Tu','We','Th','Fr','Sa','Su']
    : ['Su','Mo','Tu','We','Th','Fr','Sa'];

  let firstDow = getFirstDayOfMonth(year, month);
  if (ws === 'mon') firstDow = firstDow === 0 ? 6 : firstDow - 1;

  let grid = dayNames.map(d => `<div class="datepicker-dow">${d}</div>`).join('');
  for (let i = 0; i < firstDow; i++) grid += `<div class="datepicker-day datepicker-day--empty"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const key     = `${year}-${String(month + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isToday = key === todayKey ? 'today' : '';
    grid += `<div class="datepicker-day ${isToday}" data-date="${key}">${d}</div>`;
  }

  modal.innerHTML = `
    <div class="datepicker-header">
      <button class="datepicker-nav" id="dpPrev" aria-label="Previous month">
        <svg class="icon"><use href="assets/icons.svg#icon-chevron-left"/></svg>
      </button>
      <div class="datepicker-month-label">${esc(monthLabel)} ${year}</div>
      <button class="datepicker-nav" id="dpNext" aria-label="Next month">
        <svg class="icon"><use href="assets/icons.svg#icon-chevron-right"/></svg>
      </button>
    </div>
    <div class="datepicker-grid">${grid}</div>
    <div class="datepicker-footer">
      <button class="datepicker-today-btn" id="dpToday">Today</button>
    </div>
  `;

  modal.querySelector('#dpPrev').addEventListener('click', () => {
    _dpState.month--;
    if (_dpState.month < 0) { _dpState.month = 11; _dpState.year--; }
    renderDatePickerModal(modal);
  });
  modal.querySelector('#dpNext').addEventListener('click', () => {
    _dpState.month++;
    if (_dpState.month > 11) { _dpState.month = 0; _dpState.year++; }
    renderDatePickerModal(modal);
  });
  modal.querySelector('#dpToday').addEventListener('click', () => { goToToday(); history.back(); });
  modal.querySelectorAll('.datepicker-day[data-date]').forEach(cell => {
    cell.addEventListener('click', () => { goToWeek(parseDate(cell.dataset.date)); history.back(); });
  });
}

function closeDatePicker() {
  if (!_datepickerOverlay) return;
  _datepickerOverlay.querySelector('.datepicker-modal')?.classList.remove('open');
  const el = _datepickerOverlay;
  _datepickerOverlay = null;
  setTimeout(() => el.remove(), 180);
}

// ── Search overlay (stub) ──────────────────────────────────────────────────

let _searchSheet    = null;
let _searchBackdrop = null;

function openSearch() {
  closeSearch();
  history.pushState({ chronicle: 'modal', modal: 'search' }, '');

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.style.pointerEvents = 'none';
  setTimeout(() => { backdrop.style.pointerEvents = ''; }, 350);
  backdrop.addEventListener('click', () => history.back());

  const sheet = document.createElement('div');
  sheet.className = 'bottom-sheet';
  sheet.innerHTML = `
    <div class="sheet-handle"></div>
    <div class="sheet-header">
      <button class="sheet-cancel" id="searchClose">${STRINGS.cancel}</button>
      <span class="sheet-title">${STRINGS.search}</span>
      <span></span>
    </div>

<div class="sheet-body search-body">
  <div class="search-input-row">
    <input class="field-input" type="search" inputmode="text"
           placeholder="${STRINGS.searchPlaceholder}"
           id="searchInput" autocomplete="off">
  </div>

  <div class="search-results-wrapper">
    <div id="searchResults" class="search-results"></div>
    <div id="searchEmpty" class="search-empty hidden">${STRINGS.searchEmpty}</div>
  </div>
</div>
  `;

  sheet.querySelector('#searchClose').addEventListener('click', () => history.back());

  document.body.appendChild(backdrop);
  document.body.appendChild(sheet);
  _searchBackdrop = backdrop;
  _searchSheet    = sheet;

  requestAnimationFrame(() => sheet.classList.add('open'));

  const inputEl   = sheet.querySelector('#searchInput');
  const resultsEl = sheet.querySelector('#searchResults');
  const emptyEl   = sheet.querySelector('#searchEmpty');

  let timer = null;

  inputEl.addEventListener('input', () => {
    clearTimeout(timer);
    const q = inputEl.value.trim();
    if (!q) {
      resultsEl.innerHTML = '';
      emptyEl.classList.add('hidden');
      return;
    }
    timer = setTimeout(() => runSearch(q, resultsEl, emptyEl), 300);
  });

  setTimeout(() => inputEl.focus(), 350);

// Keyboard-aware adjustment for Android
const vv = window.visualViewport;
if (vv) {
  const adjustForKeyboard = () => {
    const keyboardHeight = window.innerHeight - vv.height - vv.offsetTop;
    sheet.style.bottom = keyboardHeight > 0 ? `${keyboardHeight}px` : '0';
  };

  vv.addEventListener('resize', adjustForKeyboard);
  vv.addEventListener('scroll', adjustForKeyboard); // important on Android
  adjustForKeyboard();

  sheet._cleanupVV = () => {
    vv.removeEventListener('resize', adjustForKeyboard);
    vv.removeEventListener('scroll', adjustForKeyboard);
  };
}

}



function runSearch(query, resultsEl, emptyEl) {
  const results = searchAll(query);

  if (results.length === 0) {
    resultsEl.innerHTML = '';
    emptyEl.classList.remove('hidden');
    return;
  }

  emptyEl.classList.add('hidden');
  resultsEl.innerHTML = renderSearchResultsGrouped(results);

  // ANDROID KEYBOARD BUG FIX — FORCE REPAINT
  resultsEl.style.display = 'none';
  void resultsEl.offsetHeight;
  resultsEl.style.display = '';

}

function searchAll(query) {
  const q = query.toLowerCase();
  const out = [];

  for (const dateKey in state.data.days) {
    const day = state.data.days[dateKey];
    if (!day) continue;

    // Diary
    if (day.diary) {
      const plain = stripHTML(day.diary).toLowerCase();
      const idx = plain.indexOf(q);
      if (idx !== -1) {
        out.push({
          dateKey,
          type: 'diary',
          snippet: makeSnippet(stripHTML(day.diary), q),
          eventId: null
        });
      }
    }

    // Events / todos / reminders
    if (day.events) {
      for (const ev of day.events) {
        const titleText = stripHTML(ev.title);
        const hay = (titleText + ' ' + (ev.notes || '')).toLowerCase();
        if (hay.includes(q)) {
          out.push({
            dateKey,
            type: ev.type, // event | todo
            snippet: makeSnippet(titleText + ' ' + (ev.notes || ''), q),
            eventId: ev.id
          });
        }
      }
    }
  }

  // Sort by date ascending
  out.sort((a, b) => a.dateKey.localeCompare(b.dateKey));

  return out;
}

function stripHTML(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent || '';
}

function sanitizeDiaryHTML(html) {
  html = html.replace(
  /<font\s+color=["']?([^"'>\s]+)["']?[^>]*>(.*?)<\/font>/gi,
  '<span style="color:$1">$2</span>'
);
  if (!html || typeof html !== 'string') return '';
  const ALLOWED_TAGS = new Set(['B','STRONG','I','EM','U','S','STRIKE','BR','P','DIV',
    'SPAN','A','H1','H2','H3','UL','OL','LI','MARK']);
  const ALLOWED_ATTRS = { A: ['href','target'], SPAN: ['style'], 'default': [] };
  const SAFE_STYLE_PROPS = new Set(['color','background-color','font-size','font-weight',
    'font-style','text-decoration']);

  function clean(node) {
    for (let i = node.childNodes.length - 1; i >= 0; i--) {
      const child = node.childNodes[i];
      if (child.nodeType === Node.TEXT_NODE) continue;
      if (child.nodeType !== Node.ELEMENT_NODE) { child.remove(); continue; }
      const tag = child.tagName;
      if (!ALLOWED_TAGS.has(tag)) {
        while (child.firstChild) node.insertBefore(child.firstChild, child);
        child.remove();
        continue;
      }
      const allowed = ALLOWED_ATTRS[tag] || ALLOWED_ATTRS['default'];
      Array.from(child.attributes).forEach(attr => {
        if (!allowed.includes(attr.name)) { child.removeAttribute(attr.name); return; }
        if (attr.name === 'href') {
          const v = attr.value.trim().toLowerCase();
          if (!v.startsWith('http://') && !v.startsWith('https://') && !v.startsWith('mailto:')) {
            child.removeAttribute('href');
          }
        }
        if (attr.name === 'style') {
          const cleaned = attr.value.split(';').filter(decl => {
            const prop = decl.split(':')[0]?.trim().toLowerCase();
            return prop && SAFE_STYLE_PROPS.has(prop);
          }).join(';');
          cleaned ? child.setAttribute('style', cleaned) : child.removeAttribute('style');
        }
      });
      if (tag === 'A') child.setAttribute('target', '_blank');
      clean(child);
    }
  }

  const container = document.createElement('div');
  container.innerHTML = html;
  clean(container);
  return container.innerHTML;
}

function makeSnippet(text, qLower) {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(qLower);
  if (idx === -1) return esc(text);

  const start = Math.max(0, idx - 30);
  const end   = Math.min(text.length, idx + qLower.length + 30);
  const raw   = text.slice(start, end);

  const escRaw = esc(raw);
  const re = new RegExp(`(${qLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig');

  return escRaw.replace(re, '<mark>$1</mark>');
}

function renderSearchResultsGrouped(results) {
  let html = '';
  let currentDate = null;

  for (const r of results) {
    if (r.dateKey !== currentDate) {
      currentDate = r.dateKey;
      html += `
        <div class="search-date-header">
          ${formatSearchDate(currentDate)}
        </div>
      `;
    }

    html += `
      <div class="search-result-item"
           data-date="${r.dateKey}"
           data-eventid="${r.eventId || ''}">
        <div class="search-result-title">${formatType(r.type)}</div>
        <div class="search-result-snippet">${r.snippet}</div>
      </div>
    `;
  }

  // Attach click handlers after insertion
  requestAnimationFrame(() => {
    document.querySelectorAll('.search-result-item').forEach(el => {
      el.addEventListener('click', () => {
        const dateKey = el.dataset.date;
        navigateToSearchResult(dateKey);
      });
    });
  });

  return html;
}

function formatSearchDate(dateKey) {
  const d = parseDate(dateKey);
  return d.toLocaleDateString('default', {
    weekday: 'short',
    day: 'numeric',
    month: 'short'
  });
}

function formatType(t) {
  switch (t) {
    case 'event':    return 'Event';
    case 'todo':     return 'Todo';
    case 'diary':    return 'Diary';
    default:         return t;
  }
}

function navigateToSearchResult(dateKey) {
  // Close search modal first
  history.back();

  // Wait for sheet to close animation
  setTimeout(() => {
    const date = parseDate(dateKey);
    state.currentWeekStart = getWeekStart(date, state.data.settings.weekStart);

    renderWeekGrid();
    openExpandedDay(dateKey);
  }, 350);
}


function closeSearch() {
  if (_searchSheet) {
    if (typeof _searchSheet._cleanupVV === 'function') {
      _searchSheet._cleanupVV();
    }

    _searchSheet.classList.remove('open');
    const el = _searchSheet;
    _searchSheet = null;
    setTimeout(() => el.remove(), 320);
  }
  _searchBackdrop?.remove();
  _searchBackdrop = null;
}


// ── Undo / redo ────────────────────────────────────────────────────────────

function handleUndo() {
  const prev = undo(state.data);
  if (prev) { state.data = prev; saveData(); renderWeekGrid(); showToast(STRINGS.undone); }
  else       { showToast(STRINGS.noUndo); }
}

function handleRedo() {
  const next = redo(state.data);
  if (next) { state.data = next; saveData(); renderWeekGrid(); showToast(STRINGS.redone); }
}

// ── Midnight refresh ───────────────────────────────────────────────────────

function scheduleNextDayRefresh() {
  const now      = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
  setTimeout(() => {
    state.today = new Date(); state.today.setHours(0, 0, 0, 0);
    renderWeekGrid();
    scheduleReminders(state.data);
    scheduleNextDayRefresh();
  }, tomorrow - now);
}

// ── Bootstrap ──────────────────────────────────────────────────────────────

async function init() {
  history.replaceState({ chronicle: 'main' }, '');
  state.data  = await loadData();
  state.today = new Date(); state.today.setHours(0, 0, 0, 0);
  state.currentWeekStart = getWeekStart(state.today, state.data.settings.weekStart);

  applyUITheme(state.data.settings);
  injectEventThemeCSS(state.data.settings);
  applyDiaryFontSize(state.data.settings.diaryFontSize);
  scheduleReminders(state.data);
  initFormatToolbar(); // global format toolbar singleton (Fix 4)

  registerDirtyCallback(dirty => {
    const badge = document.getElementById('syncBadge');
    if (badge) badge.hidden = !dirty;
  });

  registerStatusCallback((status, info) => {
    if (status === 'needs_client_id') {
      openSettingsDropdown();
      showToast('Paste your Google Client ID in Settings → Sync');
    } else if (status === 'pending_sync') {
      syncNow(state.data, _applyRemoteData, _openConflict, showToast).catch(console.warn);
    } else if (status === 'synced') {
      state.data.settings.gdrive.lastSync = new Date().toISOString();
      _saveToIDB(state.data).catch(console.warn);
    } else if (status === 'signed') {
      // Token refreshed — trigger full GCal sync if we have a token now
      _runFullSync();
    }
  });

  registerToastCallback(showToast);

  document.getElementById('conflictKeepDrive').addEventListener('click', async () => {
    document.getElementById('conflictModal').classList.remove('open');
    await _conflictCallbacks?.keepDrive();
    _conflictCallbacks = null;
  });
  document.getElementById('conflictKeepLocal').addEventListener('click', async () => {
    document.getElementById('conflictModal').classList.remove('open');
    await _conflictCallbacks?.keepLocal();
    _conflictCallbacks = null;
  });

  initGoogleAuth(state.data.settings.googleAuth.clientId);

  const tokenRestored = await restoreToken();
  if (tokenRestored) {
    _runFullSync();
  }

  renderWeekGrid();

  // Redraw multi-day bars when grid resizes (orientation change, window resize)
  new ResizeObserver(() => requestAnimationFrame(renderMultidayBars))
    .observe(document.getElementById('weekGrid'));

  // ── Ribbon buttons ──
  document.getElementById('btnToday').addEventListener('click', goToToday);
  document.getElementById('btnJumpDate').addEventListener('click', openDatePicker);
  document.getElementById('btnSearch').addEventListener('click', openSearch);
  document.getElementById('btnAgenda').addEventListener('click', openAgendaPanel);
  document.getElementById('btnSync').addEventListener('click', () => {
    if (gdriveState.token) {
      _runFullSync();
      // Also sync diary notes to Drive — GCal sync only covers events
      syncNow(state.data, _applyRemoteData, _openConflict, showToast).catch(console.warn);
    } else {
      signIn().catch(console.warn);
    }
  });
  document.getElementById('btnAdd').addEventListener('click', () => {
    openAddEventModal(_lastFocusedDate ?? formatDate(state.today));
  });
  document.getElementById('btnSettings').addEventListener('click', openSettingsDropdown);

  // Sync when coming back online
  window.addEventListener('online', () => { resetGCalThrottle(); _runFullSync(); });

  // ── Edge nav arrows (Left/Right = week, Up/Down = first of month) ──
  document.getElementById('navPrevWeek').addEventListener('click', prevMonthFirst);
  document.getElementById('navNextWeek').addEventListener('click', nextMonthFirst);
  document.getElementById('navPrevMonth').addEventListener('click', prevWeek);
  document.getElementById('navNextMonth').addEventListener('click', nextWeek);

  // ── Agenda panel controls ──
  document.getElementById('btnAgendaClose').addEventListener('click', () => history.back());
  document.querySelectorAll('#agendaFilterBar .filter-pill').forEach(pill => {
    pill.addEventListener('click', () => renderAgendaList(pill.dataset.filter));
  });

  // ── Swipe + long-press on week grid ──
  const weekContainer = document.getElementById('weekContainer');
  const weekGrid      = document.getElementById('weekGrid');
  const gridWithSides = weekGrid.parentElement;
  // Create the swipe hint overlay (one element reused for all gestures)
  _swipeHintEl = document.createElement('div');
  _swipeHintEl.className = 'swipe-hint';
  document.body.appendChild(_swipeHintEl);

  _navDimEl = document.createElement('div');
  _navDimEl.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;z-index:2;pointer-events:none';
  document.body.appendChild(_navDimEl);

  // ── Swipe zone glow handlers ──────────────────────────────────
  const navTopEl   = document.getElementById('navPrevWeek');
  const navBotEl   = document.getElementById('navNextWeek');
  const navLeftEl  = document.getElementById('navPrevMonth');
  const navRightEl = document.getElementById('navNextMonth');

  // Horizontal strip glow: fire on any touch (strip is only used for h-swipe or click)
  [navTopEl, navBotEl].forEach(el => {
    el.addEventListener('touchstart', () => el.classList.add('swipe-zone-active'),    { passive: true });
    el.addEventListener('touchend',   () => el.classList.remove('swipe-zone-active'), { passive: true });
    el.addEventListener('touchcancel',() => el.classList.remove('swipe-zone-active'), { passive: true });
  });

  let _prevWeekGhost = null, _nextWeekGhost = null;
  let _prevMonthGhost = null, _nextMonthGhost = null;

  function _buildWeekGhost(direction) {
    const weekStart = navigateWeek(state.currentWeekStart, direction);
    const days      = getDaysOfWeek(weekStart);
    const ws        = state.data.settings.weekStart;
    const rect      = gridWithSides.getBoundingClientRect();

    const wrapper = document.createElement('div');
    wrapper.style.cssText = [
      'position:fixed',
      `top:${rect.top}px`,
      `left:${rect.left + direction * rect.width}px`,
      `width:${rect.width}px`,
      `height:${rect.height}px`,
      'background:var(--bg-primary)',
      'z-index:1',
      'display:flex',
      'align-items:stretch',
      'overflow:hidden',
      'pointer-events:none',
    ].join(';');

    const grid = document.createElement('div');
    grid.className = 'week-grid';
    grid.dataset.weekStart = ws;

    days.forEach(date => {
      const dow  = date.getDay();
      const card = document.createElement('div');
      card.className = 'day-card';
      if (isSameDay(date, state.today))    card.classList.add('today');
      if (dow === 0 || dow === 6)           card.classList.add('day-card--weekend');
      card.dataset.day = getDayAreaName(date);
      card.innerHTML = `<div class="day-header">
        <span class="day-name">${getDayName(date)}</span>
        <span class="day-number">${date.getDate()}<span class="day-month-abbr"> ${date.toLocaleString('default',{month:'short'})}</span></span>
      </div>`;
      grid.appendChild(card);
    });

    if (ws === 'mon') {
      const sat = grid.querySelector('.day-card[data-day="sat"]');
      const sun = grid.querySelector('.day-card[data-day="sun"]');
      if (sat && sun) {
        const col = document.createElement('div');
        col.className = 'weekend-col';
        grid.insertBefore(col, sat);
        col.appendChild(sat);
        col.appendChild(sun);
      }
    }

    wrapper.appendChild(grid);
    document.body.appendChild(wrapper);
    return wrapper;
  }

  function _buildMonthGhost(direction) {
    const ws  = state.data.settings.weekStart;
    const mid = getDaysOfWeek(state.currentWeekStart)[3];
    let weekStart = getWeekStart(new Date(mid.getFullYear(), mid.getMonth() + direction, 1), ws);
    if (weekStart.getTime() === state.currentWeekStart.getTime())
      weekStart = getWeekStart(new Date(mid.getFullYear(), mid.getMonth() + direction * 2, 1), ws);
    const days = getDaysOfWeek(weekStart);
    const rect = gridWithSides.getBoundingClientRect();

    const wrapper = document.createElement('div');
    wrapper.style.cssText = [
      'position:fixed',
      `top:${rect.top + direction * rect.height}px`,
      `left:${rect.left}px`,
      `width:${rect.width}px`,
      `height:${rect.height}px`,
      'background:var(--bg-primary)',
      'z-index:1',
      'display:flex',
      'align-items:stretch',
      'overflow:hidden',
      'pointer-events:none',
    ].join(';');

    const grid = document.createElement('div');
    grid.className = 'week-grid';
    grid.dataset.weekStart = ws;

    days.forEach(date => {
      const dow  = date.getDay();
      const card = document.createElement('div');
      card.className = 'day-card';
      if (isSameDay(date, state.today))    card.classList.add('today');
      if (dow === 0 || dow === 6)           card.classList.add('day-card--weekend');
      card.dataset.day = getDayAreaName(date);
      card.innerHTML = `<div class="day-header">
        <span class="day-name">${getDayName(date)}</span>
        <span class="day-number">${date.getDate()}<span class="day-month-abbr"> ${date.toLocaleString('default',{month:'short'})}</span></span>
      </div>`;
      grid.appendChild(card);
    });

    if (ws === 'mon') {
      const sat = grid.querySelector('.day-card[data-day="sat"]');
      const sun = grid.querySelector('.day-card[data-day="sun"]');
      if (sat && sun) {
        const col = document.createElement('div');
        col.className = 'weekend-col';
        grid.insertBefore(col, sat);
        col.appendChild(sat);
        col.appendChild(sun);
      }
    }

    wrapper.appendChild(grid);
    document.body.appendChild(wrapper);
    return wrapper;
  }

  initGestures(weekContainer, {
    onLongPress:  dateKey => { _suppressNextCardClick = true; openQuickActions(dateKey); },
    onSwipeLeft:  () => nextWeek(),
    onSwipeRight: () => prevWeek(),
    onSwipeUp:    () => nextMonthFirst(),
    onSwipeDown:  () => prevMonthFirst(),
    onHint:       dir => _showSwipeHint(dir, 'week'),
    onDragStart:  () => {
      _prevWeekGhost = _buildWeekGhost(-1);
      _nextWeekGhost = _buildWeekGhost(+1);
    },
    onDragTranslate: dx => {
      if (_prevWeekGhost) _prevWeekGhost.style.transform = `translateX(${dx}px)`;
      if (_nextWeekGhost) _nextWeekGhost.style.transform = `translateX(${dx}px)`;
    },
    onDragSnapBack: dur => {
      [_prevWeekGhost, _nextWeekGhost].forEach(g => {
        if (!g) return;
        g.style.transition = `transform ${dur}ms ${SPRING_EASE}`;
        g.style.transform  = '';
      });
    },
    onDragEnd: () => {
      _prevWeekGhost?.remove(); _prevWeekGhost = null;
      _nextWeekGhost?.remove(); _nextWeekGhost = null;
    },
    onDragCommit: (axis, dir, dur) => {
      const r = gridWithSides.getBoundingClientRect();
      if (axis === 'h') {
        const tx = dir === 'left' ? -r.width : r.width;
        [_prevWeekGhost, _nextWeekGhost].forEach(g => {
          if (!g) return;
          g.style.transition = `transform ${dur}ms ease`;
          g.style.transform  = `translateX(${tx}px)`;
        });
      } else {
        const ty = dir === 'up' ? -r.height : r.height;
        [_prevMonthGhost, _nextMonthGhost].forEach(g => {
          if (!g) return;
          g.style.transition = `transform ${dur}ms ease`;
          g.style.transform  = `translateY(${ty}px)`;
        });
      }
      _navDimEl.style.transition = 'none';
      _navDimEl.style.opacity    = '0.12';
      setTimeout(() => {
        _navDimEl.style.transition = `opacity ${Math.round(dur * 0.6)}ms ease`;
        _navDimEl.style.opacity    = '0';
      }, Math.round(dur * 0.4));
    },
    onDragStartV: () => {
      navLeftEl.classList.add('swipe-zone-active');
      navRightEl.classList.add('swipe-zone-active');
      _prevMonthGhost = _buildMonthGhost(-1);
      _nextMonthGhost = _buildMonthGhost(+1);
    },
    onDragTranslateV: dy => {
      if (_prevMonthGhost) _prevMonthGhost.style.transform = `translateY(${dy}px)`;
      if (_nextMonthGhost) _nextMonthGhost.style.transform = `translateY(${dy}px)`;
    },
    onDragSnapBackV: dur => {
      [_prevMonthGhost, _nextMonthGhost].forEach(g => {
        if (!g) return;
        g.style.transition = `transform ${dur}ms ${SPRING_EASE}`;
        g.style.transform  = '';
      });
    },
    onDragEndV: () => {
      navLeftEl.classList.remove('swipe-zone-active');
      navRightEl.classList.remove('swipe-zone-active');
      _prevMonthGhost?.remove(); _prevMonthGhost = null;
      _nextMonthGhost?.remove(); _nextMonthGhost = null;
    },
  }, {
    translateEl: gridWithSides,
    commitThresholdH: () => window.innerWidth  * 0.5,
    commitThresholdV: () => window.innerHeight * 0.5,
    zoneCheck(axis, sx, sy) {
      const tr = navTopEl.getBoundingClientRect();
      const br = navBotEl.getBoundingClientRect();
      const inTopStrip = sy >= tr.top && sy <= tr.bottom;
      const inBotStrip = sy >= br.top && sy <= br.bottom;
      if (axis === 'h') return inTopStrip || inBotStrip;
      // Vertical axis: only from left or right side nav buttons, never from top/bottom strips
      const lr = navLeftEl.getBoundingClientRect();
      const rr = navRightEl.getBoundingClientRect();
      return ((sx >= lr.left && sx <= lr.right) || (sx >= rr.left && sx <= rr.right))
          && !inTopStrip && !inBotStrip;
    },
  });

  // ── Delegated: todo checkbox toggle ──
  weekGrid.addEventListener('click', e => {
    const checkbox = e.target.closest('.todo-checkbox');
    if (!checkbox) return;
    const item = checkbox.closest('.todo-item[data-todo-id]');
    if (!item) return;
    e.stopPropagation();
    pushUndo(JSON.parse(JSON.stringify(state.data)));
    toggleTodo(state.data, item.dataset.date, item.dataset.todoId);
    saveData();
    refreshCardEvents(item.dataset.date);
  });

  // ── Delegated: todo label → inline detail popup ──
  weekGrid.addEventListener('click', e => {
    const label = e.target.closest('.todo-label');
    if (!label) return;
    const item = label.closest('.todo-item[data-todo-id]');
    if (!item) return;
    e.stopPropagation();

    const dateKey = item.dataset.date;
    const todoId  = item.dataset.todoId;
    const strip   = item.closest('.events-strip');
    if (!strip) return;

    const existing    = strip.querySelector('.event-detail');
    const wasThisItem = existing?.dataset.forId === todoId;
    strip.querySelectorAll('.event-pill--active').forEach(p => p.classList.remove('event-pill--active'));
    existing?.remove();
    if (wasThisItem) return;

    const evt = getEventsForDate(state.data, dateKey).find(ev => ev.id === todoId);
    if (!evt) return;

    const themeClass = evt.theme ? ` event-detail--theme-${evt.theme}` : '';
    const detail = document.createElement('div');
    detail.className = `event-detail${themeClass}`;
    detail.dataset.forId = todoId;
    detail.innerHTML = `
      <div class="event-detail__title">${evt.title}</div>
      ${evt.time  ? `<div class="event-detail__time">${esc(evt.time)}</div>`   : ''}
      ${evt.notes ? `<div class="event-detail__notes">${esc(evt.notes)}</div>` : ''}
      <div class="event-detail__actions">
        <button class="event-detail__btn event-detail__edit">Edit</button>
        <button class="event-detail__btn event-detail__delete">Delete</button>
      </div>
    `;
    item.insertAdjacentElement('afterend', detail);

    detail.querySelector('.event-detail__edit').addEventListener('click', ev => {
      ev.stopPropagation();
      if (evt.isOccurrence && evt.seriesId) {
        openRepeatActionSheet(evt, dateKey, 'edit');
      } else {
        openAddEventModal(dateKey, evt);
      }
    });

    detail.querySelector('.event-detail__delete').addEventListener('click', ev => {
      ev.stopPropagation();
      if (!confirm(`Delete "${evt.title}"?`)) return;
      pushUndo(JSON.parse(JSON.stringify(state.data)));
      if (evt.isOccurrence && evt.seriesId) {
        openRepeatActionSheet(evt, dateKey, 'delete');
      } else {
        _deleteLocalEvent(state.data, dateKey, evt);
        saveData();
        refreshVisibleWeekCards();
      }
    });
  });

  // ── Delegated: event pill inline detail ──
  weekGrid.addEventListener('click', e => {
    const pill = e.target.closest('.event-pill[data-id]');
    if (!pill) return;
    e.stopPropagation();

    const dateKey = pill.dataset.date;
    const eventId = pill.dataset.id;
    const strip   = pill.closest('.events-strip');
    if (!strip) return;

    const existing    = strip.querySelector('.event-detail');
    const wasThisPill = existing?.dataset.forId === eventId;

    strip.querySelectorAll('.event-pill--active').forEach(p => p.classList.remove('event-pill--active'));
    existing?.remove();
    if (wasThisPill) return;

    const evt = getEventsForDate(state.data, dateKey).find(ev => ev.id === eventId);
    if (!evt) return;

    pill.classList.add('event-pill--active');

    const detail = document.createElement('div');
    detail.className = 'event-detail';
    detail.dataset.forId = eventId;
    detail.innerHTML = `
      <div class="event-detail__title">${evt.title}</div>
      ${evt.time  ? `<div class="event-detail__time">${esc(evt.time)}</div>`   : ''}
      ${evt.notes ? `<div class="event-detail__notes">${esc(evt.notes)}</div>` : ''}
      <div class="event-detail__actions">
        <button class="event-detail__btn event-detail__edit">Edit</button>
        <button class="event-detail__btn event-detail__delete">Delete</button>
      </div>
    `;
    pill.insertAdjacentElement('afterend', detail);

    detail.querySelector('.event-detail__edit').addEventListener('click', ev => {
      ev.stopPropagation();
      if (evt.isOccurrence && evt.seriesId) {
        openRepeatActionSheet(evt, dateKey, 'edit');
      } else {
        openAddEventModal(dateKey, evt);
      }
    });

    detail.querySelector('.event-detail__delete').addEventListener('click', ev => {
      ev.stopPropagation();
      if (!confirm(`Delete "${evt.title}"?`)) return;
      pushUndo(JSON.parse(JSON.stringify(state.data)));
      if (evt.isOccurrence && evt.seriesId) {
        openRepeatActionSheet(evt, dateKey, 'delete');
      } else {
        _deleteLocalEvent(state.data, dateKey, evt);
        saveData();
        refreshVisibleWeekCards();
      }
    });
  });

  // ── Delegated: multi-day bar inline detail ──
  gridWithSides.addEventListener('click', e => {
    const bar = e.target.closest('.multiday-bar');
    
    if (!bar) return;
    e.stopPropagation();

    const startKey = bar.dataset.startKey;
    const evtId    = bar.dataset.evtId;

    const overlay      = bar.closest('.multiday-overlay');
    const existingDetail = overlay?.querySelector('.multiday-detail');
    const wasThisBar   = existingDetail?.dataset.forId === evtId;

    document.querySelectorAll('.multiday-detail').forEach(d => d.remove());
    document.querySelectorAll('.multiday-bar--active').forEach(b => b.classList.remove('multiday-bar--active'));

    if (wasThisBar) return;

    const evt = state.data.days[startKey]?.events?.find(ev => ev.id === evtId);
    if (!evt) return;

    bar.classList.add('multiday-bar--active');
    bar.classList.add(`multiday-bar--theme-${evt.theme}`);

    const barRect  = bar.getBoundingClientRect();
    const gridRect = weekGrid.getBoundingClientRect();

    const detail = document.createElement('div');
    detail.className = 'event-detail multiday-detail';
    detail.dataset.forId = evtId;
    detail.style.cssText = `position:absolute;z-index:10;pointer-events:auto;` +
      `top:${barRect.bottom - gridRect.top + 2}px;` +
      `left:${Math.min(barRect.left - gridRect.left, gridRect.width - 180)}px;` +
      `min-width:160px;max-width:220px;`;
    detail.innerHTML = `
      <div class="event-detail__title">${evt.title}</div>
      ${evt.endDate ? `<div class="event-detail__time">${esc(startKey)} – ${esc(evt.endDate)}</div>` : ''}
      ${evt.notes   ? `<div class="event-detail__notes">${esc(stripHTML(evt.notes))}</div>` : ''}
      <div class="event-detail__actions">
        <button class="event-detail__btn event-detail__edit">Edit</button>
        <button class="event-detail__btn event-detail__delete">Delete</button>
      </div>
    `;
    overlay.appendChild(detail);

    detail.querySelector('.event-detail__edit').addEventListener('click', ev => {
      ev.stopPropagation();
      detail.remove();
      bar.classList.remove('multiday-bar--active');
      openAddEventModal(startKey, evt);
    });
    detail.querySelector('.event-detail__delete').addEventListener('click', ev => {
      ev.stopPropagation();
      if (!confirm(`Delete "${stripHTML(evt.title)}"?`)) return;
      pushUndo(JSON.parse(JSON.stringify(state.data)));
      _deleteLocalEvent(state.data, startKey, evt);
      saveData();
      refreshVisibleWeekCards();
    });
  });

  // ── Click-away: close event-detail dropdown (capture phase so stopPropagation on pills doesn't block it) ──
  document.addEventListener('click', e => {
    if (e.target.closest('.event-detail') || e.target.closest('.event-pill') || e.target.closest('.todo-label') || e.target.closest('.multiday-bar')) return;
    document.querySelectorAll('.event-detail').forEach(d => d.remove());
    document.querySelectorAll('.event-pill--active').forEach(p => p.classList.remove('event-pill--active'));
    document.querySelectorAll('.multiday-bar--active').forEach(b => b.classList.remove('multiday-bar--active'));
  }, true);

  // ── History API — back button / swipe-back closes any open overlay ──
  window.addEventListener('popstate', () => {
    if (isThemeEditorOpen()) { closeThemeEditor();     return; }
    if (_expandedOverlay)  { closeExpandedDay();      return; }
    if (_addEventSheet)    { closeAddEventModal();     return; }
    if (_qaSheet)          { closeQuickActions();      return; }
    if (_settingsDropdown) { closeSettingsDropdown();  return; }
    if (_datepickerOverlay){ closeDatePicker();        return; }
    if (_searchSheet)      { closeSearch();            return; }
    const agendaPanel = document.getElementById('agendaPanel');
    if (agendaPanel?.classList.contains('open')) { closeAgendaPanel(); return; }
    history.pushState({ chronicle: 'main' }, '');
  });

  // ── visualViewport — keyboard offset for format toolbar, modals, and bottom sheets ──
  if (window.visualViewport) {
    let _vvScrollTimer = null;
    const onVVResize = () => {
      const offset = Math.max(0, window.innerHeight - window.visualViewport.height);
      document.documentElement.style.setProperty('--keyboard-offset', `${offset}px`);
      document.querySelectorAll('.bottom-sheet.open').forEach(s => {
        s.style.maxHeight = offset > 0
          ? `${window.visualViewport.height}px`
          : '';
      });
      // Scroll cursor into view when keyboard appears, clearing toolbar + keyboard
      if (offset > 0) {
        clearTimeout(_vvScrollTimer);
        _vvScrollTimer = setTimeout(() => {
          const active = document.activeElement;
          if (!active || !active.isContentEditable) return;
          const sel = window.getSelection();
          if (!sel || !sel.rangeCount) return;
          const rect     = sel.getRangeAt(0).getBoundingClientRect();
          const vvH      = window.visualViewport.height;
          const toolbarH = 44; // format toolbar always shown when diary is focused
          const clearance = toolbarH + 24; // toolbar + breathing room
          if (rect.bottom > vvH - clearance) {
            let sc = active;
            while (sc && sc !== document.body) {
              const s = getComputedStyle(sc);
              if (s.overflowY === 'auto' || s.overflowY === 'scroll') break;
              sc = sc.parentElement;
            }
            if (sc && sc !== document.body) sc.scrollTop += rect.bottom - vvH + clearance + 8;
          }
        }, 150);
      }
    };
    window.visualViewport.addEventListener('resize', onVVResize);
    window.visualViewport.addEventListener('scroll', onVVResize);
  }

  // ── Keyboard shortcuts ──
  document.addEventListener('keydown', e => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === 'z' && !e.shiftKey) { e.preventDefault(); handleUndo(); return; }
    if (mod && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); handleRedo(); return; }
    if (e.key === 'Escape') {
      if (_expandedOverlay) { history.back(); return; }
      closeAddEventModal();
      closeQuickActions();
      closeSettingsDropdown();
      closeDatePicker();
      closeAgendaPanel();
    }
    if (!mod && !anyModalOpen()) {
      const isTyping = document.activeElement &&
        (['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName) ||
         document.activeElement.isContentEditable);
      if (!isTyping) {
        if (e.key === 'ArrowLeft')  { prevWeek();       return; }
        if (e.key === 'ArrowRight') { nextWeek();       return; }
        if (e.key === 'ArrowUp')    { prevMonthFirst(); return; }
        if (e.key === 'ArrowDown')  { nextMonthFirst(); return; }
      }
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      scheduleReminders(state.data);
      bgSync(state.data, _applyRemoteData, _openConflict).catch(console.warn);
    }
  });

  scheduleNextDayRefresh();
}


document.addEventListener('DOMContentLoaded', init);
