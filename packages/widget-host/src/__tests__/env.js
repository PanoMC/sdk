// Test environment for the widget host (not shipped): a happy-dom window on globalThis, the browser build of
// Svelte under Bun (the default condition resolves the server build, where mount() throws) and a .svelte loader.
import { mock } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';

const require = createRequire(import.meta.url);
const svelteDir = dirname(require.resolve('svelte/package.json'));
const svelteExports = JSON.parse(readFileSync(join(svelteDir, 'package.json'), 'utf8')).exports;
const { compile } = require('svelte/compiler');

function pick(entry) {
  if (typeof entry === 'string') return entry;
  if (!entry || typeof entry !== 'object') return null;
  for (const key of ['browser', 'import', 'default']) {
    if (key in entry) {
      const found = pick(entry[key]);
      if (found) return found;
    }
  }
  return null;
}

/** Absolute file of a `svelte` / `svelte/x` specifier under the `browser` condition, or null. */
export function resolveSvelteBrowser(specifier) {
  const key = specifier === 'svelte' ? '.' : `./${specifier.slice('svelte/'.length)}`;
  if (key === './compiler') return null;
  const file = pick(svelteExports[key]);
  return file ? join(svelteDir, file) : null;
}

let pluginInstalled = false;
/** @type {Map<string, PropertyDescriptor | undefined>} */
let saved = new Map();
let window = null;

const NAMES = [
  'window', 'self', 'document', 'HTMLElement', 'Element', 'Node', 'Text', 'Comment', 'DocumentFragment', 'ShadowRoot',
  'CustomEvent', 'Event', 'MouseEvent', 'KeyboardEvent', 'MutationObserver', 'customElements', 'HTMLTemplateElement',
  'HTMLInputElement', 'HTMLButtonElement', 'HTMLAnchorElement', 'HTMLLinkElement', 'getComputedStyle', 'location',
  'navigator', 'localStorage', 'sessionStorage', 'requestAnimationFrame', 'cancelAnimationFrame', 'DOMParser',
  'SVGElement', 'HTMLSelectElement', 'HTMLTextAreaElement', 'HTMLImageElement', 'HTMLFormElement', 'NodeFilter',
];

function installPlugin() {
  if (pluginInstalled) return;
  pluginInstalled = true;

  Bun.plugin({
    name: 'widget-host-test-svelte',
    setup(build) {
      build.onLoad({ filter: /\.svelte$/ }, (args) => {
        const source = readFileSync(args.path, 'utf8');
        const { js, warnings } = compile(source, { generate: 'client', filename: args.path, dev: false });
        for (const w of warnings) console.warn(`[svelte] ${args.path}: ${w.code} ${w.message}`);
        return { contents: js.code, loader: 'js' };
      });
    },
  });
}

// Under Bun the default `svelte` is the server build (mount() throws) and a Bun plugin cannot redirect a bare package name.
// So `svelte/reactivity` is replaced with `mock.module`, and `../svelte-runtime.js` (mount, unmount, onMount) with the browser build.
// `uninstallBrowserEnv` puts `svelte/reactivity` back (the runtime file is only used by this package).
const RUNTIME_FILE = fileURLToPath(new URL('../svelte-runtime.js', import.meta.url));
/** @type {Record<string, any>} */
let originals = {};

/** A fresh happy-dom window on globalThis and the browser build of Svelte. Call `uninstallBrowserEnv()` in `afterAll`. */
export async function installBrowserEnv() {
  installPlugin();
  if (window) return window;

  originals = { reactivity: { ...(await import('svelte/reactivity')) } };
  const reactivity = await import(resolveSvelteBrowser('svelte/reactivity'));
  const core = await import(resolveSvelteBrowser('svelte'));
  mock.module('svelte/reactivity', () => ({ ...reactivity }));
  mock.module(RUNTIME_FILE, () => ({ mount: core.mount, unmount: core.unmount, onMount: core.onMount }));

  window = new Window({ url: 'https://site.test/page', settings: { disableErrorCapturing: true } });
  saved = new Map();

  for (const name of NAMES) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    const value = name === 'window' || name === 'self' ? window : window[name];
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }

  return window;
}

export function uninstallBrowserEnv() {
  if (!window) return;
  mock.module('svelte/reactivity', () => ({ ...originals.reactivity }));
  for (const [name, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
  saved = new Map();
  window.happyDOM?.abort?.();
  window = null;
}

/** Flush microtasks and a macrotask: Svelte batches effects. */
export const settle = async (ms = 0) => {
  await new Promise((r) => setTimeout(r, ms));
  await Promise.resolve();
};
