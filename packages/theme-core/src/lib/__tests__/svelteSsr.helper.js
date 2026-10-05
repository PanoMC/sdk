import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

// svelte is a peer of the theme (not installed in this repo): use it from the repo, or from the
// vanilla-theme checkout next to it when present. Without any, SSR tests are skipped.
export function findSvelte() {
  for (const from of [import.meta.dir, join(import.meta.dir, "../../../../../../themes/vanilla-theme/package.json")]) {
    try {
      const req = createRequire(from);
      return join(req.resolve("svelte/package.json"), "..");
    } catch {
      // try the next location
    }
  }
  return null;
}

/**
 * Server-renders Svelte components.
 *
 * @param {object} args
 * @param {string} args.svelteDir  the svelte package directory (from findSvelte)
 * @param {Record<string, string>} args.components  specifier-or-name -> absolute .svelte path; the first entry is rendered
 * @param {Record<string, string>} [args.modules]  specifier -> JS source of a stub module the components import
 * @param {object} [args.props]
 * @returns {Promise<{ body: string, head: string }>}
 */
export async function renderSvelte({ svelteDir, components, modules = {}, props = {} }) {
  const compiler = await import(join(svelteDir, "src", "compiler", "index.js"));
  const dir = mkdtempSync(join(tmpdir(), "tc03-ssr-"));
  mkdirSync(join(dir, "node_modules"));
  symlinkSync(svelteDir, join(dir, "node_modules", "svelte"), "dir");

  // specifier -> temp file
  const files = new Map();
  let n = 0;
  for (const specifier of Object.keys(modules)) files.set(specifier, join(dir, `stub${n++}.mjs`));
  const names = Object.keys(components);
  for (const name of names) files.set(name, join(dir, `component${names.indexOf(name)}.mjs`));

  const rewrite = (code) => {
    let out = code;
    for (const [specifier, file] of files) {
      out = out.split(JSON.stringify(specifier)).join(JSON.stringify(file));
      out = out.split(`'${specifier}'`).join(JSON.stringify(file));
    }
    return out;
  };

  try {
    for (const [specifier, source] of Object.entries(modules)) writeFileSync(files.get(specifier), rewrite(source));
    for (const name of names) {
      const source = readFileSync(components[name], "utf-8");
      const { js } = compiler.compile(source, { generate: "server", filename: components[name].split("/").pop() });
      writeFileSync(files.get(name), rewrite(js.code));
    }

    const { default: Component } = await import(files.get(names[0]));
    const { render } = await import(join(dir, "node_modules", "svelte", "src", "server", "index.js"));
    const out = render(Component, { props });

    return { body: out.body, head: out.head };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
