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
  deleteEvent,
  getEventsForDate,
  createRepeatRule   // ⭐ ADD THIS
} from './events.js'
import { getDiaryText, initDiaryArea, initFormatToolbar } from './diary.js';
import { initGestures } from './gestures.js';
import { pushUndo, undo, redo } from './undo.js';
import { markDirty, registerDirtyCallback } from './sync.js';





// ── All user-visible strings (i18n-ready) ──────────────────────────────────

const STRINGS = {
  appTitle:         'Chronicle',
  back:             'Back',
  today:            'Today',
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

// ── App state ──────────────────────────────────────────────────────────────

const state = {
  data: null,
  currentWeekStart: null,
  today: null,
};


let _lastFocusedDate      = null;
let _suppressNextCardClick = false; // set after gesture long-press to eat the trailing click

// ── Data layer ─────────────────────────────────────────────────────────────

function loadData() {
  const raw = localStorage.getItem(STORAGE_KEY);
  let data;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = buildDefaultData();
    }
  } else {
  const data = buildDefaultData();
  if (!data.series) data.series = [];
  return data;
}
  if (!data.series) data.series = [];
  return data;
}

function getSeriesForOccurrence(evt) {
  return state.data.series.find(s => s.id === (evt.seriesId || evt.id)) || null;
}

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
    weekStart:    'mon',
    theme:        'light',
    notifications: true,
    fyStartMonth: 3,
    fyStartDay:   6,
    gdrive: { enabled: false, lastSync: null },
  },

  days: {
    [todayKey]: {
      diary: 'Morning run felt good. Clear skies.',
      events: [
        {
          id: 'sample1',
          type: 'event',
          title: 'Team standup',
          time: '09:00',
          done: false,
          repeat: null,
          notes: '',
          reminderMinutes: 15,
          created: now,
          modified: now
        },
        {
          id: 'sample2',
          type: 'todo',
          title: 'Review PR #42',
          time: null,
          done: false,
          repeat: null,
          notes: '',
          reminderMinutes: null,
          created: now,
          modified: now
        }
      ],
      images: []
    },

    [tomorrowKey]: {
      diary: '',
      events: [
        {
          id: 'sample3',
          type: 'reminder',
          title: 'Call dentist',
          time: '10:00',
          done: false,
          repeat: null,
          notes: '',
          reminderMinutes: 30,
          created: now,
          modified: now
        }
      ],
      images: []
    },

    [yesterdayKey]: {
      diary: 'Finished the report. Feeling productive.',
      events: [],
      images: []
    }
  },

  // ✅ The ONLY correct place for repeating events
  series: []
};
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
  markDirty();
}

function ensureDay(dateKey) {
  if (!state.data.days[dateKey]) {
    state.data.days[dateKey] = { diary: '', events: [], images: [] };
  }
}

// ── Theme ──────────────────────────────────────────────────────────────────

function applyTheme(theme) {
  document.body.classList.toggle('dark', theme === 'dark');
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
  document.getElementById('ribbonMonth').textContent =
    `${getMonthName(mid)} ${mid.getFullYear()}`;
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

function renderWeekGrid() {
  const grid = document.getElementById('weekGrid');
  if (!grid) return;
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
}

/** Build the inner HTML for a single day card */
function buildCardHTML(date, dateKey) {
  const events = getEventsForDate(state.data, dateKey);
  const shown  = events.slice(0, 3);
  const extra  = events.length - 3;

  const itemsHTML = shown.map(evt => {
    if (evt.type === 'todo') {
      return `<div class="todo-item ${evt.done ? 'todo-item--done' : ''}"
                   data-todo-id="${esc(evt.id)}" data-date="${esc(dateKey)}">
        <span class="todo-checkbox">${evt.done ? '&#10003;' : ''}</span>
        <span class="todo-label">${esc(evt.title)}</span>
      </div>`;
    }
    const timeStr = evt.time ? `${evt.time} ` : '';
    const bell    = evt.reminderMinutes != null
      ? `<span class="pill-reminder" aria-label="Reminder set">🔔</span>` : '';
    return `<div class="event-pill event-pill--${esc(evt.type)}"
                 data-id="${esc(evt.id)}" data-date="${esc(dateKey)}">
      <span class="event-pill-text">${timeStr}${esc(evt.title)}</span>${bell}
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

  const events = getEventsForDate(state.data, dateKey);
  const shown  = events.slice(0, 3);
  const extra  = events.length - 3;

  strip.innerHTML = shown.map(evt => {
    if (evt.type === 'todo') {
      return `<div class="todo-item ${evt.done ? 'todo-item--done' : ''}"
                   data-todo-id="${esc(evt.id)}" data-date="${esc(dateKey)}">
        <span class="todo-checkbox">${evt.done ? '&#10003;' : ''}</span>
        <span class="todo-label">${esc(evt.title)}</span>
      </div>`;
    }
    const timeStr = evt.time ? `${evt.time} ` : '';
    const bell    = evt.reminderMinutes != null
      ? `<span class="pill-reminder" aria-label="Reminder set">🔔</span>` : '';
    return `<div class="event-pill event-pill--${esc(evt.type)}"
                 data-id="${esc(evt.id)}" data-date="${esc(dateKey)}">
      <span class="event-pill-text">${timeStr}${esc(evt.title)}</span>${bell}
    </div>`;
  }).join('') + (extra > 0
    ? `<div class="events-more">${STRINGS.moreEvents.replace('{n}', extra)}</div>`
    : '');
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

// ── Expanded day view ──────────────────────────────────────────────────────

let _expandedOverlay = null;

function openExpandedDay(dateKey) {
  if (_expandedOverlay) closeExpandedDay();

  history.pushState({ chronicle: 'expanded', dateKey }, '');

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
        <div class="expanded-section-header">
          ${STRINGS.diarySection}
          <span class="diary-saved-indicator"></span>
        </div>
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

  // Back button → history.back() → popstate → closeExpandedDay()
  overlay.querySelector('.expanded-back').addEventListener('click', () => history.back());
  overlay.querySelector('.expanded-add-btn').addEventListener('click', () => {
    history.back();
    setTimeout(() => openAddEventModal(dateKey), 350);
  });
  overlay.querySelector('.expanded-add-item').addEventListener('click', () => {
    history.back();
    setTimeout(() => openAddEventModal(dateKey), 350);
  });


  requestAnimationFrame(() => overlay.classList.add('open'));
}

function renderExpandedEvents(overlay, dateKey) {
  const list = overlay.querySelector('#expandedEventList');
  if (!list) return;

  const events = getEventsForDate(state.data, dateKey);

  list.innerHTML = events.length === 0
    ? `<div class="expanded-empty">No entries yet. Tap "+ Add item" below.</div>`
    : events.map(evt => {
        const bell = evt.reminderMinutes != null
          ? `<span class="reminder-icon" title="${evt.reminderMinutes}min reminder">🔔</span>` : '';

        if (evt.type === 'todo') {
          return `
            <div class="expanded-todo-item ${evt.done ? 'expanded-todo-item--done' : ''}" data-id="${esc(evt.id)}">
              <button class="expanded-todo-check ${evt.done ? 'checked' : ''}"
                      data-check="${esc(evt.id)}" aria-label="${evt.done ? 'Mark incomplete' : 'Mark complete'}">
                ${evt.done ? '✓' : ''}
              </button>
              <span class="expanded-todo-label">${esc(evt.title)}</span>
              <div class="expanded-item-actions">
                ${bell}
                <button class="expanded-event-edit"   data-edit="${esc(evt.id)}"   aria-label="Edit">Edit</button>
                <button class="expanded-event-delete" data-delete="${esc(evt.id)}" aria-label="Delete">✕</button>
              </div>
            </div>`;
        }

        const time = evt.time
          ? `<div class="expanded-event-time">${esc(evt.time)}</div>` : '';
        return `
          <div class="expanded-event-item" data-id="${esc(evt.id)}">
            <div class="expanded-event-dot expanded-event-dot--${esc(evt.type)}"></div>
            <div class="expanded-event-content">
              <div class="expanded-event-title">${esc(evt.title)}</div>
              ${time}
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
      if (evt) {
        history.back();
        setTimeout(() => openAddEventModal(dateKey, evt), 350);
      }
    });
  });

  list.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      pushUndo(JSON.parse(JSON.stringify(state.data)));
      deleteEvent(state.data, dateKey, btn.dataset.delete);
      saveData();
      renderExpandedEvents(overlay, dateKey);
      refreshCardEvents(dateKey);
    });
  });

  list.querySelectorAll('[data-check]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      pushUndo(JSON.parse(JSON.stringify(state.data)));
      toggleTodo(state.data, dateKey, btn.dataset.check);
      saveData();
      renderExpandedEvents(overlay, dateKey);
      refreshCardEvents(dateKey);
    });
  });
}

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

function openAddEventModal(dateKey, existing = null) {
  closeAddEventModal();
  history.pushState({ chronicle: 'modal', modal: 'addEvent' }, '');

  const isEdit = !!existing;
  const type   = existing?.type  ?? 'event';
  const title  = existing?.title ?? '';
  const time   = existing?.time  ?? '';
  const notes  = existing?.notes ?? '';
  const reminder = existing?.reminderMinutes ?? '';

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
        <input class="field-input" id="evtTitle" type="text"
               placeholder="Entry title" value="${esc(title)}">
      </div>

      <div class="field-group">
        <label class="field-label">Type</label>
        <div class="segmented-control" id="typeControl">
          <div class="seg-btn ${type === 'event' ? 'active' : ''}" data-type="event">Event</div>
          <div class="seg-btn ${type === 'todo' ? 'active' : ''}" data-type="todo">Todo</div>
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

      <div class="field-group" id="reminderGroup">
        <label class="field-label" for="evtReminder">Reminder</label>
        <select class="field-input" id="evtReminder">
          <option value="">None</option>
          <option value="0" ${reminder === 0 ? 'selected' : ''}>At time of event</option>
          <option value="5" ${reminder === 5 ? 'selected' : ''}>5 minutes before</option>
          <option value="15" ${reminder === 15 ? 'selected' : ''}>15 minutes before</option>
          <option value="30" ${reminder === 30 ? 'selected' : ''}>30 minutes before</option>
          <option value="60" ${reminder === 60 ? 'selected' : ''}>1 hour before</option>
          <option value="1440" ${reminder === 1440 ? 'selected' : ''}>1 day before</option>
        </select>
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
    repeatSelect.dispatchEvent(new Event('change'));

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

  const updateReminderVisibility = t => {
    const rg = sheet.querySelector('#reminderGroup');
    if (rg) rg.style.display = t === 'todo' ? 'none' : '';
  };
  updateReminderVisibility(selectedType);

  sheet.querySelectorAll('.seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedType = btn.dataset.type;
      updateReminderVisibility(selectedType);
      sheet.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b === btn));
    });
  });

  sheet.querySelector('#sheetCancel').addEventListener('click', () => history.back());

  sheet.querySelector('#sheetSave').addEventListener('click', () => {
    const titleVal = sheet.querySelector('#evtTitle').value.trim();
    if (!titleVal) { sheet.querySelector('#evtTitle').focus(); return; }

    const dateVal = sheet.querySelector('#evtDate').value || dateKey;
    const timeVal = sheet.querySelector('#evtTime').value;
    const notesVal = sheet.querySelector('#evtNotes').value;
    const reminderRaw = sheet.querySelector('#evtReminder').value;
    const reminderVal = reminderRaw !== '' ? Number(reminderRaw) : null;

    pushUndo(JSON.parse(JSON.stringify(state.data)));

    // Build repeat rule
    let repeat = null;
    const freq = repeatSelect.value;

    if (freq !== '') {
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

    if (isEdit) {
      updateEvent(state.data, dateKey, existing.id, {
        title: titleVal,
        type: selectedType,
        time: timeVal || null,
        notes: notesVal,
        reminderMinutes: reminderVal,
        repeat
      });
    } else {
      addEvent(state.data, dateVal, {
        title: titleVal,
        type: selectedType,
        time: timeVal || null,
        notes: notesVal,
        reminderMinutes: reminderVal,
        repeat
      });
    }

    saveData();
    refreshCardEvents(dateVal);
    closeAddEventModal();
  });

  sheet.addEventListener('focusin', e => {
    const t = e.target;
    if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') {
      setTimeout(() => t.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 300);
    }
  });

  requestAnimationFrame(() => sheet.classList.add('open'));
  setTimeout(() => sheet.querySelector('#evtTitle').focus(), 350);
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

  if (action === 'single') {
    // Override this one occurrence
    if (!series.exceptions) series.exceptions = {};
    series.exceptions[dateKey] = {
      ...evt,
      isOccurrence: true,
      seriesId: series.id,
      date: dateKey
      // no repeat field here – it’s just an occurrence override
    };
    saveData();
    refreshCardEvents(dateKey);
    return;
  }

  if (action === 'series') {
    // Edit the series master
    openAddEventModal(series.startDate, {
      id: series.id,
      type: series.type,
      title: series.title,
      time: series.time,
      notes: series.notes,
      reminderMinutes: series.reminderMinutes,
      repeat: series.repeat
    });
  }
}

function handleRepeatDelete(evt, dateKey, action) {
  const series = getSeriesForOccurrence(evt);
  if (!series) return;

  if (action === 'single') {
    // Mark this date as skipped
    if (!series.exceptions) series.exceptions = {};
    series.exceptions[dateKey] = null;
    saveData();
    refreshCardEvents(dateKey);
    return;
  }

  if (action === 'series') {
    // Remove the entire series
    state.data.series = state.data.series.filter(s => s.id !== series.id);
    saveData();
    refreshCardEvents(dateKey);
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
    case 'todo':     openAddEventModal(dateKey, { type: 'todo',     title: '', time: null, notes: '', done: false, reminderMinutes: null }); break;
    case 'reminder': openAddEventModal(dateKey, { type: 'reminder', title: '', time: null, notes: '', done: false, reminderMinutes: null }); break;
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

  const { theme, weekStart, notifications, gdrive, fyStartMonth = 3, fyStartDay = 6 } = state.data.settings;
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
    <div class="settings-section">
      <div class="settings-row" style="cursor:default">
        <span class="settings-label" style="color:var(--text-tertiary);font-size:10px;text-transform:uppercase;letter-spacing:0.06em">Coming soon</span>
      </div>
      <div class="settings-row"><span class="settings-label">Full-text search</span><span class="badge-soon">Soon</span></div>
      <div class="settings-row"><span class="settings-label">Google Photos</span><span class="badge-soon">Soon</span></div>
      <div class="settings-row"><span class="settings-label">iCal export</span><span class="badge-soon">Soon</span></div>
    </div>
  `;

  document.body.appendChild(backdrop);
  document.body.appendChild(dropdown);
  _settingsBackdrop = backdrop;
  _settingsDropdown = dropdown;

  dropdown.querySelectorAll('[data-theme]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.data.settings.theme = btn.dataset.theme;
      applyTheme(btn.dataset.theme);
      saveData();
      dropdown.querySelectorAll('[data-theme]').forEach(b => b.classList.toggle('active', b === btn));
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
    btn.addEventListener('click', () => {
      state.data.settings.notifications = btn.dataset.notif === 'on';
      saveData();
      dropdown.querySelectorAll('[data-notif]').forEach(b => b.classList.toggle('active', b === btn));
    });
  });

  dropdown.querySelectorAll('[data-gdrive]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.data.settings.gdrive.enabled = btn.dataset.gdrive === 'on';
      saveData();
      dropdown.querySelectorAll('[data-gdrive]').forEach(b => b.classList.toggle('active', b === btn));
    });
  });

  dropdown.querySelectorAll('[data-action]').forEach(row => {
    row.addEventListener('click', () => {
      const action = row.dataset.action;
      closeSettingsDropdown();
      handleSettingsAction(action);
    });
  });

  requestAnimationFrame(() => dropdown.classList.add('open'));
}

function handleSettingsAction(action) {
  switch (action) {
    case 'export': exportJSON(); break;

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
            if (!imported.days || !imported.settings) throw new Error();
            const replace = confirm('Replace all existing data? Press Cancel to merge instead.');
            if (replace) { state.data = imported; }
            else { Object.assign(state.data.days, imported.days); }
            saveData(); renderWeekGrid();
            showToast(STRINGS.importDone);
          } catch { showToast(STRINGS.invalidImport); }
          input.remove();
        };
        reader.readAsText(file);
      });
      break;
    }

    case 'clearall':
      if (confirm(STRINGS.confirmClearAll)) {
        state.data.days = {};
        saveData(); renderWeekGrid();
        showToast('All data cleared');
      }
      break;

    case 'about': showToast(STRINGS.aboutText); break;
  }
}

function exportJSON() {
  const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `chronicle-export-${formatDate(new Date())}.json`;
  a.click(); URL.revokeObjectURL(url);
  showToast(STRINGS.exportDone);
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

  const items = [];
  Object.entries(state.data.days)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([dateKey, day]) => {
      (day.events ?? []).forEach(evt => {
        if (filter === 'all' || evt.type === filter) items.push({ dateKey, evt });
      });
    });

  if (items.length === 0) {
    list.innerHTML = `<div class="agenda-empty">No ${filter === 'all' ? '' : filter + ' '}entries yet.</div>`;
    return;
  }

  list.innerHTML = items.map(({ dateKey, evt }) => {
    const date    = parseDate(dateKey);
    const dateStr = date.toLocaleDateString('default', { weekday: 'short', day: 'numeric', month: 'short' });
    const doneClass = evt.done ? 'agenda-item__title--done' : '';
    return `
      <div class="agenda-item" data-date="${esc(dateKey)}" data-id="${esc(evt.id)}">
        <div class="agenda-item__dot agenda-item__dot--${esc(evt.type)}"></div>
        <div class="agenda-item__body">
          <div class="agenda-item__title ${doneClass}">${esc(evt.title)}</div>
          <div class="agenda-item__date">${esc(dateStr)}${evt.time ? ' · ' + esc(evt.time) : ''}</div>
        </div>
      </div>`;
  }).join('');

  list.querySelectorAll('.agenda-item').forEach(item => {
    item.addEventListener('click', () => {
      const openDetail = list.querySelector('.agenda-item-detail');
      const wasThis    = openDetail?.dataset.forId === item.dataset.id;
      openDetail?.remove();
      list.querySelectorAll('.agenda-item--active').forEach(i => i.classList.remove('agenda-item--active'));
      if (wasThis) return;

      item.classList.add('agenda-item--active');
      const { date: dateKey, id: evtId } = item.dataset;
      const evt = getEvents(state.data, dateKey).find(e => e.id === evtId);
      if (!evt) return;

      const detail = document.createElement('div');
      detail.className = 'agenda-item-detail';
      detail.dataset.forId = evtId;
      detail.innerHTML = `
        <div class="agenda-detail-title">${esc(evt.title)}</div>
        ${evt.time  ? `<div class="agenda-detail-meta">${esc(evt.time)}</div>` : ''}
        ${evt.notes ? `<div class="agenda-detail-meta">${esc(evt.notes)}</div>` : ''}
        <div class="agenda-detail-actions">
          <button class="agenda-detail-btn" data-action="goto">Go to day</button>
          <button class="agenda-detail-btn" data-action="edit">Edit</button>
          <button class="agenda-detail-btn agenda-detail-btn--danger" data-action="delete">Delete</button>
        </div>
      `;
      item.insertAdjacentElement('afterend', detail);

      detail.querySelector('[data-action="goto"]').addEventListener('click', () => {
        closeAgendaPanel();
        goToWeek(parseDate(dateKey));
      });
      detail.querySelector('[data-action="edit"]').addEventListener('click', () => {
        closeAgendaPanel();
        openAddEventModal(dateKey, evt);
      });
      detail.querySelector('[data-action="delete"]').addEventListener('click', () => {
        pushUndo(JSON.parse(JSON.stringify(state.data)));
        deleteEvent(state.data, dateKey, evtId);
        saveData();
        refreshCardEvents(dateKey);
        renderAgendaList(_agendaFilter);
      });
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
        const hay = (ev.title + ' ' + (ev.notes || '')).toLowerCase();
        if (hay.includes(q)) {
          out.push({
            dateKey,
            type: ev.type, // event | todo | reminder
            snippet: makeSnippet(ev.title + ' ' + (ev.notes || ''), q),
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
    case 'reminder': return 'Reminder';
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
    renderWeekGrid(); scheduleNextDayRefresh();
  }, tomorrow - now);
}

// ── Bootstrap ──────────────────────────────────────────────────────────────

function init() {
  history.replaceState({ chronicle: 'main' }, '');
  state.data  = loadData();
  state.today = new Date(); state.today.setHours(0, 0, 0, 0);
  state.currentWeekStart = getWeekStart(state.today, state.data.settings.weekStart);

  applyTheme(state.data.settings.theme);
  initFormatToolbar(); // global format toolbar singleton (Fix 4)

  registerDirtyCallback(dirty => {
    const badge = document.getElementById('syncBadge');
    if (badge) badge.hidden = !dirty;
  });

  renderWeekGrid();

  // ── Ribbon buttons ──
  document.getElementById('btnToday').addEventListener('click', goToToday);
  document.getElementById('btnJumpDate').addEventListener('click', openDatePicker);
  document.getElementById('btnSearch').addEventListener('click', openSearch);
  document.getElementById('btnAgenda').addEventListener('click', openAgendaPanel);
  document.getElementById('btnSync').addEventListener('click', () => showToast(STRINGS.syncSoon));
  document.getElementById('btnAdd').addEventListener('click', () => {
    openAddEventModal(_lastFocusedDate ?? formatDate(state.today));
  });
  document.getElementById('btnSettings').addEventListener('click', openSettingsDropdown);

  // ── Edge nav arrows ──
  document.getElementById('navPrevWeek').addEventListener('click', prevWeek);
  document.getElementById('navNextWeek').addEventListener('click', nextWeek);
  document.getElementById('navPrevMonth').addEventListener('click', prevMonth);
  document.getElementById('navNextMonth').addEventListener('click', nextMonth);

  // ── Agenda panel controls ──
  document.getElementById('btnAgendaClose').addEventListener('click', () => history.back());
  document.querySelectorAll('#agendaFilterBar .filter-pill').forEach(pill => {
    pill.addEventListener('click', () => renderAgendaList(pill.dataset.filter));
  });

  // ── Swipe + long-press on week grid ──
  const weekGrid = document.getElementById('weekGrid');
  initGestures(weekGrid, {
    onLongPress: dateKey => { _suppressNextCardClick = true; openQuickActions(dateKey); },
  });

  // ── Delegated: todo toggle ──
  weekGrid.addEventListener('click', e => {
    const item = e.target.closest('.todo-item[data-todo-id]');
    if (!item) return;
    e.stopPropagation();
    pushUndo(JSON.parse(JSON.stringify(state.data)));
    toggleTodo(state.data, item.dataset.date, item.dataset.todoId);
    saveData();
    refreshCardEvents(item.dataset.date);
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
      <div class="event-detail__title">${esc(evt.title)}</div>
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
      pushUndo(JSON.parse(JSON.stringify(state.data)));
      if (evt.isOccurrence && evt.seriesId) {
        openRepeatActionSheet(evt, dateKey, 'delete');
      } else {
        deleteEventOccurrenceOrSeries(evt, dateKey);
        saveData();
        refreshCardEvents(dateKey);
      }
    });
  });

  // ── History API — back button / swipe-back closes any open overlay ──
  window.addEventListener('popstate', () => {
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
    const onVVResize = () => {
      const offset = Math.max(0, window.innerHeight - window.visualViewport.height);
      document.documentElement.style.setProperty('--keyboard-offset', `${offset}px`);
      document.querySelectorAll('.bottom-sheet.open').forEach(s => {
        s.style.maxHeight = offset > 0
          ? `${window.visualViewport.height}px`
          : '';
      });
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
  });

  scheduleNextDayRefresh();
}


document.addEventListener('DOMContentLoaded', init);
