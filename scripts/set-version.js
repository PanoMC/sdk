#!/usr/bin/env node
/**
 * Stamps the semantic-release version into both published packages before
 * `bun publish`. @panomc/sdk is version-locked to @panomc/theme-core: one
 * repo, one release train, two package names (sdk stays the frozen
 * plugin-facing facade).
 */
import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (!version) {
  console.error("usage: set-version.js <version>");
  process.exit(1);
}

for (const pkg of ["packages/theme-core/package.json", "packages/sdk/package.json"]) {
  const data = JSON.parse(readFileSync(pkg, "utf-8"));
  data.version = version;
  writeFileSync(pkg, JSON.stringify(data, null, 2) + "\n");
  console.log(`${data.name} → ${version}`);
}
