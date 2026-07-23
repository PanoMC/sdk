#!/usr/bin/env node
/**
 * Pre-build step for Pano themes (all themes — premium or free).
 *
 * Behaviour:
 * - manifest.json's `premium: true` flag → fetch the panomc.com license verification
 *   public key (RS256, RSA-2048) and embed it into src/lib/server/license-constants.generated.js
 *   together with the theme's id and version. Required: build fails fast if the key cannot
 *   be resolved (silently building an unsigned "premium" theme would defeat DRM).
 * - manifest.json without `premium: true` (or `premium: false`) → write a stub that makes
 *   the runtime helper a no-op, so the same code path is valid for free themes and dev.
 *
 * License-server selection (only matters for premium builds):
 *   1. PANO_LICENSE_PUBLIC_KEY=<base64|PEM>          explicit key (CI secret); wins outright
 *   2. PANO_LICENSE_SERVER=prod|dev|<url>            explicit server (fetches key)
 *   3. Git branch auto-detect (when neither is set): `main`, `master`, `release-*` → prod;
 *      `dev`, `develop`, `staging`, `feat-*`, `fix-*`, `hotfix-*` → dev. The chosen server
 *      is logged so the operator knows where the embedded key came from.
 *   4. Nothing → premium build aborts. Free build proceeds normally.
 *
 * `bun run dev` does NOT run this script (no prebuild hook on `dev`), so a developer can
 * spin up a premium theme locally and it stays in the no-op state until the next
 * `bun run build`.
 *
 * Configure via env vars:
 *   PANO_LICENSE_SERVER       prod | dev | https://api.example.com
 *   PANO_LICENSE_PUBLIC_KEY   explicit base64 / PEM (CI secret); overrides server fetch
 *   PANO_LICENSE_REQUIRED     "true" / "false"; default = manifest.premium
 *   PANO_LICENSE_ISSUER       override the expected JWT iss (otherwise derived from server)
 */
import fs from "fs";
import path from "path";
import { execSync } from "node:child_process";

const ROOT = process.cwd();
const MANIFEST_FILE = path.join(ROOT, "manifest.json");
const PACKAGE_FILE = path.join(ROOT, "package.json");
const OUTPUT_FILE = path.join(ROOT, "src", "lib", "server", "license-constants.generated.js");

const PROD_URL = "https://api.panomc.com";
const DEV_URL = "https://api-dev.panomc.com";

function stripPemAndWhitespace(raw) {
  return raw
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
}

function resolveServerBaseUrl(server) {
  if (!server) return "";
  const norm = server.trim().toLowerCase();
  if (norm === "dev" || norm === "development" || norm === "staging") return DEV_URL;
  if (norm === "prod" || norm === "production") return PROD_URL;
  return server.trim().replace(/\/$/, "");
}

/**
 * Hostname of a URL with the leading "api." or "api-<label>." stripped, so a custom
 * license server URL maps to the JWT `iss` Pano host would compute via
 * com.panomc.platform.config.PanoConfig.resolvedLicenseJwtIssuer:
 *   https://api.example.com           → example.com
 *   https://api-dev.example.com       → dev.example.com
 *   http://localhost:8087             → localhost
 *   anything malformed/empty          → ""
 */
function hostnameForIssuer(url) {
  try {
    const u = new URL(url);
    const host = u.hostname;
    if (!host) return "";
    const apiPrefix = host.match(/^api\.(.+)$/);
    if (apiPrefix) return apiPrefix[1];
    const apiLabel = host.match(/^api-([^.]+)\.(.+)$/);
    if (apiLabel) return `${apiLabel[1]}.${apiLabel[2]}`;
    return host;
  } catch {
    return "";
  }
}

function issuerHintFor(server, baseUrl) {
  const norm = (server || "").trim().toLowerCase();
  if (norm === "dev" || norm === "development" || norm === "staging") return "dev.panomc.com";
  if (norm === "prod" || norm === "production") return "panomc.com";
  if (baseUrl === DEV_URL) return "dev.panomc.com";
  if (baseUrl === PROD_URL) return "panomc.com";
  // Custom URL: derive the hostname the same way the Pano host would, so a local
  // backend at http://localhost:8087 ends up with iss="localhost", matching what the
  // host stamps into the JWT.
  if (baseUrl) {
    const fromUrl = hostnameForIssuer(baseUrl);
    if (fromUrl) return fromUrl;
  }
  return "";
}

/**
 * Inspect the current git branch and map it to a license server. Returns null when:
 *   - we're not in a git repo (or git is missing)
 *   - HEAD is detached and no branch can be inferred
 *   - the branch name doesn't match any known pattern (caller decides what to do)
 */
function detectServerFromGitBranch() {
  let branch;
  try {
    // --abbrev-ref returns "HEAD" on detached HEADs. Caller treats null as "unknown".
    branch = execSync("git rev-parse --abbrev-ref HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
      cwd: ROOT,
    })
      .toString()
      .trim();
  } catch {
    return null;
  }
  if (!branch || branch === "HEAD") return null;
  const lower = branch.toLowerCase();

  if (
    lower === "main" ||
    lower === "master" ||
    lower === "prod" ||
    lower === "production" ||
    lower.startsWith("release/") ||
    lower.startsWith("release-") ||
    lower.startsWith("hotfix/main")
  ) {
    return { server: "prod", baseUrl: PROD_URL, branch };
  }

  if (
    lower === "dev" ||
    lower === "develop" ||
    lower === "development" ||
    lower === "staging" ||
    lower.startsWith("dev/") ||
    lower.startsWith("develop/") ||
    lower.startsWith("staging/") ||
    lower.startsWith("feature/") ||
    lower.startsWith("feat/") ||
    lower.startsWith("fix/") ||
    lower.startsWith("bugfix/") ||
    lower.startsWith("hotfix/") ||
    lower.startsWith("chore/") ||
    lower.startsWith("refactor/")
  ) {
    return { server: "dev", baseUrl: DEV_URL, branch };
  }

  return { server: null, baseUrl: null, branch };
}

/**
 * Resolves the final license server choice in priority order. Returns
 *   { source, baseUrl, serverKeyword, branch? }
 * where `source` is one of: "explicit-key", "explicit-server", "branch", "none".
 */
function resolveLicenseServerChoice() {
  const explicitKey = (process.env.PANO_LICENSE_PUBLIC_KEY || "").trim();
  if (explicitKey) {
    return { source: "explicit-key", baseUrl: null, serverKeyword: null };
  }

  const explicitServer = (process.env.PANO_LICENSE_SERVER || "").trim();
  if (explicitServer) {
    return {
      source: "explicit-server",
      serverKeyword: explicitServer,
      baseUrl: resolveServerBaseUrl(explicitServer),
    };
  }

  const detected = detectServerFromGitBranch();
  if (detected?.server) {
    return {
      source: "branch",
      serverKeyword: detected.server,
      baseUrl: detected.baseUrl,
      branch: detected.branch,
    };
  }

  return {
    source: "none",
    serverKeyword: null,
    baseUrl: null,
    branch: detected?.branch ?? null,
  };
}

async function fetchPublicKeyFromServer(baseUrl) {
  const url = `${baseUrl}/platform/api/licenses/public-key`;
  console.log(`[pano-license] Fetching license public key from ${url}...`);
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(
      `License key fetch failed: ${response.status} ${response.statusText} — ` +
      `bring the license server up, drop PANO_LICENSE_SERVER (builds the theme as FREE), ` +
      `or set PANO_LICENSE_PUBLIC_KEY=<base64> manually.`
    );
  }
  const payload = await response.json();
  // The endpoint exposes the key at the root level, but some panomc gateways wrap success
  // responses as { result: "ok", data: { ... } }. Handle both shapes.
  const body = payload?.data ?? payload;
  const key = body?.publicKeyBase64 || body?.publicKey;
  if (!key || typeof key !== "string") {
    throw new Error(
      `License key response missing publicKeyBase64/publicKey: ${JSON.stringify(payload).slice(0, 200)}`
    );
  }
  return stripPemAndWhitespace(key);
}

async function fetchPublicKey(choice) {
  if (choice.source === "explicit-key") {
    return stripPemAndWhitespace(process.env.PANO_LICENSE_PUBLIC_KEY);
  }
  if (choice.baseUrl) {
    return fetchPublicKeyFromServer(choice.baseUrl);
  }
  return "";
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

async function main() {
  const manifest = readJson(MANIFEST_FILE);
  const pkg = readJson(PACKAGE_FILE);

  // Version resolution priority (the embedded constant MUST match the `ver` claim in the
  // JWT panomc.com mints for this build — otherwise the theme runtime refuses to serve):
  //   1. PANO_THEME_VERSION_OVERRIDE  — release workflow passes semantic-release's
  //      next-tag here (e.g. "1.0.0-dev.44"). Wins over everything because the manifest
  //      source still has the "v{version}" placeholder at this point in the pipeline.
  //   2. manifest.version with "{version}" substituted from package.json (local dev).
  // The leading "v" is always stripped so the constant matches ResourceVersion.tag on
  // the backend, which is stored without it.
  const overrideVersion = (process.env.PANO_THEME_VERSION_OVERRIDE || "").trim();
  const versionRaw = overrideVersion ||
    String(manifest.version || "").replace("{version}", pkg.version);
  const themeVersion = versionRaw.startsWith("v") ? versionRaw.slice(1) : versionRaw;

  const themeId = manifest.id;
  if (!themeId) throw new Error("manifest.json is missing an `id` field");
  if (!themeVersion) throw new Error("Could not resolve theme version from manifest/package.json");

  const requiredEnv = (process.env.PANO_LICENSE_REQUIRED ?? "").trim();
  const required = requiredEnv === ""
    ? Boolean(manifest.premium)
    : requiredEnv.toLowerCase() !== "false";

  let publicKey = "";
  let resolvedSource = "skipped-free-build";
  let resolvedServer = null;
  let detectedBranch = null;

  if (required) {
    const choice = resolveLicenseServerChoice();
    detectedBranch = choice.branch ?? null;

    if (choice.source === "none") {
      throw new Error(
        `Theme "${themeId}" is marked premium but the license server could not be resolved.\n` +
        `Tried: PANO_LICENSE_PUBLIC_KEY (unset), PANO_LICENSE_SERVER (unset), git branch ` +
        `auto-detect${detectedBranch ? ` (branch: "${detectedBranch}" did not match prod/dev patterns)` : " (no usable git branch)"}.\n` +
        `Fix: set PANO_LICENSE_SERVER=prod|dev|<url> or PANO_LICENSE_PUBLIC_KEY=<base64>, ` +
        `or build from a recognised branch (main/master/release-* → prod, dev/develop/feat-*/fix-* → dev).`
      );
    }

    publicKey = await fetchPublicKey(choice);
    if (!publicKey) {
      throw new Error(
        `Theme "${themeId}" is marked premium but the resolved server returned no key.`
      );
    }
    resolvedSource = choice.source;
    resolvedServer = choice.baseUrl || choice.serverKeyword || "(explicit key)";
  }

  // Derive expected issuer: explicit env > PANO_LICENSE_SERVER (set even when KEY is too)
  //   > branch detection > "". Build-time issuer hint is just a default; the Pano host
  // always sets PANO_LICENSE_ISSUER on the bun process from its own config, so this only
  // matters for theme runtimes that boot without the host env (e.g. local debugging).
  const explicitIssuer = (process.env.PANO_LICENSE_ISSUER || "").trim();
  const explicitServerForIssuer = (process.env.PANO_LICENSE_SERVER || "").trim();
  const issuerHint = explicitIssuer || (required
    ? (explicitServerForIssuer
        ? issuerHintFor(explicitServerForIssuer, resolveServerBaseUrl(explicitServerForIssuer))
        : (detectedBranch
            ? issuerHintFor("", resolvedSource === "branch" ? resolvedServer : null)
            : ""))
    : "");

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  // Generated file lives in src/lib/server/ so SvelteKit's adapter-node naturally bundles
  // it into build/ during `vite build`. Never imported from client code (lib/server is
  // server-only in SvelteKit).
  const body = `// AUTO-GENERATED by scripts/license/generate-license-constants.js — DO NOT EDIT.
// Regenerated on every \`bun run build\` (prebuild hook).
export const PANO_LICENSE_PUBLIC_KEY_BASE64 = ${JSON.stringify(publicKey)};
export const PANO_LICENSE_THEME_ID = ${JSON.stringify(themeId)};
export const PANO_LICENSE_THEME_VERSION = ${JSON.stringify(themeVersion)};
export const PANO_LICENSE_REQUIRED = ${required ? "true" : "false"};
export const PANO_LICENSE_ISSUER_HINT = ${JSON.stringify(issuerHint)};
`;
  fs.writeFileSync(OUTPUT_FILE, body);

  const sourceLabel = (() => {
    switch (resolvedSource) {
      case "explicit-key": return "explicit PANO_LICENSE_PUBLIC_KEY";
      case "explicit-server": return `explicit PANO_LICENSE_SERVER (${resolvedServer})`;
      case "branch": return `git branch auto-detect: "${detectedBranch}" → ${resolvedServer}`;
      case "skipped-free-build": return "free build — key not required";
      default: return resolvedSource;
    }
  })();

  console.log(
    `[pano-license] id=${themeId} version=${themeVersion} required=${required} ` +
    `keyEmbedded=${publicKey ? "yes" : "no"} issuerHint=${issuerHint || "(runtime-derived)"} ` +
    `source=${sourceLabel}`
  );
}

main().catch((err) => {
  console.error("[pano-license] generate-license-constants failed:", err.message || err);
  process.exit(1);
});
