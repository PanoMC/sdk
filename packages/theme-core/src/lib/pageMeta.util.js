// Pure helpers for the page head metadata a load() may return as `meta` (spec 15 section 4.3).
// No framework imports: shared by <PageHead> and the unit tests. Every value that reaches the
// served HTML is validated here, because plugin pages are third-party code.

const DEFAULT_ORIGIN_BASE = "http://pano.invalid";
const MAX_DESCRIPTION = 300;
const MAX_IMAGE_ALT = 200;
const MAX_URL_LENGTH = 2048;
const MAX_JSON_LD = 16384;

const ROBOTS_TOKENS = [
  "index",
  "noindex",
  "follow",
  "nofollow",
  "noarchive",
  "nosnippet",
  "noimageindex",
];
const OG_TYPES = ["website", "article", "product"];
const REFERRER_POLICIES = ["no-referrer", "same-origin", "strict-origin-when-cross-origin"];

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function text(value, max) {
  if (typeof value !== "string") return null;

  const collapsed = value.replace(/\s+/g, " ").trim();
  if (!collapsed) return null;

  return collapsed.length > max ? collapsed.slice(0, max).trimEnd() : collapsed;
}

function hasUnsafeChars(value) {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code === 0x5c || code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * The site base: `siteInfo.websiteUrl` without trailing slash when it is an http(s) URL, else the
 * request origin.
 * @returns {{ base: string, origin: string }}
 */
function siteBase(siteInfo, url) {
  const configured = typeof siteInfo?.websiteUrl === "string" ? siteInfo.websiteUrl.trim() : "";

  if (configured) {
    try {
      const parsed = new URL(configured);

      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return { base: configured.replace(/\/+$/, ""), origin: parsed.origin };
      }
    } catch {
      // fall through to the request origin
    }
  }

  const origin = typeof url?.origin === "string" ? url.origin : "";

  return { base: origin, origin };
}

/**
 * A site-relative path (`/…`): not protocol-relative, no backslash / control characters, and still
 * a same-origin path after dot-segment normalisation. Same checks as `sanitizeReturnTo` minus the
 * auth-page guard.
 * @returns {string | null} the normalised `pathname + search`, or null
 */
function sitePath(value) {
  if (typeof value !== "string") return null;
  if (value.length < 1 || value.length > MAX_URL_LENGTH) return null;
  if (value[0] !== "/" || value[1] === "/" || value[1] === "\\") return null;
  if (hasUnsafeChars(value)) return null;

  let parsed;
  try {
    parsed = new URL(value, DEFAULT_ORIGIN_BASE);
  } catch {
    return null;
  }

  if (parsed.origin !== DEFAULT_ORIGIN_BASE) return null;

  const out = parsed.pathname + parsed.search;
  if (out[0] !== "/" || out[1] === "/" || out[1] === "\\" || out.includes("\\")) return null;

  return out;
}

function absoluteHttpUrl(value) {
  if (typeof value !== "string" || value.length > MAX_URL_LENGTH || hasUnsafeChars(value)) {
    return null;
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : null;
}

function normalizeImage(value, base) {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();

  if (/^https?:\/\//i.test(trimmed)) return absoluteHttpUrl(trimmed)?.href ?? null;

  const path = trimmed.startsWith("/") ? sitePath(trimmed) : null;

  return path && base ? base + path : null;
}

function normalizeCanonical(value, base, origin) {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();

  if (/^https?:\/\//i.test(trimmed)) {
    const parsed = absoluteHttpUrl(trimmed);
    if (!parsed || parsed.origin !== origin) return null;

    return parsed.origin + parsed.pathname + parsed.search;
  }

  const path = sitePath(trimmed);

  return path && base ? base + path : null;
}

function normalizeRobots(value) {
  if (typeof value !== "string") return null;

  const kept = [];
  for (const token of value.split(",")) {
    const normalized = token.trim().toLowerCase();
    if (ROBOTS_TOKENS.includes(normalized) && !kept.includes(normalized)) kept.push(normalized);
  }

  return kept.length ? kept.join(", ") : null;
}

/**
 * `JSON.stringify` the structured data and replace every `<` so the result can sit inside a
 * `<script>` element without ever containing `</script>`.
 * @returns {string | null}
 */
function serializeJsonLd(value) {
  const valid = Array.isArray(value)
    ? value.length > 0 && value.every(isRecord)
    : isRecord(value);
  if (!valid) return null;

  let json;
  try {
    json = JSON.stringify(value);
  } catch {
    return null;
  }
  if (typeof json !== "string") return null;

  json = json.replace(/</g, "\\u003c");

  return json.length > MAX_JSON_LD ? null : json;
}

/**
 * @param {unknown} meta the `meta` object a load() returned (anything else is treated as `{}`)
 * @param {{ siteInfo?: object, url?: URL | { origin?: string, pathname?: string }, title?: string }} context
 * @returns {{
 *   description: string | null, ogTitle: string | null, ogDescription: string | null,
 *   ogType: string, ogUrl: string | null, ogImage: string | null, ogImageAlt: string | null,
 *   siteName: string | null, twitterCard: string, canonical: string | null, robots: string | null,
 *   referrer: string | null, jsonLd: string | null
 * }}
 */
export function normalizePageMeta(meta, { siteInfo, url, title } = {}) {
  const input = isRecord(meta) ? meta : {};
  const { base, origin } = siteBase(siteInfo, url);

  const siteDescription = text(siteInfo?.websiteDescription, Infinity);
  const description = text(input.description, MAX_DESCRIPTION) ?? siteDescription;
  const siteName = text(siteInfo?.websiteName, Infinity);

  const ogTitle = text(input.title, Infinity) ?? text(title, Infinity) ?? siteName;
  const canonical = normalizeCanonical(input.canonical, base, origin);
  const pathname = typeof url?.pathname === "string" ? url.pathname : "";
  const ogImage = normalizeImage(input.image, base);

  return {
    description,
    ogTitle,
    ogDescription: description,
    ogType: OG_TYPES.includes(input.type) ? input.type : "website",
    ogUrl: canonical ?? (base ? base + pathname : null),
    ogImage,
    ogImageAlt: ogImage ? text(input.imageAlt, MAX_IMAGE_ALT) : null,
    siteName,
    twitterCard: ogImage ? "summary_large_image" : "summary",
    canonical,
    robots: normalizeRobots(input.robots),
    referrer: REFERRER_POLICIES.includes(input.referrer) ? input.referrer : null,
    jsonLd: serializeJsonLd(input.jsonLd),
  };
}
