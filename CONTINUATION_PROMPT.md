Chronicle — diary + calendar PWA. Vanilla JS ES modules, HTML, CSS. Mobile-first.

Files:
index.html
js/: app.js, calendar.js, diary.js, events.js, gestures.js,
     holidays.js, ical.js, notifications.js, sync.js,
     themes.js, themeEditor.js, undo.js
css/: base.css, ribbon.css, week-view.css, day-card.css,
      expanded-day.css, modals.css, agenda.css, themes.css,
      responsive.css
assets/: icons.svg

Theme system:
data.settings stores uiTheme, uiThemeCustomVars, customUIThemes,
eventThemeOverrides, customEventThemes.
Always call applyUITheme() + injectEventThemeCSS() together.

Conventions:
ES modules, state in app.js, saveData() for persistence,
modals use history API, esc() for user content,
touch-first interactions, CSS variables everywhere.


Remaining Phase 2:
P2-GD Google Drive Backup
P2-7 Google Calendar Sync

Coding behaviour:
Use diff-only output.
No full file rewrites unless requested.
Keep answers short unless I ask for detail.

At session start, ask: “Which feature would you like to work on next?”


here is the code from my previous project that uses google drive sync

Auth + Init
let _tokenClient = null, _pendingSyncAfterAuth = false;

function initGoogleAuth(){
  const cid = getClientId();
  if(!cid){ Sync.setStatus('unsigned'); return; }

  if(typeof google === 'undefined' || !google.accounts){
    return;
  }

  _tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: cid,
    scope: GDRIVE_SCOPE,
    callback: (resp) => {
      if(resp.error){
        const silent = ['access_denied','popup_closed_by_user','immediate_failed'];
        if(silent.includes(resp.error)){
          Sync.setStatus('unsigned');
          return;
        }
        console.error('GIS:', resp);
        Sync.setStatus('error','☁ Auth error');
        return;
      }

      Sync.token = resp.access_token;

      const savedEmail = localStorage.getItem('shiftbook_userEmail');

      fetch('https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=' + resp.access_token)
        .then(r => r.json())
        .then(info => {
          const email = info.email || savedEmail || 'Signed in';
          localStorage.setItem('shiftbook_userEmail', email);
          localStorage.setItem('shiftbook_hasConsented', '1');
          Sync.setUser(email);
        })
        .catch(() => {
          Sync.setUser(savedEmail || 'Signed in');
        });

      if(_pendingSyncAfterAuth){
        _pendingSyncAfterAuth = false;
        syncNow();
      }
    },
  });

  const prevEmail = localStorage.getItem('shiftbook_userEmail');
  const hasConsented = localStorage.getItem('shiftbook_hasConsented');

  if(prevEmail && hasConsented){
    Sync.setUser(prevEmail);
    _tokenClient.requestAccessToken({prompt:'none'});
  } else {
    Sync.setStatus('unsigned');
  }
}

window._onGISLoad = function(){
  initGoogleAuth();
};


Sign In / Sign Out
function signIn(){
  if(!getClientId()){
    toast('Google Client ID not set — see app setup instructions');
    return;
  }

  if(!_tokenClient) initGoogleAuth();
  if(!_tokenClient){
    toast('Google auth not ready — check console for errors');
    return;
  }

  _tokenClient.requestAccessToken({prompt:''});
}

function signOut(){
  if(Sync.token)
    google.accounts.oauth2.revoke(Sync.token, () => {});

  Sync.token = null;
  Sync.fileId = null;

  localStorage.removeItem('shiftbook_userEmail');
  localStorage.removeItem('shiftbook_hasConsented');

  Sync.setUser(null);
  toast('Signed out of Google');
}
🌐 Drive API Helper
async function driveRequest(url, options = {}){
  if(!Sync.token) throw new Error('not_signed_in');

  const headers = {
    'Authorization': 'Bearer ' + Sync.token,
    ...(options.headers || {})
  };

  const resp = await fetch(url, { ...options, headers });

  if(resp.status === 401){
    Sync.token = null;
    Sync.setUser(null);
    throw new Error('auth_expired');
  }

  return resp;
}
📄 File Lookup
async function getDriveFileId(){
  if(Sync.fileId) return Sync.fileId;

  const url =
    `https://www.googleapis.com/drive/v3/files?spaces=${GDRIVE_FOLDER}` +
    `&q=name='${GDRIVE_FILE_NAME}'&fields=files(id,name,modifiedTime)`;

  const resp = await driveRequest(url);
  const data = await resp.json();

  if(data.files && data.files.length > 0){
    Sync.fileId = data.files[0].id;
    return Sync.fileId;
  }

  return null;
}
⬇️ Download from Drive
async function downloadFromDrive(){
  const fileId = await getDriveFileId();
  if(!fileId) return null;

  const resp = await driveRequest(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`
  );

  if(!resp.ok) return null;

  try {
    return JSON.parse(await resp.text());
  } catch {
    return null;
  }
}
⬆️ Upload to Drive
async function uploadToDrive(payload){
  const fileId = await getDriveFileId();

  const metadata = {
    name: GDRIVE_FILE_NAME,
    ...(fileId ? {} : { parents: [GDRIVE_FOLDER] })
  };

  const form = new FormData();

  form.append(
    'metadata',
    new Blob([JSON.stringify(metadata)], { type: 'application/json' })
  );

  form.append(
    'file',
    new Blob([payload], { type: 'application/json' })
  );

  const url = fileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;

  const resp = await driveRequest(url, {
    method: fileId ? 'PATCH' : 'POST',
    body: form
  });

  if(!resp.ok) throw new Error('upload_failed:' + resp.status);

  const result = await resp.json();
  Sync.fileId = result.id;

  return result;
}
📦 Payload Builder
function buildDrivePayload(){
  return JSON.stringify({
    ...S,
    version: DATA_VERSION,
    lastModified: new Date().toISOString(),
    deviceId: getDeviceId()
  });
}
🔄 Main Sync Engine
async function syncNow(){
  if(!getClientId()){
    toast('Google Client ID not configured — see setup instructions');
    return;
  }

  if(!Sync.token){
    _pendingSyncAfterAuth = true;

    const hasConsented = localStorage.getItem('shiftbook_hasConsented');

    if(hasConsented && _tokenClient){
      _tokenClient.requestAccessToken({prompt:'none'});
    } else {
      signIn();
    }
    return;
  }

  Sync.setStatus('syncing');

  try {
    const driveData = await downloadFromDrive();

    if(!driveData){
      await uploadToDrive(buildDrivePayload());
      S._lastModified = new Date().toISOString();
      persist();
      _markSynced();
      toast('Synced — Drive file created');
      return;
    }

    const dt = new Date(driveData.lastModified || 0).getTime();
    const lt = new Date(S._lastModified || 0).getTime();
    const THRESH = 2000;

    if(Math.abs(dt - lt) < THRESH){
      _markSynced();
      toast('Already up to date');
      return;
    }

    if(dt > lt + THRESH){
      showConflict(
        driveData,
        () => _applyDriveData(driveData),
        async () => {
          await uploadToDrive(buildDrivePayload());
          S._lastModified = new Date().toISOString();
          persist();
          _markSynced();
          toast('Local data pushed to Drive');
        }
      );

      Sync.setStatus('idle');
      return;
    }

    await uploadToDrive(buildDrivePayload());
    S._lastModified = new Date().toISOString();
    persist();

    _markSynced();
    toast('Synced — Drive updated');

  } catch(err){
    console.error('Sync:', err);

    if(err.message === 'auth_expired'){
      Sync.setStatus('unsigned');
      toast('Session expired — sign in again');
    }
    else if(!navigator.onLine){
      Sync.setStatus('error','☁ Offline');
      toast('No internet');
    }
    else {
      Sync.setStatus('error');
      toast('Sync error: ' + err.message);
    }

    updateSyncTimestamps(true);
  }
}
⚔️ Conflict Handling
function showConflict(driveData, onKeepDrive, onKeepLocal){
  document.getElementById('conflictLocalTime').textContent =
    new Date(S._lastModified || 0).toLocaleString('en-GB');

  document.getElementById('conflictCloudTime').textContent =
    new Date(driveData.lastModified || 0).toLocaleString('en-GB');

  document.getElementById('conflictMbg').classList.add('open');

  document.getElementById('conflictBtnCloud').onclick = () => {
    closeConflictModal();
    onKeepDrive();
  };

  document.getElementById('conflictBtnLocal').onclick = () => {
    closeConflictModal();
    onKeepLocal();
  };
}

function closeConflictModal(){
  document.getElementById('conflictMbg').classList.remove('open');
}
✅ Sync State Helpers
function _markSynced(){
  Sync.lastSynced = new Date().toISOString();
  localStorage.setItem('shiftbook_lastSynced', Sync.lastSynced);
  Sync.setStatus('synced');
  updateSyncTimestamps(false);
}

function refreshSyncButton(){
  if(typeof Sync === 'undefined' || !Sync.userEmail) return;
  Sync.setStatus(Sync.status);
}

function hasUnsyncedChanges(){
  if(!Sync.userEmail) return false;

  const lt = new Date(S._lastModified || 0).getTime();
  const st = new Date(Sync.lastSynced || 0).getTime();

  return lt > st + 2000;
}
🌙 Background Sync
async function syncBackground(){
  if(!Sync.token) return;

  if(!hasUnsyncedChanges() && !localStorage.getItem(SYNC_CONFLICT_KEY))
    return;

  const now = Date.now();
  if(now - _lastBgSync < BG_SYNC_THROTTLE_MS) return;

  _lastBgSync = now;

  try {
    const driveData = await downloadFromDrive();

    if(!driveData){
      await uploadToDrive(buildDrivePayload());
      S._lastModified = new Date().toISOString();
      persist();
      _markSynced();
      localStorage.removeItem(SYNC_CONFLICT_KEY);
      return;
    }

    const dt = new Date(driveData.lastModified || 0).getTime();
    const lt = new Date(S._lastModified || 0).getTime();
    const THRESH = 2000;

    if(Math.abs(dt - lt) < THRESH){
      _markSynced();
      localStorage.removeItem(SYNC_CONFLICT_KEY);
      return;
    }

    if(lt > dt + THRESH){
      await uploadToDrive(buildDrivePayload());
      S._lastModified = new Date().toISOString();
      persist();
      _markSynced();
      localStorage.removeItem(SYNC_CONFLICT_KEY);
      return;
    }

    localStorage.setItem(SYNC_CONFLICT_KEY, JSON.stringify({
      driveTime: driveData.lastModified,
      localTime: S._lastModified,
      flaggedAt: new Date().toISOString()
    }));

    renderAlerts();

  } catch(e){
    console.warn('Background sync failed:', e.message);
  }
}

-------------------------------------------


SMART CODE MODE (DEBUG ↔ DIFF ↔ INTERACTIVE FIX)
Claude must choose the correct mode automatically.

MODE SELECTION
Use DEBUG MODE if:

Errors, bugs, or unclear behaviour are mentioned

I ask “why”, “what’s wrong”, or “explain”

Use DIFF MODE if:

I explicitly request a fix/change AND it is clearly defined

Use INTERACTIVE FIX MODE if:

Multiple possible fixes exist

OR the fix could impact behaviour

OR uncertainty exists

Default → DEBUG MODE

DEBUG MODE (ROOT‑CAUSE FIRST)
When in DEBUG MODE, Claude MUST NOT output code or diffs.

ROOT CAUSE

Exact reason

Point to specific code

WHAT IS BROKEN

WHY IN THIS CODEBASE

FIX OPTIONS (NUMBERED)  
Each fix must include:

What it changes

Risk level (Low / Medium / High)

Scope (lines/functions affected)

End with:
“Reply with the fix number(s) to apply, or say ‘apply safest’.”

DEBUG MODE RULE:

No code, no diffs, no patches.

INTERACTIVE FIX MODE
Triggered when I reply with:

A number → apply ONLY that fix

Multiple numbers → apply them in order

“apply safest” → choose lowest‑risk fix

Then switch to DIFF MODE.

DIFF MODE (STRICT, LOCATION‑AWARE)
Claude MUST:

Output ONLY minimal diffs

NEVER rewrite full files

NEVER rewrite full functions

NEVER modify unrelated code

NEVER refactor unless explicitly requested

ALWAYS include:

File path

Function/block name

Line numbers (if snippet provided)

2–5 lines of context


