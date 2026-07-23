/**
 * Factory for the theme's server hooks. A theme's src/hooks.server.js becomes:
 *
 *   import { createThemeHooks } from "$pano/kit/hooks-server.js";
 *   import { internalLibsHash } from "$lib/internalLibs.js";
 *   import { runtimeShimsHash } from "$lib/runtimeShims.js";
 *   import * as licenseConstants from "$lib/server/license-constants.generated.js";
 *   export const { handle, handleError, handleFetch } = createThemeHooks({
 *     internalLibsHash,
 *     runtimeShimsHash,
 *     licenseConstants,
 *   });
 *
 * The generated per-theme artifacts (internalLibsHash, runtimeShimsHash, license
 * constants) are parameters because they are produced inside the theme repo at
 * build time; everything else lives here so a hooks fix ships to every theme as
 * a core version bump instead of a hand-applied patch.
 */
import {
  API_URL,
  COOKIE_PREFIX,
  CSRF_TOKEN_COOKIE_NAME,
  JWT_COOKIE_NAME,
  updateApiUrl,
  updatePanoWebsiteUrl,
} from "../lib/variables.js";
import { dev } from "$app/environment";
import { getCredentialsServerSide } from "../lib/services/auth.js";
import { createLicenseRuntime } from "./license-runtime.js";
import { RUNTIME_SPECIFIERS } from "./specifiers.js";

function stripModulePreload(linkHeader) {
  const parts = linkHeader
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  const kept = parts.filter((p) => !/;\s*rel="?modulepreload"?/i.test(p));

  return kept.length ? kept.join(", ") : null;
}

function getCookieWithHttpFallback(cookies, baseName) {
  return cookies.get(baseName) ?? cookies.get(`${baseName}_http`);
}

/** In production, skip logging common client/bot noise (wrong method, stray POST to non-action routes). */
function shouldSuppressServerErrorLog(error) {
  if (process.env.NODE_ENV !== "production") return false;
  if (error?.status === 405) return true;
  const msg = String(error?.message ?? "");
  if (msg.includes("No form actions exist")) return true;
  return false;
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
}

function renderLicenseBlocked(reason, message) {
  // Minimal HTML page; deliberately self-contained so the broken theme can't accidentally
  // serve its own (now-unlicensed) UI. The Pano host's renewal sweep will fall back to the
  // bundled vanilla theme on next sweep, but until then we surface the cause.
  const body =
    '<!doctype html><html lang="en"><head>' +
    '<meta charset="utf-8"><title>License required</title>' +
    '<meta name="robots" content="noindex">' +
    "<style>html,body{height:100%;margin:0;font-family:system-ui,sans-serif;color:#222;background:#f7f7f9}" +
    "main{display:flex;align-items:center;justify-content:center;height:100%;padding:2rem;text-align:center}" +
    "section{max-width:540px}h1{margin:.2em 0 .6em}code{background:#eee;padding:.1em .3em;border-radius:.2em}" +
    ".reason{color:#a00;font-weight:600}</style></head><body><main><section>" +
    "<h1>This premium theme is not licensed on this server.</h1>" +
    "<p>The Pano host did not provide a valid license token.</p>" +
    `<p>Reason: <span class="reason">${escapeHtml(reason)}</span>${message ? ` — ${escapeHtml(message)}` : ""}</p>` +
    "<p>Open the Pano panel and reconnect your panomc.com account, then re-activate this theme.</p>" +
    "</section></main></body></html>";
  return new Response(body, {
    status: 503,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

const IMPORT_MAP_PLACEHOLDER = "%pano_lib_import%";
const IMPORT_MAP_PLACEHOLDER_LEN = IMPORT_MAP_PLACEHOLDER.length;

/**
 * @param {object} opts
 * @param {string} opts.internalLibsHash  content hash from the generated $lib/internalLibs.js
 * @param {string} opts.runtimeShimsHash  content hash from the generated $lib/runtimeShims.js
 * @param {object} [opts.licenseConstants]  the generated license constants module (premium builds);
 *   pass the whole module namespace — free builds no-op automatically. Panel profile: omit.
 * @param {(html: string) => string} [opts.transformHtml]  optional extra page-chunk transform
 * @param {string} [opts.base]  URL prefix for /lib and /runtime shim URLs ("" for themes,
 *   "/panel" for panel-ui — must match kit.paths.base)
 * @param {(ctx: {event: any, locals: object, jwt: string|undefined, csrfToken: string|undefined,
 *   pathname: string}) => Promise<void>} [opts.resolveLocals]  profile-specific locals resolution.
 *   Default (theme profile): locals.user via getCredentialsServerSide guarded against /api and
 *   /auth paths. Panel passes its basicData-based resolver instead.
 * @param {(locals: object) => void} [opts.applyExtraEnv]  hook for profile-specific env vars
 *   (panel: PANO_WEBSITE_API_URL → updatePanoWebsiteApiUrl)
 * @param {boolean} [opts.suppressNoisyErrors]  prod-suppress 405/no-form-action logs (theme default)
 */
export function createThemeHooks({
  internalLibsHash,
  runtimeShimsHash,
  licenseConstants = null,
  transformHtml = null,
  base = "",
  resolveLocals = null,
  applyExtraEnv = null,
  suppressNoisyErrors = true,
}) {
  const license = createLicenseRuntime(licenseConstants);

  // Plugins' bare specifiers resolve to the tiny STABLE shim modules generated by
  // bin/generate-runtime-shims.js. Each shim re-exports the HOST bundle's own live
  // module instance from the registry populated by kit/hooks-client.js, so host pages
  // and plugins share one Svelte runtime and no second runtime copy is downloaded at
  // hydration. The shim URLs never change across deploys (stale cached HTML keeps
  // working); their CONTENT only changes when the svelte/sdk dependency is upgraded,
  // which the ?v=<runtimeShimsHash> query cache-busts — safe here, unlike the old
  // /lib?v= scheme, because a shim served for a stale ?v is still just a re-export of
  // whatever runtime the host page actually loaded, never a mismatched second bundle.
  // libBase (content-hashed, bin/bundle-internal-libs.js) still serves bootstrap.
  const libBase = `${base}/lib/${internalLibsHash}`;
  const runtimeShim = (file) => `${base}/runtime/${file}?v=${runtimeShimsHash}`;
  const importMapEntries = Object.entries(RUNTIME_SPECIFIERS)
    .map(([specifier, file]) => `      "${specifier}": "${runtimeShim(file)}"`)
    .join(",\n");
  const importMap = `
  <script type="importmap" crossorigin="anonymous">
  {
    "imports": {
${importMapEntries}
    }
  }
  </script>
  <script defer src="${libBase}/bootstrap/bootstrap.bundle.min.js"></script>`;

  // One-shot license verification at boot. For premium builds the Pano host sets
  // PANO_LICENSE_JWT before spawning bun; the runtime helper verifies the RS256 signature
  // + claim checks against the panomc.com public key embedded at build time. Free builds
  // no-op everything.
  //
  // `dev` is SvelteKit's COMPILE-TIME flag: true only under `vite dev`, false in
  // every production build (baked into the bundle — cannot be spoofed with
  // NODE_ENV at runtime). Premium authors can develop locally without a license;
  // shipped zips keep enforcing.
  const licenseEnforced = license.isPremiumBuild() && !dev;
  if (license.isPremiumBuild() && dev) {
    console.log(
      "[pano-license] dev server — premium license gate skipped (enforced in production builds)",
    );
  }

  let bootLicenseError = null;
  if (licenseEnforced) {
    try {
      license.verifyLicenseFromEnv();
      console.log("[pano-license] startup verification passed");
    } catch (e) {
      bootLicenseError =
        e instanceof license.LicenseError
          ? e
          : new license.LicenseError("unknown", String(e?.message ?? e));
      console.error(
        "[pano-license] startup verification FAILED:",
        bootLicenseError.message,
      );
    }
  }

  /** @type {import('@sveltejs/kit').Handle} */
  async function handle({
    event,
    event: {
      cookies,
      url: { pathname },
    },
    resolve,
  }) {
    // License gate: every request to a premium theme has to pass the cached check. Free
    // builds and `vite dev` short-circuit (licenseEnforced is compile-time false in dev).
    if (licenseEnforced) {
      if (bootLicenseError) {
        return renderLicenseBlocked(
          bootLicenseError.reason ?? "unknown",
          bootLicenseError.message,
        );
      }
      try {
        license.assertStillLicensed();
      } catch (e) {
        const reason =
          e instanceof license.LicenseError ? e.reason : "unknown";
        return renderLicenseBlocked(reason, e?.message);
      }
    }

    const locals = {};

    // noinspection JSUnresolvedReference
    const apiUrlEnv = process.env.API_URL;

    // noinspection JSUnresolvedReference
    const panoWebsiteUrlEnv = process.env.PANO_WEBSITE_URL;

    if (apiUrlEnv) {
      updateApiUrl(apiUrlEnv);
      locals.apiUrlEnv = apiUrlEnv;
    }

    if (panoWebsiteUrlEnv) {
      updatePanoWebsiteUrl(panoWebsiteUrlEnv);
      locals.panoWebsiteUrlEnv = panoWebsiteUrlEnv;
    }

    if (applyExtraEnv) {
      applyExtraEnv(locals);
    }

    const jwt = getCookieWithHttpFallback(
      cookies,
      COOKIE_PREFIX + JWT_COOKIE_NAME,
    );
    const csrfToken = getCookieWithHttpFallback(
      cookies,
      COOKIE_PREFIX + CSRF_TOKEN_COOKIE_NAME,
    );

    if (resolveLocals) {
      // Profile-specific (panel: /api/panel/basicData → locals.basicData/jwt).
      await resolveLocals({ event, locals, jwt, csrfToken, pathname });
    } else {
      locals.user =
        jwt &&
        csrfToken &&
        !pathname.startsWith("/api/") &&
        !pathname.startsWith("/auth/") &&
        (await getCredentialsServerSide(jwt));
    }

    locals.csrfToken = csrfToken;

    event.locals = locals;

    const response = await resolve(event, {
      transformPageChunk: ({ html }) => {
        const index = html.indexOf(IMPORT_MAP_PLACEHOLDER);
        let out = html;
        if (index !== -1) {
          out =
            html.substring(0, index) +
            importMap +
            html.substring(index + IMPORT_MAP_PLACEHOLDER_LEN);
        }
        return transformHtml ? transformHtml(out) : out;
      },
    });

    const ct = response.headers.get("content-type") || "";
    if (ct.includes("text/html")) {
      const link = response.headers.get("link");
      if (link) {
        const filtered = stripModulePreload(link);
        if (filtered) response.headers.set("link", filtered);
        else response.headers.delete("link");
      }
    }

    return response;
  }

  /** @type {import('@sveltejs/kit').HandleServerError} */
  function handleError({ error, event }) {
    if (!suppressNoisyErrors || !shouldSuppressServerErrorLog(error)) {
      console.log("!!! [GLOBAL ERROR EVENT]:", event.url.href);
      console.error("!!! [GLOBAL ERROR CONTENT]:", error);
    }
    return {
      message: "Internal Error",
      code: error?.code,
    };
  }

  /** @type {import("@sveltejs/kit").HandleFetch} */
  async function handleFetch({ event, request, fetch }) {
    // Rewrite relative /api/ requests to the backend URL during SSR.
    // Load functions use relative paths for consistent SSR↔CSR fetch dedup.
    if (request.url.startsWith(event.url.origin + "/api/")) {
      const apiPath =
        new URL(request.url).pathname + new URL(request.url).search;
      const backendUrl = API_URL.replace(/\/api\/?$/, "") + apiPath;
      request = new Request(backendUrl, request);
      request.headers.set("cookie", event.request.headers.get("cookie") || "");
      request.headers.set("Origin", API_URL);
    } else if (request.url.startsWith(API_URL)) {
      request.headers.set("cookie", event.request.headers.get("cookie") || "");
      request.headers.set("Origin", API_URL);
    }

    return fetch(request);
  }

  return { handle, handleError, handleFetch };
}
