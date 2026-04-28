/** Chronicle — Google Drive Backup + Google Calendar Sync */

// ── Constants ─────────────────────────────────────────────────────────────────

const GDRIVE_SCOPE      = 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/drive.appdata email profile';
const CONSENTED_SCOPE_KEY = 'chronicle_consentedScope';
const GDRIVE_FILE   = 'chronicle-data.json';
let _clientId       = '683163650924-66qma24l7eiaum03bpr6281u5pq0uo0n.apps.googleusercontent.com';
const GCAL_BASE     = 'https://www.googleapis.com/calendar/v3';
const BG_THROTTLE   = 30_000;
const isNative      = !!window.Capacitor?.isNativePlatform();

// ── Module state ──────────────────────────────────────────────────────────────

let _tokenClient       = null;
let _pendingAfterAuth  = false;
let _lastBgSync        = 0;
let _tokenRefreshTimer = null;
let _dirtyCallback     = null;
let _statusCallback    = null;
let _toastCallback     = null;

// Tracks throttle for fullSync; separate from GDrive bgSync throttle
let _lastGCalSync    = 0;
let _gcalRetryTimer  = null;
let _gcalRetryCount  = 0;

export function resetGCalThrottle() {
  _lastGCalSync   = 0;
  _gcalRetryCount = 0;
  clearTimeout(_gcalRetryTimer);
  _gcalRetryTimer = null;
}

export const gdriveState = {
  token:          null,
  tokenExpiresAt: 0,
  fileId:         null,
  userEmail:      null,
};

// ── Dirty badge ───────────────────────────────────────────────────────────────

export function registerDirtyCallback(cb)  { _dirtyCallback  = cb; }
export function registerStatusCallback(cb) { _statusCallback = cb; }
export function registerToastCallback(cb)  { _toastCallback  = cb; }

export function markDirty() { _dirtyCallback?.(true); }
export function markClean() { _dirtyCallback?.(false); }

// ── Auth ──────────────────────────────────────────────────────────────────────

export function initGoogleAuth(clientId) {
  if (clientId) _clientId = clientId;
  if (!_clientId) return;

  if (isNative) {
    const prevEmail    = localStorage.getItem('chronicle_userEmail');
    const hasConsented = localStorage.getItem('chronicle_hasConsented');
    if (prevEmail && hasConsented) {
      gdriveState.userEmail = prevEmail;
      _statusCallback?.('signed', prevEmail);
    }
    return;
  }

  if (typeof google === 'undefined' || !google.accounts) return;

  _tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: _clientId,
    scope: GDRIVE_SCOPE,
    callback: async (resp) => {
      if (resp.error) {
        const silent = ['access_denied', 'popup_closed_by_user', 'immediate_failed'];
        if (!silent.includes(resp.error)) console.error('[Chronicle GIS]', resp);
        _statusCallback?.('unsigned', null);
        return;
      }

      gdriveState.token          = resp.access_token;
      gdriveState.tokenExpiresAt = Date.now() + (resp.expires_in ?? 3600) * 1000;

      // Re-request token 5 minutes before it expires
      clearTimeout(_tokenRefreshTimer);
      const refreshIn = Math.max(0, gdriveState.tokenExpiresAt - Date.now() - 5 * 60_000);
      _tokenRefreshTimer = setTimeout(() => {
        _tokenClient?.requestAccessToken({ prompt: 'none' });
      }, refreshIn);

      const saved = localStorage.getItem('chronicle_userEmail');
      try {
        const info  = await fetch(
          'https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=' + resp.access_token
        ).then(r => r.json());
        const email = info.email || saved || 'Signed in';
        localStorage.setItem('chronicle_userEmail',    email);
        localStorage.setItem('chronicle_hasConsented', '1');
        localStorage.setItem(CONSENTED_SCOPE_KEY,      GDRIVE_SCOPE);
        gdriveState.userEmail = email;
      } catch {
        gdriveState.userEmail = saved || 'Signed in';
      }

      _statusCallback?.('signed', gdriveState.userEmail);

      if (_pendingAfterAuth) {
        _pendingAfterAuth = false;
        _statusCallback?.('pending_sync');
      }
    },
  });

  const prevEmail      = localStorage.getItem('chronicle_userEmail');
  const hasConsented   = localStorage.getItem('chronicle_hasConsented');
  const consentedScope = localStorage.getItem(CONSENTED_SCOPE_KEY);
  const scopeUpgraded  = consentedScope !== GDRIVE_SCOPE;

  if (prevEmail && hasConsented && !scopeUpgraded) {
    gdriveState.userEmail = prevEmail;
    _statusCallback?.('signed', prevEmail);
    _tokenClient.requestAccessToken({ prompt: 'none' });
  } else if (prevEmail && hasConsented && scopeUpgraded) {
    // Scope changed — silent refresh can't grant new permissions; wait for user tap
    gdriveState.userEmail = prevEmail;
    _statusCallback?.('signed', prevEmail);
  }
}

export async function signIn() {
  if (!_clientId) { _statusCallback?.('needs_client_id'); return; }

  const isNative = !!(window.Capacitor &&
                      window.Capacitor.isNativePlatform &&
                      window.Capacitor.isNativePlatform());

  if (isNative) {
    try {
      const SocialLogin = window.Capacitor.Plugins.SocialLogin;
      await SocialLogin.initialize({ google: { webClientId: _clientId } });
      _toastCallback?.('Opening Google Sign-In…');
      const result = await SocialLogin.login({
        provider: 'google',
        options: {
          scopes: [
            'https://www.googleapis.com/auth/drive.appdata',
            'https://www.googleapis.com/auth/calendar',
            'email',
            'profile',
          ],
        },
      });
      const token = result?.result?.accessToken?.token;
      if (!token) throw new Error('No access token returned');
      await handleNativeToken(token, 3600);
      _toastCallback?.('Signed in successfully');
    } catch (err) {
      console.error('[Chronicle signIn native]', err);
      _toastCallback?.('Sign-in failed: ' + err.message);
    }
    return;
  }

  // Web flow — GIS popup
  if (!_tokenClient) initGoogleAuth();
  if (!_tokenClient) return;
  _tokenClient.requestAccessToken({ prompt: '' });
}

export function signOut() {
  if (gdriveState.token && !isNative) google.accounts.oauth2.revoke(gdriveState.token, () => {});
  clearTimeout(_tokenRefreshTimer);
  gdriveState.token          = null;
  gdriveState.tokenExpiresAt = 0;
  gdriveState.fileId         = null;
  gdriveState.userEmail      = null;
  localStorage.removeItem('chronicle_userEmail');
  localStorage.removeItem('chronicle_hasConsented');
  localStorage.removeItem(CONSENTED_SCOPE_KEY);
  _clearPersistedToken();
  _statusCallback?.('unsigned', null);
}

function _isNativePlatform() {
  return !!(window.Capacitor?.isNativePlatform?.());
}

async function _persistToken(token, expiresAt) {
  const Prefs = window.Capacitor?.Plugins?.Preferences;
  if (!Prefs) return;
  await Prefs.set({
    key:   'chronicle_auth_token',
    value: JSON.stringify({ token, expiresAt }),
  });
}

function _clearPersistedToken() {
  window.Capacitor?.Plugins?.Preferences?.remove({ key: 'chronicle_auth_token' });
}

export async function restoreToken() {
  if (!_isNativePlatform()) return false;
  try {
    const Prefs = window.Capacitor?.Plugins?.Preferences;
    if (!Prefs) return false;
    const result = await Prefs.get({ key: 'chronicle_auth_token' });
    if (!result.value) return false;
    const stored = JSON.parse(result.value);
    if (stored.expiresAt < Date.now() + 5 * 60_000) {
      _clearPersistedToken();
      return false;
    }
    const remaining = Math.floor((stored.expiresAt - Date.now()) / 1000);
    await handleNativeToken(stored.token, remaining);
    return true;
  } catch (e) {
    console.warn('restoreToken failed', e);
    return false;
  }
}

export async function handleNativeToken(accessToken, expiresIn = 3600) {
  gdriveState.token          = accessToken;
  gdriveState.tokenExpiresAt = Date.now() + expiresIn * 1000;

  if (_isNativePlatform()) {
    _persistToken(accessToken, gdriveState.tokenExpiresAt);
  }

  const saved = localStorage.getItem('chronicle_userEmail');
  try {
    const info  = await fetch(
      'https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=' + accessToken
    ).then(r => r.json());
    const email = info.email || saved || 'Signed in';
    localStorage.setItem('chronicle_userEmail',    email);
    localStorage.setItem('chronicle_hasConsented', '1');
    localStorage.setItem(CONSENTED_SCOPE_KEY,      GDRIVE_SCOPE);
    gdriveState.userEmail = email;
  } catch {
    gdriveState.userEmail = saved || 'Signed in';
  }

  _statusCallback?.('signed', gdriveState.userEmail);

  if (_pendingAfterAuth) {
    _pendingAfterAuth = false;
    _statusCallback?.('pending_sync');
  }
}


window._onGISLoad = function () { initGoogleAuth(); };

// ── Drive API ─────────────────────────────────────────────────────────────────

async function driveRequest(url, options = {}) {
  if (!gdriveState.token) throw new Error('not_signed_in');
  const resp = await fetch(url, {
    ...options,
    headers: { Authorization: 'Bearer ' + gdriveState.token, ...(options.headers || {}) },
  });
  if (resp.status === 401) {
    gdriveState.token = null;
    _clearPersistedToken();
    _toastCallback?.('Session expired — please sign in again');
    throw new Error('auth_expired');
  }
  return resp;
}

async function getFileId() {
  if (gdriveState.fileId) return gdriveState.fileId;
  const url = `https://www.googleapis.com/drive/v3/files` +
    `?spaces=appDataFolder&q=name=%27${GDRIVE_FILE}%27&fields=files(id,name,modifiedTime)`;
  const resp = await driveRequest(url);
  const data = await resp.json();
  if (data.files?.length) { gdriveState.fileId = data.files[0].id; }
  return gdriveState.fileId || null;
}

async function download() {
  const id = await getFileId();
  if (!id) return null;
  const resp = await driveRequest(
    `https://www.googleapis.com/drive/v3/files/${id}?alt=media`
  );
  if (!resp.ok) return null;
  try { return JSON.parse(await resp.text()); } catch { return null; }
}

async function upload(payload) {
  const id   = await getFileId();
  const meta = { name: GDRIVE_FILE, ...(!id ? { parents: ['appDataFolder'] } : {}) };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
  form.append('file',     new Blob([payload],              { type: 'application/json' }));
  const url  = id
    ? `https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=multipart`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;
  const resp = await driveRequest(url, { method: id ? 'PATCH' : 'POST', body: form });
  if (!resp.ok) throw new Error('upload_failed:' + resp.status);
  const result = await resp.json();
  gdriveState.fileId = result.id;
}

// ── Drive sync engine ─────────────────────────────────────────────────────────

export async function syncNow(data, persist, onConflict, showToast) {
  if (!_clientId) { showToast?.('Client ID not configured'); return; }
  if (!gdriveState.token) {
    _pendingAfterAuth = true;
    const hasConsented = localStorage.getItem('chronicle_hasConsented');
    if (hasConsented && _tokenClient) _tokenClient.requestAccessToken({ prompt: 'none' });
    else signIn();
    showToast?.('Signing in…');
    return;
  }

  _statusCallback?.('syncing');

  try {
    const driveData = await download();
    const ts        = new Date().toISOString();
    const payload   = JSON.stringify({ ...data, _lastModified: ts });

    if (!driveData) {
      await upload(payload);
      persist({ ...data, _lastModified: ts });
      _markSynced(showToast, 'Drive file created');
      return;
    }

    const dt     = new Date(driveData._lastModified || 0).getTime();
    const lt     = new Date(data._lastModified      || 0).getTime();
    const THRESH = 2000;

    if (Math.abs(dt - lt) < THRESH) { _markSynced(showToast, 'Already up to date'); return; }

    if (dt > lt + THRESH) {
      _statusCallback?.('idle');
      onConflict?.(
        driveData,
        () => { persist(driveData); _markSynced(showToast, 'Restored from Drive'); },
        async () => { await upload(payload); persist({ ...data, _lastModified: ts }); _markSynced(showToast, 'Local data pushed to Drive'); }
      );
      return;
    }

    await upload(payload);
    persist({ ...data, _lastModified: ts });
    _markSynced(showToast, 'Drive updated');

  } catch (err) {
    console.error('[Chronicle Sync]', err);
    if (err.message === 'auth_expired') {
      const hasConsented = localStorage.getItem('chronicle_hasConsented');
      if (hasConsented && _tokenClient) {
        _pendingAfterAuth = true;
        _tokenClient.requestAccessToken({ prompt: 'none' });
      } else {
        _statusCallback?.('unsigned');
        showToast?.('Session expired — sign in again');
      }
    }
    else if (!navigator.onLine) { _statusCallback?.('error'); showToast?.('No internet'); }
    else                        { _statusCallback?.('error'); showToast?.('Sync error: ' + err.message); }
  }
}

function _markSynced(showToast, msg) {
  markClean();
  _statusCallback?.('synced');
  showToast?.(msg);
}

export async function bgSync(data, persist, onConflict) {
  if (!gdriveState.token) return;
  if (!data.settings?.gdrive?.enabled) return;
  const lt  = new Date(data._lastModified            || 0).getTime();
  const st  = new Date(data.settings.gdrive.lastSync || 0).getTime();
  if (lt <= st + 2000) return;
  const now = Date.now();
  if (now - _lastBgSync < BG_THROTTLE) return;
  _lastBgSync = now;
  await syncNow(data, persist, onConflict, null);
}

// ── GCal API ──────────────────────────────────────────────────────────────────

async function gcalRequest(url, options = {}) {
  if (!gdriveState.token) throw new Error('not_signed_in');
  const resp = await fetch(url, {
    ...options,
    headers: { Authorization: 'Bearer ' + gdriveState.token, ...(options.headers || {}) },
  });
  if (resp.status === 401) {
    gdriveState.token = null;
    _clearPersistedToken();
    _toastCallback?.('Session expired — please sign in again');
    throw new Error('auth_expired');
  }
  if (resp.status === 403) throw new Error('access_denied');
  if (resp.status === 429) throw new Error('rate_limited');
  return resp;
}

async function ensureChronicleCalendar(data) {
  const settings = data.settings;
  if (settings.chronicleCalendarId) return settings.chronicleCalendarId;

  const resp = await gcalRequest(`${GCAL_BASE}/users/me/calendarList`);
  const list = await resp.json();
  const existing = list.items?.find(c => c.summary === 'Chronicle');

  if (existing) {
    settings.chronicleCalendarId = existing.id;
    return existing.id;
  }

  const createResp = await gcalRequest(`${GCAL_BASE}/calendars`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ summary: 'Chronicle' }),
  });
  const created = await createResp.json();
  settings.chronicleCalendarId = created.id;
  return created.id;
}

// ── GCal event mapping ────────────────────────────────────────────────────────

const _fmtDate = d =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const _genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// Reverse map from GCal day abbreviation to JS getDay() value
const _RRULE_DAYS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function _parseRRule(rruleArr) {
  if (!Array.isArray(rruleArr) || !rruleArr.length) return null;
  const raw = rruleArr[0].replace(/^RRULE:/i, '');
  const parts = {};
  raw.split(';').forEach(p => {
    const eq = p.indexOf('=');
    if (eq > 0) parts[p.slice(0, eq)] = p.slice(eq + 1);
  });
  const freq = (parts.FREQ || '').toLowerCase();
  if (!['daily', 'weekly', 'monthly', 'yearly'].includes(freq)) return null;
  const interval = Math.max(1, parseInt(parts.INTERVAL || '1', 10) || 1);
  let byWeekday = null;
  if (freq === 'weekly' && parts.BYDAY) {
    byWeekday = parts.BYDAY.split(',').map(d => _RRULE_DAYS[d.trim()]).filter(d => d !== undefined);
    if (!byWeekday.length) byWeekday = null;
  }
  let endType = 'never', endCount = null, endDate = null;
  if (parts.COUNT) {
    endType = 'after';
    endCount = parseInt(parts.COUNT, 10);
  } else if (parts.UNTIL) {
    endType = 'on';
    const u = parts.UNTIL;
    endDate = `${u.slice(0, 4)}-${u.slice(4, 6)}-${u.slice(6, 8)}`;
  }
  return { freq, interval, byWeekday, end: { type: endType, count: endCount, date: endDate } };
}

// Build a local datetime string one hour after dateStr+timeStr, no UTC conversion
function _localPlusOneHour(dateStr, timeStr) {
  const d = new Date(`${dateStr}T${timeStr}:00`);
  d.setHours(d.getHours() + 1);
  return `${_fmtDate(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:00`;
}

const _GCAL_DAYS = ['SU','MO','TU','WE','TH','FR','SA'];

function _buildRRule(repeat) {
  const { freq, interval, byWeekday, end } = repeat;
  let rule = `FREQ=${freq.toUpperCase()};INTERVAL=${interval}`;
  if (freq === 'weekly' && byWeekday?.length) {
    rule += `;BYDAY=${byWeekday.map(d => _GCAL_DAYS[d]).join(',')}`;
  }
  if (end?.type === 'after' && end.count) {
    rule += `;COUNT=${end.count}`;
  } else if (end?.type === 'on' && end.date) {
    const [y, m, d] = end.date.split('-').map(Number);
    const until = new Date(Date.UTC(y, m - 1, d, 23, 59, 59));
    rule += `;UNTIL=${until.toISOString().replace(/[-:.]/g, '').slice(0, 15)}Z`;
  }
  return `RRULE:${rule}`;
}

function buildGCalRecurringEvent(series, tz) {
  const [y, m, d] = series.startDate.split('-').map(Number);
  let start, end;
  if (series.time) {
    start = { dateTime: `${series.startDate}T${series.time}:00`, timeZone: tz };
    end   = { dateTime: _localPlusOneHour(series.startDate, series.time), timeZone: tz };
  } else {
    start = { date: series.startDate };
    end   = { date: _fmtDate(new Date(y, m - 1, d + 1)) };
  }
  const gcalEvt = {
    summary:    _plainText(series.title),
    start, end,
    recurrence: [_buildRRule(series.repeat)],
    extendedProperties: { private: { chronicleId: series.id, ...(series.theme ? { chronicleTheme: series.theme } : {}) } },
  };
  if (series.notes) gcalEvt.description = _plainText(series.notes);
  gcalEvt.reminders = series.reminderMinutes != null
    ? { useDefault: false, overrides: [{ method: 'popup', minutes: series.reminderMinutes }] }
    : { useDefault: false, overrides: [] };
  return gcalEvt;
}

function _plainText(html) {
  if (!html || !/<[a-z]/i.test(html)) return html || '';
  const el = document.createElement('div');
  el.innerHTML = html;
  return el.textContent || '';
}

function buildGCalEvent(evt, dateKey, tz) {
  const [y, m, d] = dateKey.split('-').map(Number);

  let start, end;
  if (evt.time) {
    start = { dateTime: `${dateKey}T${evt.time}:00`, timeZone: tz };
    if (evt.endTime) {
      end = { dateTime: `${dateKey}T${evt.endTime}:00`, timeZone: tz };
    } else {
      end = { dateTime: _localPlusOneHour(dateKey, evt.time), timeZone: tz };
    }
  } else {
    start = { date: dateKey };
    if (evt.endDate) {
      const [ey, em, ed] = evt.endDate.split('-').map(Number);
      end = { date: _fmtDate(new Date(ey, em - 1, ed + 1)) }; // GCal end is exclusive
    } else {
      end = { date: _fmtDate(new Date(y, m - 1, d + 1)) };
    }
  }

  const gcalEvt = {
    summary: _plainText(evt.title),
    start,
    end,
    extendedProperties: { private: { chronicleId: evt.id, ...(evt.theme ? { chronicleTheme: evt.theme } : {}) } },
  };

  if (evt.notes) gcalEvt.description = _plainText(evt.notes);
  gcalEvt.reminders = evt.reminderMinutes != null
    ? { useDefault: false, overrides: [{ method: 'popup', minutes: evt.reminderMinutes }] }
    : { useDefault: false, overrides: [] };

  return gcalEvt;
}

function parseGCalEvent(gcalEvt) {
  const isAllDay = !!gcalEvt.start?.date;
  // Use new Date() so getHours()/getMinutes() return local time regardless of
  // whether Google returned a UTC "Z" string or an offset string like "+01:00"
  let time = null;
  if (!isAllDay && gcalEvt.start?.dateTime) {
    const dt = new Date(gcalEvt.start.dateTime);
    time = `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
  }
  const popupReminder = gcalEvt.reminders?.overrides?.find(r => r.method === 'popup');

  // Extract endDate for multi-day events so it survives the syncFromGCal Object.assign
  let endDate = null;
  if (isAllDay && gcalEvt.end?.date) {
    // GCal all-day end is exclusive — subtract 1 day for Chronicle's inclusive end
    const d = new Date(gcalEvt.end.date + 'T00:00');
    d.setDate(d.getDate() - 1);
    const candidate = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    if (candidate > (gcalEvt.start?.date || '')) endDate = candidate;
  } else if (!isAllDay && gcalEvt.end?.dateTime) {
    // Use _fmtDate(new Date()) so midnight-crossing events get the correct local date
    const endDay   = _fmtDate(new Date(gcalEvt.end.dateTime));
    const startDay = _fmtDate(new Date(gcalEvt.start?.dateTime || 0));
    if (endDay > startDay) endDate = endDay;
  }

  // Recover endTime for same-day timed events
  let endTime = null;
  if (!isAllDay && gcalEvt.end?.dateTime) {
    const endDay   = _fmtDate(new Date(gcalEvt.end.dateTime));
    const startDay = _fmtDate(new Date(gcalEvt.start?.dateTime || 0));
    if (endDay === startDay) {
      const dt = new Date(gcalEvt.end.dateTime);
      endTime = `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
    }
  }

  const priv = gcalEvt.extendedProperties?.private || {};

  return {
    title:           gcalEvt.summary || '(no title)',
    time,
    endTime,
    endDate,
    notes:           gcalEvt.description || '',
    reminderMinutes: popupReminder?.minutes ?? null,
    theme:           priv.chronicleTheme || null,
    googleEventId:    gcalEvt.id,
    googleCalendarId: gcalEvt.organizer?.email || null,
    syncStatus:       'synced',
    lastSyncedAt:     gcalEvt.updated || new Date().toISOString(),
  };
}

function gcalEventDateKey(gcalEvt) {
  if (gcalEvt.start?.date)     return gcalEvt.start.date;
  if (gcalEvt.start?.dateTime) return _fmtDate(new Date(gcalEvt.start.dateTime));
  return null;
}

// ── GCal sync functions ───────────────────────────────────────────────────────

async function _fetchAllPages(baseUrl) {
  const items = [];
  let pageToken = null;
  do {
    const url    = pageToken ? `${baseUrl}&pageToken=${encodeURIComponent(pageToken)}` : baseUrl;
    const resp   = await gcalRequest(url);
    const result = await resp.json();
    if (result.items) items.push(...result.items);
    pageToken = result.nextPageToken || null;
  } while (pageToken);
  return items;
}

export async function syncToGCal(data) {
  if (!gdriveState.token) return;

  const chronicleCalId = await ensureChronicleCalendar(data);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  for (const [dateKey, day] of Object.entries(data.days || {})) {
    const events   = day.events || [];
    const toRemove = [];

    for (const evt of events) {
      if (evt.type === 'todo') continue;
      const status = evt.syncStatus;

      if (status === 'pending') {
        const gcalEvt = buildGCalEvent(evt, dateKey, tz);
        if (!evt.googleEventId) {
          try {
            const resp       = await gcalRequest(
              `${GCAL_BASE}/calendars/${encodeURIComponent(chronicleCalId)}/events`,
              { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(gcalEvt) }
            );
            const created        = await resp.json();
            evt.googleEventId    = created.id;
            evt.googleCalendarId = chronicleCalId;
            evt.syncStatus       = 'synced';
            evt.lastSyncedAt     = new Date().toISOString();
          } catch (err) {
            console.warn('[Chronicle GCal] insert failed:', evt.id, err.message);
          }
        } else {
          const calId = evt.googleCalendarId || chronicleCalId;
          try {
            const resp = await gcalRequest(
              `${GCAL_BASE}/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(evt.googleEventId)}`,
              { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(gcalEvt) }
            );
            if (resp.ok) {
              evt.syncStatus   = 'synced';
              evt.lastSyncedAt = new Date().toISOString();
            } else if (resp.status === 404 || resp.status === 410) {
              evt.googleEventId = null;
              evt.syncStatus    = 'pending';
            }
          } catch (err) {
            console.warn('[Chronicle GCal] patch failed:', evt.id, err.message);
          }
        }
      } else if (status === 'deleted') {
        if (evt.googleEventId) {
          const calId = evt.googleCalendarId || chronicleCalId;
          try {
            await gcalRequest(
              `${GCAL_BASE}/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(evt.googleEventId)}`,
              { method: 'DELETE' }
            );
          } catch (err) {
            console.warn('[Chronicle GCal] delete failed:', evt.id, err.message);
          }
        }
        toRemove.push(evt.id);
      }
    }

    if (toRemove.length) {
      day.events = events.filter(e => !toRemove.includes(e.id));
    }
  }

  // ── Recurring series ──────────────────────────────────────────────────────
  for (const series of (data.series || [])) {
    if (series.type === 'todo') continue;
    const status = series.syncStatus ?? 'pending';

    if (status === 'pending') {
      const gcalEvt = buildGCalRecurringEvent(series, tz);
      if (!series.googleEventId) {
        try {
          const resp    = await gcalRequest(
            `${GCAL_BASE}/calendars/${encodeURIComponent(chronicleCalId)}/events`,
            { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(gcalEvt) }
          );
          const created = await resp.json();
          series.googleEventId    = created.id;
          series.googleCalendarId = chronicleCalId;
          series.syncStatus       = 'synced';
          series.lastSyncedAt     = new Date().toISOString();
        } catch (err) {
          console.warn('[Chronicle GCal] recurring insert failed:', series.id, err.message);
        }
      } else {
        const calId = series.googleCalendarId || chronicleCalId;
        try {
          const resp = await gcalRequest(
            `${GCAL_BASE}/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(series.googleEventId)}`,
            { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(gcalEvt) }
          );
          if (resp.ok) {
            series.syncStatus   = 'synced';
            series.lastSyncedAt = new Date().toISOString();
          } else if (resp.status === 404 || resp.status === 410) {
            series.googleEventId = null;
            series.syncStatus    = 'pending';
          }
        } catch (err) {
          console.warn('[Chronicle GCal] recurring patch failed:', series.id, err.message);
        }
      }
    }
  }

  // ── Deleted recurring occurrences (exceptions where value = null) ─────────
  for (const series of (data.series || [])) {
    if (!series.googleEventId || !series.exceptions) continue;
    const calId = series.googleCalendarId || chronicleCalId;
    for (const [dateKey, exc] of Object.entries(series.exceptions)) {
      if (exc !== null) continue; // only null = deleted occurrence
      const [y, m, d] = dateKey.split('-').map(Number);
      const dayStart = new Date(y, m - 1, d, 0, 0, 0).toISOString();
      const dayEnd   = new Date(y, m - 1, d, 23, 59, 59).toISOString();
      try {
        const resp = await gcalRequest(
          `${GCAL_BASE}/calendars/${encodeURIComponent(calId)}/events/` +
          `${encodeURIComponent(series.googleEventId)}/instances` +
          `?timeMin=${encodeURIComponent(dayStart)}&timeMax=${encodeURIComponent(dayEnd)}&maxResults=1`
        );
        if (!resp.ok) continue;
        const { items } = await resp.json();
        const inst = items?.[0];
        if (!inst || inst.status === 'cancelled') continue; // already cancelled
        await gcalRequest(
          `${GCAL_BASE}/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(inst.id)}`,
          { method: 'DELETE' }
        );
      } catch (err) {
        console.warn('[Chronicle GCal] occurrence delete failed:', series.googleEventId, dateKey, err.message);
      }
    }
  }

  // ── Deleted series ────────────────────────────────────────────────────────
  const deletedSeries = data.deletedSeriesGCalIds || [];
  for (const { googleEventId, googleCalendarId } of deletedSeries) {
    const calId = googleCalendarId || chronicleCalId;
    try {
      await gcalRequest(
        `${GCAL_BASE}/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(googleEventId)}`,
        { method: 'DELETE' }
      );
    } catch (err) {
      console.warn('[Chronicle GCal] recurring delete failed:', googleEventId, err.message);
    }
  }
  if (deletedSeries.length) data.deletedSeriesGCalIds = [];

}

export async function syncFromGCal(data) {
  if (!gdriveState.token) return;

  const chronicleCalId = await ensureChronicleCalendar(data);
  const now     = new Date();
  const timeMin = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate()).toISOString();
  const timeMax = new Date(now.getFullYear(), now.getMonth() + 12, now.getDate()).toISOString();

  const baseUrl = `${GCAL_BASE}/calendars/${encodeURIComponent(chronicleCalId)}/events` +
    `?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}` +
    `&singleEvents=true&orderBy=startTime&maxResults=2500&showDeleted=true`;

  const items = await _fetchAllPages(baseUrl);

  // Build lookup: googleEventId → { dateKey, evt }
  const localByGCalId = {};
  for (const [dateKey, day] of Object.entries(data.days || {})) {
    for (const evt of (day.events || [])) {
      if (evt.googleEventId) localByGCalId[evt.googleEventId] = { dateKey, evt };
    }
  }

  // Build lookup: googleEventId → series (for recurring parent matching)
  const seriesByGCalId = {};
  for (const series of (data.series || [])) {
    if (series.googleEventId) seriesByGCalId[series.googleEventId] = series;
  }

  // Collect recurring parent IDs — split by whether they have any active instances
  const allParentIds    = new Set(); // every parent ID seen (active + cancelled instances)
  const activeParentIds = new Set(); // parents with at least one non-cancelled instance

  for (const gcalEvt of items) {
    if (gcalEvt.status === 'cancelled') {
      if (!gcalEvt.recurringEventId) {
        // Cancelled single event
        const local = localByGCalId[gcalEvt.id];
        if (local && local.evt.syncStatus !== 'deleted') {
          local.evt.syncStatus = 'deleted';
        }
      } else {
        allParentIds.add(gcalEvt.recurringEventId);
        // Propagate single cancelled occurrence to local series exceptions
        const knownSeries = seriesByGCalId[gcalEvt.recurringEventId];
        if (knownSeries) {
          const instDate = gcalEvt.originalStartTime?.date
            || (gcalEvt.originalStartTime?.dateTime ? _fmtDate(new Date(gcalEvt.originalStartTime.dateTime)) : null);
          if (instDate && knownSeries.exceptions?.[instDate] === undefined) {
            if (!knownSeries.exceptions) knownSeries.exceptions = {};
            knownSeries.exceptions[instDate] = null; // mark as deleted occurrence
          }
        }
      }
      continue;
    }

    // Skip individual recurring event instances — import only the parent series
    if (gcalEvt.recurringEventId) {
      allParentIds.add(gcalEvt.recurringEventId);
      activeParentIds.add(gcalEvt.recurringEventId);
      continue;
    }

    // Regular single event
    const local = localByGCalId[gcalEvt.id];
    if (local) {
      const gcalUpdated = new Date(gcalEvt.updated).getTime();
      const localSynced = new Date(local.evt.lastSyncedAt || 0).getTime();
      if (gcalUpdated > localSynced) {
        Object.assign(local.evt, parseGCalEvent(gcalEvt));
      }
    } else {
      const dateKey = gcalEventDateKey(gcalEvt);
      if (!dateKey) continue;
      if (!data.days[dateKey]) data.days[dateKey] = { diary: '', events: [], images: [] };
      data.days[dateKey].events.push({
        id:       'gcal_' + gcalEvt.id,
        type:     'event',
        done:     false,
        repeat:   null,
        theme:    null,
        created:  Date.now(),
        modified: Date.now(),
        ...parseGCalEvent(gcalEvt),
      });
    }
  }

  // Import recurring event parents as Chronicle series
  for (const parentId of allParentIds) {
    const knownSeries = seriesByGCalId[parentId];
    // Skip known series that still have active instances — nothing to do
    if (knownSeries && activeParentIds.has(parentId)) continue;

    try {
      const resp = await gcalRequest(
        `${GCAL_BASE}/calendars/${encodeURIComponent(chronicleCalId)}/events/${encodeURIComponent(parentId)}`
      );
      if (!resp.ok) {
        // Parent not found — delete local series if we have one
        if (knownSeries) data.series = data.series.filter(s => s.googleEventId !== parentId);
        continue;
      }
      const parentEvt = await resp.json();
      if (parentEvt.status === 'cancelled') {
        // Parent deleted in GCal — remove local series if we have one
        if (knownSeries) data.series = data.series.filter(s => s.googleEventId !== parentId);
        continue;
      }

      // Known series is confirmed still active — nothing more to do
      if (knownSeries) continue;

      const repeat = _parseRRule(parentEvt.recurrence);
      if (!repeat) continue;

      const isAllDay = !!parentEvt.start?.date;
      let time = null;
      if (!isAllDay && parentEvt.start?.dateTime) {
        const dt = new Date(parentEvt.start.dateTime);
        time = `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
      }
      const popupReminder = parentEvt.reminders?.overrides?.find(r => r.method === 'popup');
      const priv = parentEvt.extendedProperties?.private || {};

      // Check if this series was originally created by Chronicle (has chronicleId)
      const chronicleId = priv.chronicleId;
      const existingSeries = chronicleId ? data.series.find(s => s.id === chronicleId) : null;

      if (existingSeries) {
        existingSeries.googleEventId    = parentEvt.id;
        existingSeries.googleCalendarId = chronicleCalId;
        existingSeries.syncStatus       = 'synced';
        const gcalUpdated = new Date(parentEvt.updated).getTime();
        const localSynced = new Date(existingSeries.lastSyncedAt || 0).getTime();
        if (gcalUpdated > localSynced) {
          existingSeries.title           = parentEvt.summary || existingSeries.title;
          existingSeries.repeat          = repeat;
          existingSeries.time            = time;
          existingSeries.reminderMinutes = popupReminder?.minutes ?? null;
          existingSeries.theme           = priv.chronicleTheme || existingSeries.theme;
          existingSeries.notes           = parentEvt.description || existingSeries.notes;
          existingSeries.lastSyncedAt    = parentEvt.updated || new Date().toISOString();
        }
        seriesByGCalId[parentEvt.id] = existingSeries;
      } else {
        // Create a new Chronicle series from this GCal recurring parent event
        const startDate = parentEvt.start?.date || _fmtDate(new Date(parentEvt.start?.dateTime || 0));
        const newSeries = {
          id:              _genId(),
          type:            'event',
          title:           parentEvt.summary || '(no title)',
          time,
          startDate,
          repeat,
          notes:           parentEvt.description || '',
          reminderMinutes: popupReminder?.minutes ?? null,
          theme:           priv.chronicleTheme || null,
          exceptions:      {},
          created:         Date.now(),
          modified:        Date.now(),
          googleEventId:    parentEvt.id,
          googleCalendarId: chronicleCalId,
          syncStatus:       'synced',
          lastSyncedAt:     parentEvt.updated || new Date().toISOString(),
        };
        data.series.push(newSeries);
        seriesByGCalId[parentEvt.id] = newSeries;
      }
    } catch (err) {
      console.warn('[Chronicle GCal] fetch recurring parent failed:', parentId, err.message);
    }
  }
}

export async function pullReadOnlyCalendars(data) {
  if (!gdriveState.token) return;
  if (!data.readOnlyEvents) data.readOnlyEvents = {};

  const chronicleId = data.settings.chronicleCalendarId;
  const calendars = (data.settings.googleCalendars || []).filter(c => c.enabled && c.id !== chronicleId);
  if (!calendars.length) return;

  const now     = new Date();
  const timeMin = new Date(now.getFullYear(), now.getMonth() - 6, 1).toISOString();
  const timeMax = new Date(now.getFullYear(), now.getMonth() + 12, 31).toISOString();

  for (const cal of calendars) {
    try {
      const baseUrl = `${GCAL_BASE}/calendars/${encodeURIComponent(cal.id)}/events` +
        `?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}` +
        `&singleEvents=true&orderBy=startTime&maxResults=2500`;
      data.readOnlyEvents[cal.id] = await _fetchAllPages(baseUrl);
    } catch (err) {
      console.warn('[Chronicle GCal] read-only pull failed:', cal.id, err.message);
    }
  }
}

export async function fullSync(data, persist, showToast, onStart, onEnd) {
  if (!gdriveState.token) return;

  if (!navigator.onLine) {
    showToast?.('Offline');
    return;
  }

  const now = Date.now();
  if (now - _lastGCalSync < 30_000) return;
  _lastGCalSync = now;

  onStart?.();

  try {
    await syncToGCal(data);
    await syncFromGCal(data);
    await pullReadOnlyCalendars(data);
    persist(data);
    markClean();
    data.settings.lastFullSync = Date.now();
    _gcalRetryCount = 0;
    onEnd?.('success');
  } catch (err) {
    console.error('[Chronicle fullSync]', err);
    onEnd?.('error');

    _gcalRetryCount++;
    // Exponential backoff: 30s, 60s, 120s, 240s … capped at 5 min
    const retryDelay = Math.min(30_000 * Math.pow(2, _gcalRetryCount - 1), 300_000);

    if (err.message === 'auth_expired') {
      _gcalRetryCount = 0;
      _tokenClient?.requestAccessToken({ prompt: 'none' });
    } else if (err.message === 'access_denied') {
      _gcalRetryCount = 0;
      showToast?.('Calendar access denied — check permissions');
    } else if (err.message === 'rate_limited') {
      showToast?.(`Google Calendar rate limit — retrying in ${Math.round(retryDelay / 1000)}s`);
      clearTimeout(_gcalRetryTimer);
      _gcalRetryTimer = setTimeout(() => fullSync(data, persist, showToast, onStart, onEnd), retryDelay);
    } else if (!navigator.onLine) {
      showToast?.('Offline — will retry on reconnect');
    } else {
      showToast?.(`Sync error — retrying in ${Math.round(retryDelay / 1000)}s`);
      clearTimeout(_gcalRetryTimer);
      _gcalRetryTimer = setTimeout(() => fullSync(data, persist, showToast, onStart, onEnd), retryDelay);
    }
  }
}

export async function fetchCalendarList() {
  if (!gdriveState.token) return [];
  try {
    const resp   = await gcalRequest(`${GCAL_BASE}/users/me/calendarList?maxResults=100`);
    const result = await resp.json();
    return result.items || [];
  } catch { return []; }
}

// ── Android WebView bridge ────────────────────────────────────────────────────

export function scheduleNotification(title, time) {
  window.Chronicle?.scheduleNotification?.(title, time);
}
