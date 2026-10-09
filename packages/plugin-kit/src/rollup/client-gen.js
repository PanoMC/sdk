import fs from "node:fs";
import path from "node:path";

/**
 * Client generation hook run in the client build (doc 06 section 2.4).
 *
 * When the plugin repo has `api/openapi.json`, runs the `pano-client generate` engine into `<root>/client/`
 * (index.js, types.js, operations.js, openapi.json) and writes `client/package.json` only when it is missing
 * (name `pano-client-<ns>`). No snapshot: does nothing. Output is deterministic and rewritten only when it
 * changed.
 *
 * @param {{ pluginId: string, namespace: string, root?: string, outDir?: string, side?: string }} options
 *   `root`: plugin root (default `process.cwd()`); `outDir`: the client folder (default `<root>/client`)
 * @returns {import('rollup').Plugin}
 */
export function panoClientGen(options) {
  let done = false;

  return {
    name: "pano-client-gen",
    async buildStart() {
      if (done) return;
      done = true;

      const root = path.resolve(options.root ?? process.cwd());
      const input = path.join(root, "api", "openapi.json");

      if (!fs.existsSync(input)) return;

      const out = path.resolve(root, "client");
      const { generateClient } = await loadGenerator();
      const gen = generateClient(fs.readFileSync(input, "utf8"));

      for (const warning of gen.warnings) this.warn(`[pano-plugin] client: ${warning}`);

      for (const [name, content] of Object.entries(gen.files)) writeIfChanged(path.join(out, name), content);

      const manifest = path.join(out, "package.json");

      if (!fs.existsSync(manifest)) {
        const pkg = {
          name: `pano-client-${options.namespace}`,
          version: "0.0.0",
          private: true,
          type: "module",
          description: `Generated Pano API client of the ${options.pluginId} plugin.`,
          exports: { ".": "./index.js", "./types": "./types.js", "./operations": "./operations.js", "./openapi.json": "./openapi.json" },
          files: ["*.js", "openapi.json"],
        };

        fs.writeFileSync(manifest, JSON.stringify(pkg, null, 2) + "\n");
      }
    },
  };
}

/** @param {string} file @param {string} text */
function writeIfChanged(file, text) {
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === text) return;

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

/** The package when installed, the sibling workspace folder otherwise (kit checkout). */
async function loadGenerator() {
  try {
    return await import("@panomc/client-gen");
  } catch {
    return await import("../../../client-gen/src/index.js");
  }
}
