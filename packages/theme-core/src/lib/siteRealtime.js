import { base } from '$app/paths';
import ApiUtil from '$pano/lib/api.util';

const listeners = new Set();
let ws;
let shouldReconnect = false;
let reconnectTimer;
/** Reconnect cadence: 1 second forever, until logout or auth-rejected. */
const RECONNECT_MS = 1000;
let wantSiteNotifications = false;

/**
 * If a brand new socket closes within this window without ever reaching OPEN, we treat
 * it as a rejected upgrade. The backend rejects unauthenticated upgrades with HTTP 401
 * before the socket has a chance to open, which the browser surfaces as a near-instant
 * onclose with code 1006.
 */
const FAST_FAILURE_THRESHOLD_MS = 300;
/**
 * After this many consecutive fast failures we run a single HTTP probe to find out if
 * the backend really considers us logged out (vs. just temporarily flapping). On a 401
 * we stop reconnecting altogether; any other outcome resets the counter and reconnects
 * keep going.
 */
const MAX_FAST_FAILURES = 3;

let consecutiveFastFailures = 0;
/**
 * Latched on a 401 probe response. Once latched, we stop trying until
 * setSiteNotificationsSubscription(true) is called again, which is the signal that the
 * consumer (NotificationContainer) re-armed us after a fresh login.
 */
let stoppedDueToAuth = false;

/** True while a ticket is being fetched, so a second `connect()` does not start a second socket. */
let connecting = false;

function isLive() {
  return !!ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING);
}

/** @param {string} ticket the single-use ticket of `POST /auth/ws-ticket` */
function buildWsUrl(ticket) {
  if (typeof window === 'undefined') return '';
  const withBase = `${base || ''}/api/v1/ws`.replace(/\/+/g, '/');
  const path = withBase.startsWith('/') ? withBase : `/${withBase}`;
  const u = new URL(path, window.location.origin);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.searchParams.set('ticket', ticket);
  return u.toString();
}

/**
 * A fresh ticket (single use, 30 seconds; doc 05 section 6): the socket is opened with `?ticket=` instead of
 * relying on an ambient cookie, so it also works for a page on another origin.
 * @returns {Promise<{ ticket: string } | { failure: 'network' | 'rejected' }>}
 */
async function fetchTicket() {
  let response;
  try {
    response = await ApiUtil.post({ path: '/auth/ws-ticket' });
  } catch {
    return { failure: 'network' };
  }
  if (response && typeof response.ticket === 'string' && response.ticket) {
    return { ticket: response.ticket };
  }
  return { failure: response?.error?.code === 'NETWORK_ERROR' || !response?.error ? 'network' : 'rejected' };
}

function buildAuthProbeUrl() {
  if (typeof window === 'undefined') return '';
  // Logged-in-only endpoint: returns 200 when the session is valid, 401 otherwise.
  // Cheap (small payload) and already used elsewhere by the notification UI.
  const withBase = `${base || ''}/api/v1/notifications/quick`.replace(/\/+/g, '/');
  const path = withBase.startsWith('/') ? withBase : `/${withBase}`;
  return new URL(path, window.location.origin).href;
}

function scheduleReconnect() {
  if (!shouldReconnect || typeof window === 'undefined') {
    return;
  }
  if (stoppedDueToAuth) {
    return;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
  }
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (shouldReconnect && wantSiteNotifications && !stoppedDueToAuth) {
      connect();
    }
  }, RECONNECT_MS);
}

function sendConfig() {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return;
  }
  ws.send(JSON.stringify({ subscribeNotifications: true }));
}

function emitRefresh() {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore */
    }
  });
}

async function probeAuthAndDecide() {
  if (typeof window === 'undefined') return;
  let httpStatus = 0;
  try {
    const r = await fetch(buildAuthProbeUrl(), {
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    });
    httpStatus = r.status;
  } catch {
    httpStatus = 0;
  }
  if (httpStatus === 401 || httpStatus === 403) {
    // Backend confirms we're logged out. Stop the reconnect loop until the next
    // explicit setSiteNotificationsSubscription(true) call (i.e. fresh login).
    stoppedDueToAuth = true;
    consecutiveFastFailures = 0;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    return;
  }
  // Anything else (network blip, 5xx, transient): give the next failure window its own
  // probing chance. The reconnect loop continues.
  consecutiveFastFailures = 0;
}

async function connect() {
  if (typeof window === 'undefined') {
    return;
  }
  if (stoppedDueToAuth || connecting) {
    return;
  }
  if (isLive()) {
    return;
  }
  shouldReconnect = true;
  connecting = true;
  let granted;
  try {
    granted = await fetchTicket();
  } finally {
    connecting = false;
  }
  // The subscription may have been switched off, or another connect() may have won, while the ticket was fetched.
  if (!shouldReconnect || !wantSiteNotifications || stoppedDueToAuth || isLive()) {
    return;
  }
  if (!('ticket' in granted)) {
    if (granted.failure === 'rejected') {
      // A refused ticket is most often "logged out": the same HTTP probe as for a rejected upgrade decides.
      await probeAuthAndDecide();
    }
    scheduleReconnect();
    return;
  }
  let attemptHasOpened = false;
  const startedAt = Date.now();
  try {
    ws = new WebSocket(buildWsUrl(granted.ticket));
  } catch {
    scheduleReconnect();
    return;
  }
  ws.onopen = () => {
    attemptHasOpened = true;
    consecutiveFastFailures = 0;
    sendConfig();
  };
  ws.onmessage = (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.type === 'ready') {
      sendConfig();
      return;
    }
    if (msg.type === 'notificationRefresh' || msg.type === 'panelNotificationRefresh') {
      emitRefresh();
    }
  };
  ws.onclose = () => {
    const wasOpen = attemptHasOpened;
    const ageMs = Date.now() - startedAt;
    ws = null;
    if (!shouldReconnect || !wantSiteNotifications) {
      return;
    }
    if (wasOpen) {
      // Healthy session that just dropped; treat the next series as a fresh attempt.
      consecutiveFastFailures = 0;
      scheduleReconnect();
      return;
    }
    // Never made it to OPEN. A near-instant close is the fingerprint of a rejected
    // HTTP upgrade (most often 401). Keep trying, but verify with a real HTTP probe
    // after a few in a row so we don't reconnect forever against a logged-out session.
    if (ageMs < FAST_FAILURE_THRESHOLD_MS) {
      consecutiveFastFailures++;
      if (consecutiveFastFailures >= MAX_FAST_FAILURES) {
        void probeAuthAndDecide();
      }
    } else {
      consecutiveFastFailures = 0;
    }
    scheduleReconnect();
  };
  ws.onerror = () => {
    /* reconnect via onclose */
  };
}

function updateConnection() {
  if (typeof window === 'undefined') {
    return;
  }
  if (wantSiteNotifications) {
    // A fresh subscribe is always allowed to start trying again, even if a previous
    // session latched stoppedDueToAuth — a new login wiped the auth state.
    stoppedDueToAuth = false;
    consecutiveFastFailures = 0;
    if (!ws || ws.readyState === WebSocket.CLOSED) {
      connect();
    } else if (ws.readyState === WebSocket.OPEN) {
      sendConfig();
    }
  } else {
    shouldReconnect = false;
    stoppedDueToAuth = false;
    consecutiveFastFailures = 0;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ws) {
      try {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        ws.close();
      } catch {
        /* ignore */
      }
      ws = null;
    }
  }
}

/**
 * Keep a WebSocket for the logged-in site session (nudges re-fetch of /api/v1/notifications/quick).
 *
 * The reconnect loop runs at [RECONNECT_MS] forever while active, until either:
 * - the consumer calls setSiteNotificationsSubscription(false) (logout / unmount), or
 * - the backend confirms we're logged out via a 401/403 on the auth probe.
 *
 * @param {boolean} active
 */
export function setSiteNotificationsSubscription(active) {
  wantSiteNotifications = !!active;
  updateConnection();
}

/**
 * @param {() => void} fn
 * @returns {() => void} unsubscribe
 */
export function onNotificationRefresh(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
