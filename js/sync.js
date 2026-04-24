/** Chronicle — Google Drive Backup */

const GDRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const GDRIVE_FILE  = 'chronicle-data.json';
const CLIENT_ID    = '683163650924-66qma24l7eiaum03bpr6281u5pq0uo0n.apps.googleusercontent.com';
const BG_THROTTLE  = 30_000;

let _tokenClient      = null;
let _pendingAfterAuth = false;
let _lastBgSync       = 0;
let _dirtyCallback    = null;
let _statusCallback   = null;

export const gdriveState = {
  token:     null,
  fileId:    null,
  userEmail: null,
};

// ── Dirty badge ───────────────────────────────────────────────────────────────

export function registerDirtyCallback(cb)  { _dirtyCallback  = cb; }
export function registerStatusCallback(cb) { _statusCallback = cb; }

export function markDirty() { _dirtyCallback?.(true); }
export function markClean() { _dirtyCallback?.(false); }

// ── Auth ──────────────────────────────────────────────────────────────────────

export function initGoogleAuth() {
  if (!CLIENT_ID) return;
  if (typeof google === 'undefined' || !google.accounts) return;

  _tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: GDRIVE_SCOPE,
    callback: async (resp) => {
      if (resp.error) {
        const silent = ['access_denied', 'popup_closed_by_user', 'immediate_failed'];
        if (!silent.includes(resp.error)) console.error('[Chronicle GIS]', resp);
        _statusCallback?.('unsigned', null);
        return;
      }

      gdriveState.token = resp.access_token;

      const saved = localStorage.getItem('chronicle_userEmail');
      try {
        const info  = await fetch(
          'https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=' + resp.access_token
        ).then(r => r.json());
        const email = info.email || saved || 'Signed in';
        localStorage.setItem('chronicle_userEmail',      email);
        localStorage.setItem('chronicle_hasConsented',   '1');
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

  const prevEmail    = localStorage.getItem('chronicle_userEmail');
  const hasConsented = localStorage.getItem('chronicle_hasConsented');

  if (prevEmail && hasConsented) {
    gdriveState.userEmail = prevEmail;
    _statusCallback?.('signed', prevEmail);
    _tokenClient.requestAccessToken({ prompt: 'none' });
  }
}

export function signIn() {
  if (!CLIENT_ID) { _statusCallback?.('needs_client_id'); return; }
  if (!_tokenClient) initGoogleAuth();
  if (!_tokenClient) return;
  _tokenClient.requestAccessToken({ prompt: '' });
}

export function signOut() {
  if (gdriveState.token) google.accounts.oauth2.revoke(gdriveState.token, () => {});
  gdriveState.token     = null;
  gdriveState.fileId    = null;
  gdriveState.userEmail = null;
  localStorage.removeItem('chronicle_userEmail');
  localStorage.removeItem('chronicle_hasConsented');
  _statusCallback?.('unsigned', null);
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

// ── Sync engine ───────────────────────────────────────────────────────────────

export async function syncNow(data, persist, onConflict, showToast) {
  if (!CLIENT_ID) { showToast?.('Client ID not configured'); return; }
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
    if (err.message === 'auth_expired')  { _statusCallback?.('unsigned'); showToast?.('Session expired — sign in again'); }
    else if (!navigator.onLine)          { _statusCallback?.('error');    showToast?.('No internet'); }
    else                                 { _statusCallback?.('error');    showToast?.('Sync error: ' + err.message); }
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
  const lt  = new Date(data._lastModified              || 0).getTime();
  const st  = new Date(data.settings.gdrive.lastSync   || 0).getTime();
  if (lt <= st + 2000) return;
  const now = Date.now();
  if (now - _lastBgSync < BG_THROTTLE) return;
  _lastBgSync = now;
  await syncNow(data, persist, onConflict, null);
}

// ── Android WebView bridge ────────────────────────────────────────────────────

export function scheduleNotification(title, time) {
  window.Chronicle?.scheduleNotification?.(title, time);
}
