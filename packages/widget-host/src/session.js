// The session probe of doc 06 section 3.5: `GET <apiBase>/api/v1/auth/credentials`, run only when a widget needs a session.
// A failure is an anonymous visitor, never an error.
import { getClient } from './config.js';

const GUEST = Object.freeze({ user: null, csrfToken: null });

/** @type {{ user: object|null, csrfToken: string|null }} */
let current = GUEST;
/** @type {Promise<typeof current> | null} */
let probing = null;
let probed = false;
/** @type {Set<(s: typeof current) => void>} */
const listeners = new Set();

function publish(next) {
  current = next;
  for (const fn of [...listeners]) {
    try {
      fn(current);
    } catch (e) {
      console.error('[pano-widgets] session listener failed', e);
    }
  }
}

export function getSession() {
  return current;
}

/** @param {{ user?: object|null, csrfToken?: string|null }} session */
export function setSession(session) {
  probed = true;
  publish({ user: session?.user ?? null, csrfToken: session?.csrfToken ?? null });
}

/** First bind, login, logout. Not called with the current value on subscribe. */
export function onSession(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Runs the probe once per page (or again after `force`). */
export function ensureSession(force = false) {
  if (probed && !force) return Promise.resolve(current);
  if (probing) return probing;

  probing = (async () => {
    try {
      const result = await getClient().request({ method: 'GET', path: '/api/v1/auth/credentials', auth: 'none' });
      if (result.ok && result.data && typeof result.data === 'object') {
        const { csrfToken, result: _legacy, ...user } = result.data;
        setSession({ user, csrfToken: typeof csrfToken === 'string' ? csrfToken : null });
      } else {
        setSession(GUEST);
      }
    } catch {
      setSession(GUEST);
    } finally {
      probing = null;
    }
    return current;
  })();

  return probing;
}

export function resetSession() {
  current = GUEST;
  probed = false;
  probing = null;
  listeners.clear();
}
