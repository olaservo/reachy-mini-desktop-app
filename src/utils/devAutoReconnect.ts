/**
 * Dev-only helpers for the auto-reconnect convenience (drop with the dev
 * commits before opening the UI PR).
 *
 * The marker lives in sessionStorage on purpose: Chromium keeps sessionStorage
 * in the browser process, so it survives a renderer crash + Refresh, but a
 * fresh app launch starts a new session and sees nothing. That limits the
 * auto-connect to "this webview session was already connected", instead of
 * firing on every launch.
 */

const DEV_WAS_CONNECTED_KEY = 'reachy-mini-dev-was-connected';

export function markDevConnected(): void {
  try {
    sessionStorage.setItem(DEV_WAS_CONNECTED_KEY, '1');
  } catch {
    // sessionStorage might not be available
  }
}

export function clearDevConnected(): void {
  try {
    sessionStorage.removeItem(DEV_WAS_CONNECTED_KEY);
  } catch {
    // sessionStorage might not be available
  }
}

export function wasDevConnected(): boolean {
  try {
    return sessionStorage.getItem(DEV_WAS_CONNECTED_KEY) === '1';
  } catch {
    return false;
  }
}
