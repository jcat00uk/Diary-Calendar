/** Chronicle — Google Drive sync stub (structure only, no auth yet) */

let _dirtyCallback = null;

/** Register a callback that receives true/false for the unsynced badge */
export function registerDirtyCallback(cb) {
  _dirtyCallback = cb;
}

/** Mark local data as unsynced; shows amber badge on sync icon */
export function markDirty() {
  _dirtyCallback?.(true);
}

/** Clear the unsynced badge after a successful sync */
export function markClean() {
  _dirtyCallback?.(false);
}

/** Upload all local data to Google Drive appDataFolder — TODO: OAuth + Drive API v3 */
export async function syncToGDrive() {
  // TODO: implement Google OAuth 2.0 and Drive API v3 appDataFolder upload
  console.info('[Chronicle Sync] syncToGDrive: not yet implemented');
}

/** Download and merge data from Google Drive appDataFolder — TODO */
export async function syncFromGDrive() {
  // TODO: implement Google OAuth 2.0 and Drive API v3 appDataFolder download
  console.info('[Chronicle Sync] syncFromGDrive: not yet implemented');
}

/** Forward a notification request to the Android WebView bridge if present */
export function scheduleNotification(title, time) {
  if (typeof window.Chronicle?.scheduleNotification === 'function') {
    window.Chronicle.scheduleNotification(title, time);
  }
}
