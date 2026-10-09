// Shared by the runtime tests: where the build output is, its static import graph, and gzip sizes.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

export const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const RUNTIME_DIR = join(PACKAGE_DIR, 'dist/runtime');
export const ZIP_FILE = join(PACKAGE_DIR, 'dist/widget-runtime.zip');

// Budgets, gzip level 9, bytes. The doc's starting targets were: loader 3 KB, eager runtime 45 KB, a market widget 15 KB.
// Measured on the first build (svelte 5.55.9): loader 1514 B, eager runtime 52345 B (of which svelte-i18n 14988 B, because
// language.js and controllers.js import it statically), Svelte client 22631 B. The numbers below are the measurement plus ~10 %.
export const BUDGET = {
  loader: 2 * 1024,
  eagerRuntime: 56 * 1024,
  eagerRuntimeWithoutI18n: 40 * 1024,
  svelteClient: 24 * 1024,
  svelteI18n: 16 * 1024,
  marketWidget: 15 * 1024,
  zip: 900 * 1024,
};

/** The tests read the build output; they never start the build (it runs under the repo's build lock). */
export function requireBuild() {
  if (!existsSync(join(RUNTIME_DIR, 'runtime.json'))) {
    throw new Error('dist/runtime is missing: run `bun run build` in packages/widget-host first (under the build lock)');
  }
}

export const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))
    .sort();

/** Every file of the runtime, as a path relative to `dist/runtime`. */
export const runtimeFiles = () => walk(RUNTIME_DIR).map((f) => relative(RUNTIME_DIR, f).split('\\').join('/'));

export const read = (file) => readFileSync(join(RUNTIME_DIR, file), 'utf8');
export const gzipSize = (file) => gzipSync(readFileSync(join(RUNTIME_DIR, file)), { level: 9 }).length;

// static `import ... from"./x.js"`, `export ... from"./x.js"`, side-effect `import"./x.js"` (minified output)
const STATIC = /(?:\bfrom|\bimport)["'](\.[^"']+)["']/g;
// terser writes `from"x"`, `import"x"` and `import("x")` without a space; prose in a string ("imported from 'x'") has one
const DYNAMIC_OR_BARE = /(?:\bfrom|\bimport)\(?["']([^."'/][^"']*)["']/g;

/** Specifiers of every static import in a runtime file. */
export const staticImports = (file) => [...read(file).matchAll(STATIC)].map((m) => m[1]);

/** Bare specifiers (`svelte`, `@panomc/client`, ...) left in a file: there must be none. */
export const bareImports = (file) => [...read(file).matchAll(DYNAMIC_OR_BARE)].map((m) => m[1]);

/** The files reachable from `entry` over static imports (the entry included), relative to `dist/runtime`. */
export function closure(entry, skip = () => false) {
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file) || skip(file)) return;
    seen.add(file);
    for (const spec of staticImports(file)) visit(relative(RUNTIME_DIR, resolve(RUNTIME_DIR, dirname(file), spec)).split('\\').join('/'));
  };
  visit(entry);
  return [...seen];
}

export const gzipTotal = (files) => files.reduce((sum, f) => sum + gzipSize(f), 0);
export const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

// A happy-dom window on globalThis (the runtime is browser code). `restoreDom()` puts globalThis back.
import { Window } from 'happy-dom';

const NAMES = [
  'window', 'self', 'document', 'HTMLElement', 'Element', 'Node', 'Text', 'Comment', 'DocumentFragment', 'ShadowRoot',
  'CustomEvent', 'Event', 'MouseEvent', 'KeyboardEvent', 'MutationObserver', 'customElements', 'HTMLTemplateElement',
  'HTMLInputElement', 'HTMLButtonElement', 'HTMLAnchorElement', 'HTMLLinkElement', 'getComputedStyle', 'location',
  'navigator', 'localStorage', 'sessionStorage', 'requestAnimationFrame', 'cancelAnimationFrame', 'DOMParser',
  'SVGElement', 'HTMLSelectElement', 'HTMLTextAreaElement', 'HTMLImageElement', 'HTMLFormElement', 'NodeFilter',
];
let saved = new Map();
let current = null;

/** @param {string} [url] */
export function installDom(url = 'https://site.test/page') {
  if (current) return current;
  current = new Window({ url, settings: { disableErrorCapturing: true } });
  saved = new Map();
  for (const name of NAMES) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    const value = name === 'window' || name === 'self' ? current : current[name];
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
  return current;
}

export function restoreDom() {
  if (!current) return;
  for (const [name, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
  current.happyDOM?.abort?.();
  current = null;
  saved = new Map();
}

export const settle = async (ms = 0) => {
  await new Promise((r) => setTimeout(r, ms));
  await Promise.resolve();
};
