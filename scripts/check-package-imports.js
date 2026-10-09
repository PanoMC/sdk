#!/usr/bin/env node
/**
 * Fails when a file that ships in a package imports a bare package the package.json does not declare
 * (dependencies, peerDependencies, optionalDependencies, or the package itself). devDependencies do NOT
 * count: they are not installed for a consumer. Run by `bun run test` and by the release workflow.
 *
 * Usage: node scripts/check-package-imports.js [root]
 */
import { builtinModules } from "node:module";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCANNED = /\.(m?js|cjs|svelte)$/;
const TEST_FILE = /\.test\.js$/;
// `templates` dirs hold files that are COPIED into a user's project (their imports belong to that project).
const SKIP_DIRS = new Set(["node_modules", "__tests__", "__fixtures__", "test-fixtures", "templates", ".git"]);
const BUILTINS = new Set(builtinModules);

/** End index (exclusive) of the quoted string / template literal starting at `i`; nested templates in `${}` are skipped whole. */
function skipString(src, i) {
  const quote = src[i];
  let j = i + 1;

  while (j < src.length) {
    const c = src[j];

    if (c === "\\") j += 2;
    else if (c === quote) return j + 1;
    else if (quote !== "`" && c === "\n") return j; // an apostrophe in prose, not a string
    else if (quote === "`" && c === "$" && src[j + 1] === "{") {
      let depth = 1;

      j += 2;
      while (j < src.length && depth > 0) {
        if (src[j] === "{") depth++;
        else if (src[j] === "}") depth--;
        else if (src[j] === "'" || src[j] === '"' || src[j] === "`") {
          j = skipString(src, j);
          continue;
        }
        j++;
      }
    } else j++;
  }

  return j;
}

/**
 * Drops comments, and string literals that are not the module name of an import (a string that merely
 * CONTAINS import text, like a code generator's template, is not an import of this package).
 * @param {string} source @returns {string}
 */
function stripNoise(source) {
  let out = "";
  let i = 0;

  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];

    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i++;
    } else if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);

      i = end < 0 ? source.length : end + 2;
    } else if (c === "'" || c === '"' || c === "`") {
      const end = skipString(source, i);
      const text = source.slice(i, end);

      out += /(?:\bfrom|\bimport|\brequire\s*\(|\bimport\s*\()\s*$/.test(out.slice(-14)) && c !== "`" ? text : '""';
      i = end;
    } else out += source[i++];
  }

  return out;
}

/** The code of a file: the whole file for .js, the `<script>` blocks for .svelte. */
function codeOf(file, source) {
  if (!file.endsWith(".svelte")) return source;

  return [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join("\n");
}

/** @param {string} source @returns {string[]} */
function importSpecifiers(source) {
  const text = stripNoise(source);
  const found = new Set();
  const patterns = [
    /\b(?:import|export)\s+(?:[\w*${}\s,]+?\s+from\s+)?["']([^"'\n]+)["']/g,
    /\bimport\s*\(\s*["']([^"'\n]+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"'\n]+)["']\s*\)/g,
  ];

  for (const re of patterns) for (const m of text.matchAll(re)) found.add(m[1]);

  return [...found];
}

/** @param {string} source @returns {string[]} */
export function bareSpecifiers(source) {
  return importSpecifiers(source).filter((s) => !/^(\.|\/|node:|bun:|data:|https?:|#|\$)/.test(s) && !s.includes("${") && !s.startsWith("node_modules/") && /^(@[\w.-]+\/)?[\w.-]+(\/|$)/.test(s) && !BUILTINS.has(s.split("/")[0]));
}

/** Relative import specifiers (`./x`, `../x`) of a source text. @param {string} source @returns {string[]} */
export function relativeSpecifiers(source) {
  return importSpecifiers(source).filter((s) => s.startsWith("."));
}

/** @param {string} specifier @returns {string} */
export function packageName(specifier) {
  const parts = specifier.split("/");

  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function walk(path, out) {
  let st;

  try {
    st = statSync(path);
  } catch {
    return;
  }

  if (st.isFile()) {
    if (SCANNED.test(path) && !TEST_FILE.test(path)) out.push(path);
    return;
  }

  for (const name of readdirSync(path)) if (!SKIP_DIRS.has(name)) walk(join(path, name), out);
}

/**
 * @param {string} root  repo root
 * @returns {string[]} one message per undeclared import
 */
export function check(root) {
  const problems = [];
  const packagesDir = join(root, "packages");

  for (const dir of readdirSync(packagesDir)) {
    const pkgFile = join(packagesDir, dir, "package.json");

    if (!existsSync(pkgFile)) continue;

    const pkg = JSON.parse(readFileSync(pkgFile, "utf-8"));
    const declared = new Set([pkg.name, ...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {}), ...Object.keys(pkg.optionalDependencies ?? {})]);
    const files = [];

    for (const entry of pkg.files ?? []) walk(join(packagesDir, dir, entry), files);

    for (const file of files) {
      const source = codeOf(file, readFileSync(file, "utf-8"));

      // A relative import that leaves the package folder reaches a sibling checkout: it breaks once installed.
      for (const specifier of relativeSpecifiers(source)) {
        const target = resolve(dirname(file), specifier);
        const inside = relative(join(packagesDir, dir), target);

        if (inside.startsWith("..")) problems.push(`${pkg.name}: ${relative(root, file)} imports "${specifier}", which leaves the package folder`);
      }

      for (const specifier of bareSpecifiers(source)) {
        const name = packageName(specifier);

        if (!declared.has(name)) problems.push(`${pkg.name}: ${relative(root, file)} imports "${specifier}" but ${name} is not in its dependencies or peerDependencies`);
      }
    }
  }

  return problems;
}

function main() {
  const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), ".."));
  const problems = check(root);

  for (const p of problems) console.error(p);
  if (problems.length) {
    console.error(`\n${problems.length} undeclared import(s)`);
    process.exit(1);
  }
  console.log("package imports ok");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
