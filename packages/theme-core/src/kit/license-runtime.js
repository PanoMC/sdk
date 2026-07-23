/**
 * Runtime license check for premium Pano themes.
 *
 * Mirrors the plugin-side {@link com.panomc.plugins.license.PluginLicenseClient} in shape:
 *   - load the panomc.com public key embedded at build time
 *   - read the RS256 JWT from the PANO_LICENSE_JWT env var the Pano host sets when it
 *     spawns the theme bun process
 *   - verify the signature locally and assert the claims (audience = theme id, version,
 *     issuer, expiry)
 *
 * The host has ALREADY verified those claims by the time it hands us the JWT (see
 * com.panomc.platform.license.LicenseManager.fetchAndCacheThemeLicense), but a forked /
 * patched host could feed back a forged token. Re-verifying with our own embedded
 * public key is the theme's actual security boundary; a cracker has to either tamper with
 * THIS theme version's bundle (which only breaks one version, the next release resets
 * everything because the public key, theme version and constants are embedded fresh) OR
 * forge a JWT (impossible without panomc.com's RSA private key).
 *
 * Free builds (PANO_LICENSE_REQUIRED=false) make every export here a no-op so the same
 * code path stays valid for development and free distribution.
 */
import { createHash, createPublicKey, createVerify } from "node:crypto";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";

/** Stable strings mirrored from com.panomc.platform.license.LicenseDeniedReason. */
export const LICENSE_REASONS = Object.freeze({
  NOT_CONNECTED: "not-connected",
  KEY_NOT_AVAILABLE: "key-not-available",
  SIGNATURE_INVALID: "signature-invalid",
  EXPIRED: "expired",
  AUDIENCE_MISMATCH: "audience-mismatch",
  VERSION_MISMATCH: "version-mismatch",
  MALFORMED_JWT: "malformed-jwt",
  FILE_TAMPERED: "file-tampered",
  UNKNOWN: "unknown",
});

export class LicenseError extends Error {
  constructor(reason, message) {
    super(`license-check-failed: ${reason}${message ? ` (${message})` : ""}`);
    this.reason = reason;
  }
}

export function createLicenseRuntime(licenseConstants) {
  const {
    PANO_LICENSE_PUBLIC_KEY_BASE64 = "",
    PANO_LICENSE_THEME_ID = "",
    PANO_LICENSE_THEME_VERSION = "",
    PANO_LICENSE_REQUIRED = false,
    PANO_LICENSE_ISSUER_HINT = "",
  } = licenseConstants || {};

  let cachedPublicKey = null;
  function loadPublicKey() {
    if (cachedPublicKey !== null) return cachedPublicKey;
    if (!PANO_LICENSE_PUBLIC_KEY_BASE64) return null;
    // Reassemble into PEM so node's crypto can ingest it. 64-char lines per X.509.
    const pem =
      "-----BEGIN PUBLIC KEY-----\n" +
      (PANO_LICENSE_PUBLIC_KEY_BASE64.match(/.{1,64}/g) || []).join("\n") +
      "\n-----END PUBLIC KEY-----\n";
    cachedPublicKey = createPublicKey(pem);
    return cachedPublicKey;
  }

  function base64UrlDecode(str) {
    const pad = "=".repeat((4 - (str.length % 4)) % 4);
    const b64 = (str + pad).replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(b64, "base64");
  }

  function decodeJwt(jwt) {
    const parts = jwt.split(".");
    if (parts.length !== 3) {
      throw new LicenseError(LICENSE_REASONS.MALFORMED_JWT, "JWT does not have 3 segments");
    }
    let header;
    let payload;
    try {
      header = JSON.parse(base64UrlDecode(parts[0]).toString("utf-8"));
      payload = JSON.parse(base64UrlDecode(parts[1]).toString("utf-8"));
    } catch (e) {
      throw new LicenseError(LICENSE_REASONS.MALFORMED_JWT, e.message);
    }
    const signature = base64UrlDecode(parts[2]);
    const signedData = Buffer.from(`${parts[0]}.${parts[1]}`, "utf-8");
    return { header, payload, signature, signedData };
  }

  /** Cached snapshot of the last successful verification; refreshed lazily on expiry. */
  let snapshot = null;

  /** True when this build was configured as premium AND a public key was embedded. */
  function isPremiumBuild() {
    return PANO_LICENSE_REQUIRED && !!PANO_LICENSE_PUBLIC_KEY_BASE64;
  }

  /** Theme identity baked in at build time. */
  function getEmbeddedThemeIdentity() {
    return {
      id: PANO_LICENSE_THEME_ID,
      version: PANO_LICENSE_THEME_VERSION,
      premium: PANO_LICENSE_REQUIRED,
    };
  }

  /**
   * Verifies the JWT in PANO_LICENSE_JWT (RS256 + claim checks) and caches the snapshot.
   * Throws [LicenseError] on any failure. No-op for free builds.
   */
  function verifyLicenseFromEnv() {
    if (!isPremiumBuild()) {
      snapshot = null;
      return null;
    }

    const publicKey = loadPublicKey();
    if (!publicKey) {
      throw new LicenseError(
        LICENSE_REASONS.KEY_NOT_AVAILABLE,
        "embedded panomc.com public key is missing or malformed"
      );
    }

    // JWT priority: <themeRoot>/.pano-license.jwt (refreshed by the Pano host every renewal
    // sweep) > PANO_LICENSE_JWT env (initial value at process start). The env var alone
    // would freeze at the launch-time JWT and expire after one TTL window even though the
    // host already has a fresh token in cache — see UIManager.writeThemeLicenseFile.
    const themeRootForJwt = locateThemeRoot();
    const jwt = readCurrentJwt(themeRootForJwt);
    if (!jwt) {
      throw new LicenseError(
        LICENSE_REASONS.NOT_CONNECTED,
        "Pano host did not pass PANO_LICENSE_JWT (premium themes require a connected panomc.com account)"
      );
    }

    const { header, payload, signature, signedData } = decodeJwt(jwt);
    if (header.alg !== "RS256") {
      throw new LicenseError(
        LICENSE_REASONS.SIGNATURE_INVALID,
        `unexpected JWT algorithm: ${header.alg}`
      );
    }

    let signatureOk = false;
    try {
      signatureOk = createVerify("RSA-SHA256").update(signedData).verify(publicKey, signature);
    } catch (e) {
      throw new LicenseError(LICENSE_REASONS.SIGNATURE_INVALID, e.message);
    }
    if (!signatureOk) {
      throw new LicenseError(
        LICENSE_REASONS.SIGNATURE_INVALID,
        "JWT signature failed verification (host may be tampered)"
      );
    }

    const expectedIssuer =
      (process.env.PANO_LICENSE_ISSUER || PANO_LICENSE_ISSUER_HINT || "panomc.com").trim();
    if (expectedIssuer && payload.iss !== expectedIssuer) {
      throw new LicenseError(
        LICENSE_REASONS.AUDIENCE_MISMATCH,
        `iss=${payload.iss}, expected ${expectedIssuer}`
      );
    }

    const audience = Array.isArray(payload.aud) ? payload.aud[0] : payload.aud;
    if (
      !audience ||
      String(audience).toLowerCase() !== String(PANO_LICENSE_THEME_ID).toLowerCase()
    ) {
      throw new LicenseError(
        LICENSE_REASONS.AUDIENCE_MISMATCH,
        `aud=${audience}, expected ${PANO_LICENSE_THEME_ID}`
      );
    }

    if (payload.ver !== PANO_LICENSE_THEME_VERSION) {
      throw new LicenseError(
        LICENSE_REASONS.VERSION_MISMATCH,
        `ver=${payload.ver}, expected ${PANO_LICENSE_THEME_VERSION}`
      );
    }

    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== "number" || payload.exp <= nowSec) {
      throw new LicenseError(LICENSE_REASONS.EXPIRED, `exp=${payload.exp} now=${nowSec}`);
    }

    // Self-verify file integrity. The Pano host already validates this when it starts the
    // bun process (see UIManager.startUI ↔ HashUtil.computeStableFileFingerprint), but a
    // forked/patched host could skip its own check. Reading the on-disk manifest here +
    // re-walking our own theme directory makes the theme refuse to serve when any of its
    // shipped files have been edited after install.
    //
    // The check is wrapped in a try-catch so a malformed/missing manifest is reported as
    // FILE_TAMPERED instead of bubbling a generic FS error (those are noisy and unhelpful).
    try {
      verifyFileFingerprint();
    } catch (e) {
      if (e instanceof LicenseError) throw e;
      throw new LicenseError(LICENSE_REASONS.FILE_TAMPERED, e?.message || String(e));
    }

    snapshot = {
      payload,
      expiresAtMs: payload.exp * 1000,
      audience,
      version: payload.ver,
    };
    return snapshot;
  }

  const DEFAULT_FINGERPRINT_EXCLUDE = new Set(["manifest.json", ".pano-license.jwt"]);
  const LICENSE_JWT_FILENAME = ".pano-license.jwt";

  /**
   * Reads the freshest JWT for this theme. Priority:
   *   1. <themeRoot>/.pano-license.jwt — host writes this on every renewal sweep so the bun
   *      process can pick up new tokens without restarting.
   *   2. process.env.PANO_LICENSE_JWT — the launch-time value, used as a fallback when the
   *      disk file is missing (e.g. first start of a theme installed by an older host).
   */
  function readCurrentJwt(themeRoot) {
    if (themeRoot) {
      try {
        const p = path.join(themeRoot, LICENSE_JWT_FILENAME);
        if (existsSync(p)) {
          const fromDisk = readFileSync(p, "utf8").trim();
          if (fromDisk) return fromDisk;
        }
      } catch {
        // fall through to env
      }
    }
    return (process.env.PANO_LICENSE_JWT || "").trim();
  }

  function sha256Hex(buffer) {
    return createHash("sha256").update(buffer).digest("hex");
  }

  function listFilesRecursive(dir) {
    const out = [];
    function walk(d) {
      let entries;
      try {
        entries = readdirSync(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile()) out.push(full);
      }
    }
    walk(dir);
    return out;
  }

  /**
   * Reimplementation of file-fingerprint.js#computeStableFileFingerprint. Kept inline here
   * so the runtime guard works without depending on any extra source files that an attacker
   * could trivially remove from the build output.
   */
  function computeFileFingerprintOf(dir) {
    const items = listFilesRecursive(dir)
      .map((full) => ({
        rel: path.relative(dir, full).split(path.sep).join("/"),
        full,
      }))
      .filter((it) => !DEFAULT_FINGERPRINT_EXCLUDE.has(it.rel))
      .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
      .map((it) => `${it.rel}:${sha256Hex(readFileSync(it.full))}`);
    return sha256Hex(items.join("\n"));
  }

  /**
   * Locate the theme root by walking up from the running script until we find a
   * `manifest.json` with our theme id. We can't trust process.cwd() blindly because the
   * Pano host spawns bun from inside the theme folder but operators could run it via
   * arbitrary working directories during local debugging.
   */
  function locateThemeRoot() {
    const candidates = [process.cwd()];
    // `import.meta.url` resolves to .../build/server/chunks/<hash>.js after vite has bundled
    // this file. The theme root is "up" from there.
    try {
      const here = new URL(import.meta.url).pathname;
      let dir = path.dirname(here);
      for (let i = 0; i < 8; i++) {
        candidates.push(dir);
        dir = path.dirname(dir);
        if (dir === "/" || dir === ".") break;
      }
    } catch {
      // import.meta.url unavailable in some runtimes (older bun, jest, etc.) — fall back to
      // cwd-only.
    }
    for (const c of candidates) {
      const mf = path.join(c, "manifest.json");
      if (!existsSync(mf)) continue;
      try {
        const parsed = JSON.parse(readFileSync(mf, "utf-8"));
        if (parsed && parsed.id === PANO_LICENSE_THEME_ID) return c;
      } catch {
        // try the next candidate
      }
    }
    return null;
  }

  function verifyFileFingerprint() {
    const themeRoot = locateThemeRoot();
    if (!themeRoot) {
      throw new LicenseError(
        LICENSE_REASONS.FILE_TAMPERED,
        `could not locate theme root containing manifest.json for "${PANO_LICENSE_THEME_ID}"`
      );
    }
    const manifest = JSON.parse(readFileSync(path.join(themeRoot, "manifest.json"), "utf-8"));
    const expected = manifest.fileFingerprint;
    if (typeof expected !== "string" || expected.length !== 64) {
      throw new LicenseError(
        LICENSE_REASONS.FILE_TAMPERED,
        "manifest.json is missing or has malformed fileFingerprint (run a fresh build of the theme)"
      );
    }
    const actual = computeFileFingerprintOf(themeRoot);
    if (actual !== expected) {
      throw new LicenseError(
        LICENSE_REASONS.FILE_TAMPERED,
        `theme files have been modified after install: expected ${expected.slice(0, 12)}…, got ${actual.slice(0, 12)}…`
      );
    }
  }

  /** Re-verify proactively when the cached snapshot has less than this much time left. */
  const PRE_EXPIRY_REFRESH_MARGIN_MS = 5 * 60 * 1000;

  /**
   * Cheap runtime check intended for sprinkling across request handlers. Re-verifies a
   * few minutes BEFORE the cached snapshot expires so we pick up the JWT that the host
   * just wrote to <themeRoot>/.pano-license.jwt (the host's half-life renewal lands
   * roughly at expiresAt - 30 minutes for a 1h TTL, so 5 min before expiry the disk
   * file is always already refreshed).
   */
  function assertStillLicensed() {
    if (!isPremiumBuild()) return;
    if (!snapshot || snapshot.expiresAtMs <= Date.now() + PRE_EXPIRY_REFRESH_MARGIN_MS) {
      verifyLicenseFromEnv();
    }
  }

  /** Returns the current verified license snapshot or null. */
  function getLicenseSnapshot() {
    return snapshot;
  }

  return {
    LICENSE_REASONS,
    LicenseError,
    isPremiumBuild,
    getEmbeddedThemeIdentity,
    verifyLicenseFromEnv,
    assertStillLicensed,
    getLicenseSnapshot,
  };
}
