// Pure helpers for the login return URL (`/login?redirect=<site-relative target>`).
// No framework imports: this module is shared by the SvelteKit load functions, the login /
// register pages, `pano.auth` and the unit tests.

const BASE = "http://pano.invalid";
const MAX_LENGTH = 2048;

// The auth route set of `bin/sync.js`. A return target inside it would loop (or land on a page
// that bounces a logged-in visitor away), so it falls back instead.
const AUTH_PATHS = [
  "/login",
  "/register",
  "/reset-password",
  "/renew-password",
  "/activate",
  "/activate-new-email",
];

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isAuthPath(pathname) {
  // Check the raw and the decoded form: the router matches the decoded path, so `/%6Cogin` is `/login`.
  return [pathname, safeDecode(pathname)].some((candidate) => {
    const lower = candidate.toLowerCase();
    return AUTH_PATHS.some((p) => lower === p || lower.startsWith(`${p}/`));
  });
}

/**
 * @param {unknown} value
 * @param {string} [fallback]
 * @returns {string} a safe site-relative target, or `fallback`.
 */
export function sanitizeReturnTo(value, fallback = "/") {
  if (typeof value !== "string") return fallback;
  if (value.length < 1 || value.length > MAX_LENGTH) return fallback;
  if (value[0] !== "/") return fallback;
  if (value[1] === "/" || value[1] === "\\") return fallback;

  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code === 0x5c || code <= 0x1f || code === 0x7f) return fallback;
  }

  let parsed;
  try {
    parsed = new URL(value, BASE);
  } catch {
    return fallback;
  }

  if (parsed.origin !== BASE) return fallback;
  if (isAuthPath(parsed.pathname)) return fallback;

  // Dot-segment removal can create a leading `//` (`/.//evil.com` -> `//evil.com`), which the
  // browser reads as a protocol-relative URL: validate the normalised form too.
  const out = parsed.pathname + parsed.search + parsed.hash;
  if (out[0] !== "/" || out[1] === "/" || out[1] === "\\" || out.includes("\\")) return fallback;

  return out;
}

/**
 * @param {unknown} returnTo
 * @returns {string} `/login` or `/login?redirect=<encoded target>`
 */
export function buildLoginUrl(returnTo) {
  const safe = sanitizeReturnTo(returnTo);

  return safe === "/" ? "/login" : `/login?redirect=${encodeURIComponent(safe)}`;
}

/**
 * Reads `?redirect=` from a URL (a `URL`, a string, or anything with `searchParams`).
 * @param {URL | string | { searchParams?: URLSearchParams } | null | undefined} url
 * @param {string} [fallback]
 */
export function returnToFromUrl(url, fallback = "/") {
  if (url === null || url === undefined) return fallback;

  let params;
  try {
    if (typeof url === "string") {
      params = new URL(url, BASE).searchParams;
    } else if (url.searchParams) {
      params = url.searchParams;
    } else {
      return fallback;
    }
  } catch {
    return fallback;
  }

  return sanitizeReturnTo(params.get("redirect"), fallback);
}

/**
 * Where a guest on a `loginRequired` plugin page must be sent, or `null` when no redirect is due.
 * @param {{ loginRequired?: boolean } | null | undefined} registeredPage
 * @param {unknown} user the session user (falsy for a guest)
 * @param {{ pathname: string, search?: string }} url
 * @returns {string | null}
 */
export function loginRedirectFor(registeredPage, user, url) {
  if (registeredPage?.loginRequired && !user) {
    return buildLoginUrl(url.pathname + (url.search ?? ""));
  }

  return null;
}
