/** Chronicle — App initialisation, state management, UI orchestration */

import {
  formatDate, parseDate,
  getWeekStart, getDaysOfWeek,
  getWeekNumber, navigateWeek, navigateMonth,
  getMonthName, getDayName, isSameDay,
  getDaysInMonth, getFirstDayOfMonth,
} from './calendar.js';

import { getEvents, addEvent, updateEvent, deleteEvent } from './events.js';
import { getDiaryText, initDiaryArea } from './diary.js';
import { initSwipeGestures, initLongPress } from './gestures.js';
import { pushUndo, undo, redo } from './undo.js';
import { markDirty, registerDirtyCallback } from './sync.js';

// ── All user-visible strings (i18n-ready) ──────────────────────────────────

const STRINGS = {
  appTitle:         'Chronicle',
  back:             'Back',
  today:            'Today',
  prevWeek:         'Prev week',
  nextWeek:         'Next week',
  prevMonth:        'Prev month',
  nextMonth:        'Next month',
  addEvent:         'Add event',
  addTodo:          'Add todo',
  addReminder:      'Add reminder',
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
  importDone:       'Data imported',
  searchPlaceholder:'Search diary and events…',
  lastSync:         'Last sync: {t}',
  neverSynced:      'Never synced',
  confirmClearDay:  'Clear all entries for this day?',
  confirmClearAll:  'Delete ALL data? This cannot be undone.',
  aboutText:        'Chronicle v1.0 — Personal diary & calendar',
  copiedToast:      'Copied to clipboard',
  nothingToCopy:    'Nothing to copy',
  searchSoon:       'Search coming soon',
  syncSoon:         'Google Drive sync coming soon',
  invalidImport:    'Import failed: invalid file',
};

const STORAGE_KEY = 'chronicle_data';

// ── App state ──────────────────────────────────────────────────────────────

const state = {
  data: null,
  currentWeekStart: null,
  today: null,
};

// ── Data layer ─────────────────────────────────────────────────────────────

/** Load persisted data from localStorage, or return a fresh default model */
function loadData() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try { return JSON.parse(raw); } catch { /* corrupt data — fall through */ }
  }
  return buildDefaultData();
}

/** Build a fresh data model with sample entries for the current week */
function buildDefaultData() {
  const today = new Date();
  const todayKey = formatDate(today);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const tomorrowKey = formatDate(tomorrow);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const yesterdayKey = formatDate(yesterday);
  const now = Date.now();

  return {
    version: 1,
    settings: {
      weekStart: 'mon',
      theme: 'light',
      notifications: true,
      gdrive: { enabled: false, lastSync: null },
    },
    days: {
      [todayKey]: {
        diary: 'Morning run felt good. Clear skies.',
        events: [
          { id: 'sample1', type: 'event',    title: 'Team standup',  time: '09:00', done: false, repeat: null, notes: '', created: now, modified: now },
          { id: 'sample2', type: 'todo',     title: 'Review PR #42', time: null,    done: false, repeat: null, notes: '', created: now, modified: now },
        ],
        images: [],
      },
      [tomorrowKey]: {
        diary: '',
        events: [
          { id: 'sample3', type: 'reminder', title: 'Call dentist',  time: '10:00', done: false, repeat: null, notes: '', created: now, modified: now },
        ],
        images: [],
      },
      [yesterdayKey]: {
        diary: 'Finished the report. Feeling productive.',
        events: [],
        images: [],
      },
    },
  };
}

/** Persist data to localStorage and flag as unsynced */
function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
  markDirty();
}

/** Ensure a day entry exists in the data model */
function ensureDay(dateKey) {
  if (!state.data.days[dateKey]) {
    state.data.days[dateKey] = { diary: '', events: [], images: [] };
  }
}

// ── Theme ──────────────────────────────────────────────────────────────────

/** Apply or remove the dark-mode class and update theme-color meta */
function applyTheme(theme) {
  document.body.classList.toggle('dark', theme === 'dark');
}

// ── Toast ──────────────────────────────────────────────────────────────────

let _toastTimer = null;

/** Show a brief non-blocking toast message */
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

/** Update the month name and week-number text in the ribbon */
function updateRibbonLabels() {
  const days = getDaysOfWeek(state.currentWeekStart);
  const mid = days[3]; // Thursday is mid-week reference
  document.getElementById('ribbonMonth').textContent =
    `${getMonthName(mid)} ${mid.getFullYear()}`;
  document.getElementById('ribbonWeek').textContent =
    STRINGS.weekLabel.replace('{n}', getWeekNumber(mid));
}

// ── Escape HTML ────────────────────────────────────────────────────────────

/** Escape a string for safe insertion into innerHTML */
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Week grid rendering ────────────────────────────────────────────────────

/** Rebuild the entire week grid from current state */
function renderWeekGrid() {
  const grid = document.getElementById('weekGrid');
  if (!grid) return;
  grid.innerHTML = '';

  const days = getDaysOfWeek(state.currentWeekStart);

  days.forEach(date => {
    const dow     = date.getDay(); // 0=Sun … 6=Sat
    const isSun   = dow === 0;
    const isSat   = dow === 6;
    const isToday = isSameDay(date, state.today);
    const dateKey = formatDate(date);

    const card = document.createElement('div');
    card.className = 'day-card';
    card.dataset.date = dateKey;
    card.setAttribute('role', 'article');
    card.setAttribute('aria-label', date.toLocaleDateString('default', { weekday: 'long', month: 'long', day: 'numeric' }));

    if (isToday)         card.classList.add('today');
    if (isSun || isSat)  card.classList.add('weekend', 'weekend-half');
    if (isSun)           card.classList.add('full-width');

    card.innerHTML = buildCardHTML(date, dateKey);

    const diaryEl = card.querySelector('.diary-area');
    if (diaryEl) {
      initDiaryArea(
        diaryEl,
        () => getDiaryText(state.data, dateKey),
        text => {
          ensureDay(dateKey);
          state.data.days[dateKey].diary = text;
          saveData();
        },
        {
          placeholder: STRINGS.diaryPlaceholder,
          ariaLabel:   `Diary entry for ${dateKey}`,
        }
      );
    }

    card.addEventListener('click', e => {
      if (e.target.closest('.diary-area')) return;
      openExpandedDay(dateKey);
    });

    initLongPress(card, e => {
      e.preventDefault?.();
      openQuickActions(dateKey, date);
    });

    grid.appendChild(card);
  });

  updateRibbonLabels();
}

/** Build the inner HTML for a single day card */
function buildCardHTML(date, dateKey) {
  const events  = getEvents(state.data, dateKey);
  const shown   = events.slice(0, 3);
  const extra   = events.length - 3;

  const pillsHTML = shown.map(evt => {
    const prefix  = evt.type === 'todo' ? '✓ ' : '';
    const timeStr = evt.time ? `${evt.time} ` : '';
    return `<div class="event-pill event-pill--${esc(evt.type)}">
      <span class="event-pill-text">${prefix}${timeStr}${esc(evt.title)}</span>
    </div>`;
  }).join('');

  const moreHTML = extra > 0
    ? `<div class="events-more">${STRINGS.moreEvents.replace('{n}', extra)}</div>`
    : '';

  return `
    <div class="day-header">
      <span class="day-name">${getDayName(date)}</span>
      <span class="day-number">${date.getDate()}</span>
    </div>
    <div class="events-strip">${pillsHTML}${moreHTML}</div>
    <div class="diary-area" tabindex="0"></div>
  `;
}

/** Refresh only the events strip of a specific card, leaving the diary untouched */
function refreshCardEvents(dateKey) {
  const card = document.querySelector(`.day-card[data-date="${dateKey}"]`);
  if (!card) return;
  const strip = card.querySelector('.events-strip');
  if (!strip) return;

  const events = getEvents(state.data, dateKey);
  const shown  = events.slice(0, 3);
  const extra  = events.length - 3;

  strip.innerHTML = shown.map(evt => {
    const prefix  = evt.type === 'todo' ? '✓ ' : '';
    const timeStr = evt.time ? `${evt.time} ` : '';
    return `<div class="event-pill event-pill--${esc(evt.type)}">
      <span class="event-pill-text">${prefix}${timeStr}${esc(evt.title)}</span>
    </div>`;
  }).join('') + (extra > 0
    ? `<div class="events-more">${STRINGS.moreEvents.replace('{n}', extra)}</div>`
    : '');
}

// ── Navigation ─────────────────────────────────────────────────────────────

/** Navigate to the week that contains `date` */
function goToWeek(date) {
  state.currentWeekStart = getWeekStart(date, state.data.settings.weekStart);
  renderWeekGrid();
}

function goToToday()  { goToWeek(state.today); }
function prevWeek()   { state.currentWeekStart = navigateWeek(state.currentWeekStart, -1); renderWeekGrid(); }
function nextWeek()   { state.currentWeekStart = navigateWeek(state.currentWeekStart,  1); renderWeekGrid(); }
function prevMonth()  { state.currentWeekStart = navigateMonth(state.currentWeekStart, -1, state.data.settings.weekStart); renderWeekGrid(); }
function nextMonth()  { state.currentWeekStart = navigateMonth(state.currentWeekStart,  1, state.data.settings.weekStart); renderWeekGrid(); }

// ── Expanded day view ──────────────────────────────────────────────────────

let _expandedOverlay = null;

/** Open the full-screen expanded view for a date */
function openExpandedDay(dateKey) {
  closeExpandedDay();

  const date  = parseDate(dateKey);
  const title = date.toLocaleDateString('default', { weekday: 'long', day: 'numeric', month: 'long' });

  const overlay = document.createElement('div');
  overlay.className = 'expanded-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', `Day view: ${title}`);

  overlay.innerHTML = `
    <header class="expanded-header">
      <button class="expanded-back" aria-label="${STRINGS.back}">
        <svg class="icon"><use href="assets/icons.svg#icon-chevron-left"/></svg>
        ${STRINGS.back}
      </button>
      <div class="expanded-title">${esc(title)}</div>
      <button class="expanded-add-btn" aria-label="${STRINGS.addEvent}">+ ${STRINGS.addEvent}</button>
    </header>
    <div class="expanded-body">
      <div class="expanded-section">
        <div class="expanded-section-header">${STRINGS.eventSection}</div>
        <div class="expanded-event-list" id="expandedEventList"></div>
        <div class="expanded-add-item" role="button" tabindex="0">+ Add item</div>
      </div>
      <div class="expanded-section expanded-diary-section">
        <div class="expanded-section-header">${STRINGS.diarySection}</div>
        <div class="expanded-diary-area" tabindex="0"></div>
      </div>
    </div>
    <div class="expanded-stubs">
      <button class="expanded-stub-btn" disabled aria-label="${STRINGS.attachImage} (coming soon)">
        <svg class="icon"><use href="assets/icons.svg#icon-image"/></svg>
        ${STRINGS.attachImage}
      </button>
      <button class="expanded-stub-btn" disabled aria-label="${STRINGS.moodTag} (coming soon)">
        <svg class="icon"><use href="assets/icons.svg#icon-smile"/></svg>
        ${STRINGS.moodTag}
      </button>
    </div>
  `;

  document.body.appendChild(overlay);
  _expandedOverlay = overlay;

  // Diary area
  const diaryEl = overlay.querySelector('.expanded-diary-area');
  if (diaryEl) {
    initDiaryArea(
      diaryEl,
      () => getDiaryText(state.data, dateKey),
      text => {
        ensureDay(dateKey);
        state.data.days[dateKey].diary = text;
        saveData();
      },
      { placeholder: STRINGS.diaryPlaceholder, ariaLabel: `Diary entry for ${dateKey}` }
    );
  }

  renderExpandedEvents(overlay, dateKey);

  overlay.querySelector('.expanded-back').addEventListener('click', closeExpandedDay);
  overlay.querySelector('.expanded-add-btn').addEventListener('click', () => {
    closeExpandedDay();
    openAddEventModal(dateKey);
  });
  overlay.querySelector('.expanded-add-item').addEventListener('click', () => {
    closeExpandedDay();
    openAddEventModal(dateKey);
  });

  requestAnimationFrame(() => overlay.classList.add('open'));
}

/** Render the event list inside the expanded view */
function renderExpandedEvents(overlay, dateKey) {
  const list = overlay.querySelector('#expandedEventList');
  if (!list) return;

  const events = getEvents(state.data, dateKey);
  list.innerHTML = events.length === 0
    ? `<div class="search-empty" style="padding:10px 0">No events yet</div>`
    : events.map(evt => {
        const prefix = evt.type === 'todo' ? '✓ ' : '';
        const done   = evt.done ? 'done' : '';
        const time   = evt.time ? `<div class="expanded-event-time">${esc(evt.time)}</div>` : '';
        return `
          <div class="expanded-event-item" data-id="${esc(evt.id)}">
            <div class="expanded-event-dot expanded-event-dot--${esc(evt.type)}"></div>
            <div class="expanded-event-content">
              <div class="expanded-event-title ${done}">${prefix}${esc(evt.title)}</div>
              ${time}
            </div>
            <button class="expanded-event-edit" data-edit="${esc(evt.id)}" aria-label="Edit">Edit</button>
          </div>`;
      }).join('');

  list.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => {
      const evt = getEvents(state.data, dateKey).find(e => e.id === btn.dataset.edit);
      if (evt) {
        closeExpandedDay();
        openAddEventModal(dateKey, evt);
      }
    });
  });
}

/** Close and remove the expanded overlay */
function closeExpandedDay() {
  if (!_expandedOverlay) return;
  _expandedOverlay.classList.remove('open');
  const el = _expandedOverlay;
  _expandedOverlay = null;
  setTimeout(() => el.remove(), 320);
}

// ── Add-event modal ────────────────────────────────────────────────────────

let _addEventSheet    = null;
let _addEventBackdrop = null;

/** Open the add/edit event bottom sheet */
function openAddEventModal(dateKey, existing = null) {
  closeAddEventModal();

  const isEdit = !!existing;
  const type   = existing?.type  ?? 'event';
  const title  = existing?.title ?? '';
  const time   = existing?.time  ?? '';
  const notes  = existing?.notes ?? '';

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.addEventListener('click', closeAddEventModal);

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
        <input class="field-input" id="evtTitle" type="text" placeholder="Entry title" value="${esc(title)}" autocomplete="off" autocorrect="on">
      </div>
      <div class="field-group">
        <label class="field-label">Type</label>
        <div class="segmented-control" id="typeControl">
          <div class="seg-btn ${type === 'event'    ? 'active' : ''}" data-type="event">Event</div>
          <div class="seg-btn ${type === 'todo'     ? 'active' : ''}" data-type="todo">Todo</div>
          <div class="seg-btn ${type === 'reminder' ? 'active' : ''}" data-type="reminder">Reminder</div>
        </div>
      </div>
      <div class="field-group">
        <label class="field-label" for="evtDate">Date</label>
        <input class="field-input" id="evtDate" type="date" value="${esc(dateKey)}">
      </div>
      <div class="field-group">
        <label class="field-label" for="evtTime">Time (optional)</label>
        <input class="field-input" id="evtTime" type="time" value="${esc(time)}">
      </div>
      <div class="field-group">
        <label class="field-label" for="evtRepeat">Repeat</label>
        <select class="field-input" id="evtRepeat">
          <option value="">None</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
          <option value="custom" disabled>Custom (coming soon)</option>
        </select>
      </div>
      <div class="field-group">
        <label class="field-label" for="evtNotes">Notes (optional)</label>
        <textarea class="field-input field-textarea" id="evtNotes" placeholder="Additional notes…">${esc(notes)}</textarea>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);
  document.body.appendChild(sheet);
  _addEventBackdrop = backdrop;
  _addEventSheet    = sheet;

  let selectedType = type;

  sheet.querySelectorAll('.seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedType = btn.dataset.type;
      sheet.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b === btn));
    });
  });

  sheet.querySelector('#sheetCancel').addEventListener('click', closeAddEventModal);

  sheet.querySelector('#sheetSave').addEventListener('click', () => {
    const titleVal = sheet.querySelector('#evtTitle').value.trim();
    if (!titleVal) { sheet.querySelector('#evtTitle').focus(); return; }

    const dateVal  = sheet.querySelector('#evtDate').value  || dateKey;
    const timeVal  = sheet.querySelector('#evtTime').value;
    const notesVal = sheet.querySelector('#evtNotes').value;

    pushUndo(JSON.parse(JSON.stringify(state.data)));

    if (isEdit) {
      updateEvent(state.data, dateKey, existing.id, {
        title: titleVal, type: selectedType,
        time: timeVal || null, notes: notesVal,
      });
    } else {
      addEvent(state.data, dateVal, {
        title: titleVal, type: selectedType,
        time: timeVal || null, notes: notesVal,
      });
    }

    saveData();
    refreshCardEvents(dateVal);
    closeAddEventModal();
  });

  requestAnimationFrame(() => sheet.classList.add('open'));
  setTimeout(() => sheet.querySelector('#evtTitle').focus(), 350);
}

/** Close and remove the add-event sheet */
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

// ── Quick actions sheet ────────────────────────────────────────────────────

let _qaSheet    = null;
let _qaBackdrop = null;

/** Show the long-press quick-action sheet for a day card */
function openQuickActions(dateKey, date) {
  closeQuickActions();

  const label = date.toLocaleDateString('default', { weekday: 'long', day: 'numeric', month: 'short' });

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.addEventListener('click', closeQuickActions);

  const sheet = document.createElement('div');
  sheet.className = 'bottom-sheet';
  sheet.innerHTML = `
    <div class="sheet-handle"></div>
    <div class="sheet-header">
      <span class="sheet-title">${esc(label)}</span>
      <button class="sheet-cancel" id="qaCancel">${STRINGS.cancel}</button>
    </div>
    <div class="quick-actions">
      <div class="quick-action-item" data-action="event" role="button" tabindex="0">
        <div class="quick-action-icon"><svg class="icon"><use href="assets/icons.svg#icon-calendar"/></svg></div>
        ${STRINGS.addEvent}
      </div>
      <div class="quick-action-item" data-action="todo" role="button" tabindex="0">
        <div class="quick-action-icon"><svg class="icon"><use href="assets/icons.svg#icon-check"/></svg></div>
        ${STRINGS.addTodo}
      </div>
      <div class="quick-action-item" data-action="reminder" role="button" tabindex="0">
        <div class="quick-action-icon"><svg class="icon"><use href="assets/icons.svg#icon-bell"/></svg></div>
        ${STRINGS.addReminder}
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

  sheet.querySelector('#qaCancel').addEventListener('click', closeQuickActions);

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

/** Dispatch a quick-action by key */
function handleQuickAction(action, dateKey, date) {
  switch (action) {
    case 'event':    openAddEventModal(dateKey); break;
    case 'todo':     openAddEventModal(dateKey, { type: 'todo', title: '' }); break;
    case 'reminder': openAddEventModal(dateKey, { type: 'reminder', title: '' }); break;
    case 'expand':   openExpandedDay(dateKey); break;
    case 'copy':     copyDayEntries(dateKey); break;
    case 'clear':
      if (confirm(STRINGS.confirmClearDay)) {
        pushUndo(JSON.parse(JSON.stringify(state.data)));
        if (state.data.days[dateKey]) {
          state.data.days[dateKey].events = [];
          state.data.days[dateKey].diary  = '';
        }
        saveData();
        renderWeekGrid();
      }
      break;
  }
}

/** Copy a day's events and diary text to the clipboard */
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
  if (day.diary) { lines.push('', 'Diary:', day.diary); }
  navigator.clipboard?.writeText(lines.join('\n'))
    .then(() => showToast(STRINGS.copiedToast))
    .catch(() => showToast('Copy failed'));
}

/** Close and remove the quick-action sheet */
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

/** Open or toggle the settings dropdown */
function openSettingsDropdown() {
  if (_settingsDropdown) { closeSettingsDropdown(); return; }

  const { theme, weekStart, notifications, gdrive } = state.data.settings;
  const lastSyncStr = gdrive.lastSync
    ? STRINGS.lastSync.replace('{t}', new Date(gdrive.lastSync).toLocaleString())
    : STRINGS.neverSynced;

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.addEventListener('click', closeSettingsDropdown);

  const dropdown = document.createElement('div');
  dropdown.className = 'settings-dropdown';

  dropdown.innerHTML = `
    <div class="settings-section">
      <div class="settings-row">
        <div class="settings-label">Appearance</div>
        <div class="toggle-pill">
          <div class="toggle-pill-btn ${theme === 'light' ? 'active' : ''}" data-theme="light">Light</div>
          <div class="toggle-pill-btn ${theme === 'dark'  ? 'active' : ''}" data-theme="dark">Dark</div>
        </div>
      </div>
      <div class="settings-row">
        <div class="settings-label">Week starts</div>
        <div class="toggle-pill">
          <div class="toggle-pill-btn ${weekStart === 'mon' ? 'active' : ''}" data-week="mon">Mon</div>
          <div class="toggle-pill-btn ${weekStart === 'sun' ? 'active' : ''}" data-week="sun">Sun</div>
        </div>
      </div>
    </div>
    <div class="settings-section">
      <div class="settings-row" data-action="export"><span class="settings-action">Export JSON</span></div>
      <div class="settings-row" data-action="import"><span class="settings-action">Import JSON</span></div>
      <div class="settings-row" data-action="clearall"><span class="settings-action settings-action--destructive">Clear all data</span></div>
    </div>
    <div class="settings-section">
      <div class="settings-row">
        <div class="settings-label">Notifications</div>
        <div class="toggle-pill">
          <div class="toggle-pill-btn ${notifications  ? 'active' : ''}" data-notif="on">On</div>
          <div class="toggle-pill-btn ${!notifications ? 'active' : ''}" data-notif="off">Off</div>
        </div>
      </div>
      <div class="settings-row">
        <div>
          <div class="settings-label">Google Drive</div>
          <div class="settings-sublabel">${esc(lastSyncStr)}</div>
        </div>
        <div class="toggle-pill">
          <div class="toggle-pill-btn ${gdrive.enabled  ? 'active' : ''}" data-gdrive="on">On</div>
          <div class="toggle-pill-btn ${!gdrive.enabled ? 'active' : ''}" data-gdrive="off">Off</div>
        </div>
      </div>
      <div class="settings-row" data-action="about"><span class="settings-action">About / Help</span></div>
    </div>
  `;

  document.body.appendChild(backdrop);
  document.body.appendChild(dropdown);
  _settingsBackdrop = backdrop;
  _settingsDropdown = dropdown;

  // Theme toggle
  dropdown.querySelectorAll('[data-theme]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.data.settings.theme = btn.dataset.theme;
      applyTheme(btn.dataset.theme);
      saveData();
      dropdown.querySelectorAll('[data-theme]').forEach(b => b.classList.toggle('active', b === btn));
    });
  });

  // Week-start toggle
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

  // Notifications toggle
  dropdown.querySelectorAll('[data-notif]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.data.settings.notifications = btn.dataset.notif === 'on';
      saveData();
      dropdown.querySelectorAll('[data-notif]').forEach(b => b.classList.toggle('active', b === btn));
    });
  });

  // GDrive toggle
  dropdown.querySelectorAll('[data-gdrive]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.data.settings.gdrive.enabled = btn.dataset.gdrive === 'on';
      saveData();
      dropdown.querySelectorAll('[data-gdrive]').forEach(b => b.classList.toggle('active', b === btn));
    });
  });

  // Data action rows
  dropdown.querySelectorAll('[data-action]').forEach(row => {
    row.addEventListener('click', () => {
      const action = row.dataset.action;
      closeSettingsDropdown();
      handleSettingsAction(action);
    });
  });

  requestAnimationFrame(() => dropdown.classList.add('open'));
}

/** Handle a settings menu action */
function handleSettingsAction(action) {
  switch (action) {
    case 'export':
      exportJSON();
      break;

    case 'import': {
      const input = document.createElement('input');
      input.type   = 'file';
      input.accept = '.json';
      input.style.display = 'none';
      document.body.appendChild(input);
      input.click();
      input.addEventListener('change', () => {
        const file = input.files[0];
        if (!file) { input.remove(); return; }
        const reader = new FileReader();
        reader.onload = ev => {
          try {
            const imported = JSON.parse(ev.target.result);
            if (!imported.days || !imported.settings) throw new Error('Invalid structure');
            const replace = confirm('Replace all existing data? Press Cancel to merge instead.');
            if (replace) {
              state.data = imported;
            } else {
              Object.assign(state.data.days, imported.days);
            }
            saveData();
            renderWeekGrid();
            showToast(STRINGS.importDone);
          } catch {
            showToast(STRINGS.invalidImport);
          }
          input.remove();
        };
        reader.readAsText(file);
      });
      break;
    }

    case 'clearall':
      if (confirm(STRINGS.confirmClearAll)) {
        state.data.days = {};
        saveData();
        renderWeekGrid();
        showToast('All data cleared');
      }
      break;

    case 'about':
      showToast(STRINGS.aboutText);
      break;
  }
}

/** Export the full data model as a JSON file download */
function exportJSON() {
  const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `chronicle-export-${formatDate(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(STRINGS.exportDone);
}

/** Close and remove the settings dropdown */
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

// ── Date picker ────────────────────────────────────────────────────────────

let _datepickerOverlay = null;
let _dpState = null;

/** Open the mini date-picker overlay */
function openDatePicker() {
  if (_datepickerOverlay) { closeDatePicker(); return; }

  _dpState = { year: state.today.getFullYear(), month: state.today.getMonth() };

  const overlay = document.createElement('div');
  overlay.className = 'datepicker-overlay';
  overlay.addEventListener('click', e => { if (e.target === overlay) closeDatePicker(); });

  const modal = document.createElement('div');
  modal.className = 'datepicker-modal';
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  _datepickerOverlay = overlay;

  renderDatePickerModal(modal);
  requestAnimationFrame(() => modal.classList.add('open'));
}

/** Re-render the date picker grid for the current _dpState month */
function renderDatePickerModal(modal) {
  const { year, month } = _dpState;
  const ws          = state.data.settings.weekStart;
  const daysInMonth = getDaysInMonth(year, month);
  const monthLabel  = new Date(year, month, 1).toLocaleString('default', { month: 'long' });
  const todayKey    = formatDate(state.today);

  const dayNames = ws === 'mon'
    ? ['Mo','Tu','We','Th','Fr','Sa','Su']
    : ['Su','Mo','Tu','We','Th','Fr','Sa'];

  let firstDow = getFirstDayOfMonth(year, month); // 0=Sun
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

  modal.querySelector('#dpToday').addEventListener('click', () => {
    goToToday();
    closeDatePicker();
  });

  modal.querySelectorAll('.datepicker-day[data-date]').forEach(cell => {
    cell.addEventListener('click', () => {
      goToWeek(parseDate(cell.dataset.date));
      closeDatePicker();
    });
  });
}

/** Close and remove the date picker */
function closeDatePicker() {
  if (!_datepickerOverlay) return;
  _datepickerOverlay.querySelector('.datepicker-modal')?.classList.remove('open');
  const el = _datepickerOverlay;
  _datepickerOverlay = null;
  setTimeout(() => el.remove(), 180);
}

// ── Search overlay (stub shell) ────────────────────────────────────────────

/** Open a minimal search overlay shell */
function openSearch() {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';

  const sheet = document.createElement('div');
  sheet.className = 'bottom-sheet';
  sheet.style.maxHeight = '85dvh';
  sheet.innerHTML = `
    <div class="sheet-handle"></div>
    <div class="sheet-header">
      <button class="sheet-cancel" id="searchClose">${STRINGS.cancel}</button>
      <span class="sheet-title">Search</span>
      <span></span>
    </div>
    <div class="sheet-body">
      <input class="field-input" type="search" placeholder="${STRINGS.searchPlaceholder}" id="searchInput" autocomplete="off">
      <div class="search-empty">Search coming in a future update.</div>
    </div>
  `;

  const close = () => {
    sheet.classList.remove('open');
    backdrop.remove();
    setTimeout(() => sheet.remove(), 320);
  };

  backdrop.addEventListener('click', close);
  sheet.querySelector('#searchClose').addEventListener('click', close);

  document.body.appendChild(backdrop);
  document.body.appendChild(sheet);
  requestAnimationFrame(() => sheet.classList.add('open'));
  setTimeout(() => sheet.querySelector('#searchInput').focus(), 350);
}

// ── Undo / redo ────────────────────────────────────────────────────────────

function handleUndo() {
  const prev = undo(state.data);
  if (prev) {
    state.data = prev;
    saveData();
    renderWeekGrid();
    showToast(STRINGS.undone);
  } else {
    showToast(STRINGS.noUndo);
  }
}

function handleRedo() {
  const next = redo(state.data);
  if (next) {
    state.data = next;
    saveData();
    renderWeekGrid();
    showToast(STRINGS.redone);
  }
}

// ── Midnight refresh ───────────────────────────────────────────────────────

/** Schedule a re-render at the next midnight so "today" stays accurate */
function scheduleNextDayRefresh() {
  const now      = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
  setTimeout(() => {
    state.today = new Date();
    state.today.setHours(0, 0, 0, 0);
    renderWeekGrid();
    scheduleNextDayRefresh();
  }, tomorrow - now);
}

// ── Bootstrap ──────────────────────────────────────────────────────────────

function init() {
  state.data  = loadData();
  state.today = new Date();
  state.today.setHours(0, 0, 0, 0);
  state.currentWeekStart = getWeekStart(state.today, state.data.settings.weekStart);

  applyTheme(state.data.settings.theme);

  registerDirtyCallback(dirty => {
    const badge = document.getElementById('syncBadge');
    if (badge) badge.hidden = !dirty;
  });

  renderWeekGrid();

  // Ribbon buttons
  document.getElementById('btnToday').addEventListener('click', goToToday);
  document.getElementById('btnJumpDate').addEventListener('click', openDatePicker);
  document.getElementById('btnSearch').addEventListener('click', openSearch);
  document.getElementById('btnSync').addEventListener('click', () => showToast(STRINGS.syncSoon));
  document.getElementById('btnAdd').addEventListener('click', () => openAddEventModal(formatDate(state.today)));
  document.getElementById('btnSettings').addEventListener('click', openSettingsDropdown);

  // Edge navigation arrows
  document.getElementById('navPrevWeek').addEventListener('click', prevWeek);
  document.getElementById('navNextWeek').addEventListener('click', nextWeek);
  document.getElementById('navPrevMonth').addEventListener('click', prevMonth);
  document.getElementById('navNextMonth').addEventListener('click', nextMonth);

  // Swipe gestures on the week grid
  initSwipeGestures(document.getElementById('weekGrid'), {
    onSwipeLeft:  nextMonth,
    onSwipeRight: prevMonth,
    onSwipeUp:    nextWeek,
    onSwipeDown:  prevWeek,
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === 'z' && !e.shiftKey) { e.preventDefault(); handleUndo(); return; }
    if (mod && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); handleRedo(); return; }
    if (e.key === 'Escape') {
      closeExpandedDay();
      closeAddEventModal();
      closeQuickActions();
      closeSettingsDropdown();
      closeDatePicker();
    }
  });

  scheduleNextDayRefresh();
}

document.addEventListener('DOMContentLoaded', init);
