#!/usr/bin/env node
/**
 * Regenerates src/core/ from the platform's core OpenAPI snapshot (doc 06 section 2.4, Builds).
 *
 *   node scripts/generate-core.js [path/to/openapi-core.json]
 *
 * Default input: pano-web-platform/Pano/api/openapi-core.json next to this repo (umbrella layout), or
 * $PANO_OPENAPI_CORE. The result is committed; a second run changes nothing.
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateClient } from "../../client-gen/src/generate.js";
import { writeFiles } from "../../client-gen/src/pull.js";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "../src/core");
const defaultInput = resolve(here, "../../../../pano-web-platform/Pano/api/openapi-core.json");
const input = resolve(process.argv[2] ?? process.env.PANO_OPENAPI_CORE ?? defaultInput);

if (!existsSync(input)) {
  console.error(`generate-core: cannot read ${input}`);
  process.exit(1);
}

const gen = generateClient(readFileSync(input, "utf8"));
gen.warnings.forEach((w) => console.error(`warning: ${w}`));

// the folder is entirely generated: drop stale files so a removed output cannot linger
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
writeFiles(outDir, gen.files);
console.log(`generated ${gen.operations.length} operations in ${outDir}`);
