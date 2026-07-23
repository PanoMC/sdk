/**
 * Stable cumulative file fingerprint for a Pano theme.
 *
 * Algorithm (must stay bit-identical with the Kotlin port in
 * com.panomc.platform.util.HashUtil.computeStableFileFingerprint, or every Pano host
 * would refuse every theme):
 *
 *   1. walk the directory recursively, collecting regular files
 *   2. compute each file's path relative to the root, normalised to forward slashes
 *   3. drop any path in `excludeRelative` (`manifest.json` by default — it's where the
 *      expected fingerprint is stored, so it can't be part of its own input)
 *   4. for each remaining file, build the line `<relPath>:<hex sha256 of content>`
 *   5. sort lines by `<relPath>` using lexicographic byte order
 *   6. join with `\n`, SHA-256 the result, return hex
 *
 * This is intentionally insensitive to filesystem mtimes / inode order and resilient to
 * directory traversal order differences across platforms. The exclusion list is small and
 * fixed so the build + runtime + host all agree without coordination.
 *
 * Used in three places:
 *   - build-time vite plugin (writes the digest into manifest.json)
 *   - theme runtime (src/lib/server/license-runtime.js — defence-in-depth self-check)
 *   - Pano host (Kotlin, before starting a premium theme's bun process)
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

export const DEFAULT_EXCLUDED_FILES = Object.freeze([
  "manifest.json",
  // Written at runtime by the Pano host (UIManager.writeThemeLicenseFile) so the theme
  // runtime can pick up freshly-renewed JWTs without restarting the bun process. Must
  // be excluded or every renewal would invalidate the integrity check.
  ".pano-license.jwt",
]);

export function sha256Hex(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function listFilesRecursive(dir) {
  const out = [];
  function walk(d) {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        out.push(full);
      }
    }
  }
  walk(dir);
  return out;
}

export function computeStableFileFingerprint(dir, excludeRelative = DEFAULT_EXCLUDED_FILES) {
  const excludeSet = new Set(excludeRelative);
  const items = listFilesRecursive(dir)
    .map((full) => ({
      rel: relative(dir, full).split(sep).join("/"),
      full,
    }))
    .filter((it) => !excludeSet.has(it.rel))
    .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
    .map((it) => `${it.rel}:${sha256Hex(readFileSync(it.full))}`);
  return sha256Hex(items.join("\n"));
}
