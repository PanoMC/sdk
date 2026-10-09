#!/usr/bin/env node
/**
 * Stamps the semantic-release version into every published package before
 * `bun publish`. Every package is version-locked to @panomc/theme-core: one
 * repo, one release train, several package names. The one exception is
 * @panomc/sdk (the frozen plugin-facing facade), which has its own line:
 * its `sdkLine` key ("2.0.0") is the lowest version it may be published at,
 * so a release train still on 1.x publishes sdk as 2.0.0 (or 2.0.0-dev.N on
 * the dev channel, keeping the prerelease suffix) while the other packages
 * get the release version unchanged. Once the train reaches the line the
 * sdk follows it again.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const PACKAGES = ["theme-core", "sdk", "plugin-kit", "client", "client-gen", "widget-host"];

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

/** @param {string} version @returns {[number, number, number] | null} */
function core(version) {
  const m = SEMVER.exec(version);

  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** -1 / 0 / 1 for the numeric core of two versions (prerelease suffixes ignored). */
function compareCore(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;

  return 0;
}

/**
 * The version a package is published at.
 * @param {string} name  folder name under packages/
 * @param {string} release  the semantic-release version
 * @param {string | undefined} sdkLine  `sdkLine` of packages/sdk/package.json
 */
export function versionFor(name, release, sdkLine) {
  if (name !== "sdk" || !sdkLine) return release;

  const line = core(sdkLine);
  const now = core(release);

  if (!line) throw new Error(`sdkLine "${sdkLine}" is not a version`);
  if (!now) throw new Error(`"${release}" is not a version`);
  if (compareCore(now, line) >= 0) return release;

  const suffix = SEMVER.exec(release)?.[4] ?? "";

  return `${line.join(".")}${suffix}`;
}

function main() {
  const version = process.argv[2];

  if (!version) {
    console.error("usage: set-version.js <version>");
    process.exit(1);
  }

  const sdkLine = JSON.parse(readFileSync("packages/sdk/package.json", "utf-8")).sdkLine;

  for (const name of PACKAGES) {
    const file = `packages/${name}/package.json`;
    const data = JSON.parse(readFileSync(file, "utf-8"));

    data.version = versionFor(name, version, sdkLine);
    writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
    console.log(`${data.name} → ${data.version}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
