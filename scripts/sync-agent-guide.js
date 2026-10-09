// Copies theme-core/agent-guide/ (the source of truth of the Pano agent guide) into every repo an agent works in
// (plugins, the plugin template, themes, the panel UIs, the showcase, the headless starter) and makes sure their
// CLAUDE.md / AGENTS.md carry a pointer block that fits the kind of repo.
//
//   bun scripts/sync-agent-guide.js            # siblings resolved from the umbrella workspace (..)
//   bun scripts/sync-agent-guide.js --check    # writes nothing; exits 1 and lists every stale copy or pointer block
//   PANO_ROOT=/path/to/Pano bun scripts/sync-agent-guide.js
//
// A repo that is not checked out is skipped. Everything outside the marked block of a CLAUDE.md / AGENTS.md is left as
// it is (the panel design pointer block of panel-ui's sync-design.js included).
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const themeCore = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(process.env.PANO_ROOT || join(themeCore, '..'));
const source = join(themeCore, 'agent-guide');
const check = process.argv.includes('--check');

const START = '<!-- pano-agent-guide:start -->';
const END = '<!-- pano-agent-guide:end -->';

const READ_FIRST =
  'Read `agent-guide/README.md` first, then **only** the topic file it points to for your task. Decide from the\n' +
  'request and the code; ask only where the guide says a wrong guess is costly. `agent-guide/` is a synced copy: edit it\n' +
  'in `theme-core/agent-guide/` (repo `PanoMC/sdk`) and run `bun scripts/sync-agent-guide.js` there.';

/**
 * The pointer text per kind of repo: where the agent is, and the three rules it will break first.
 *
 * @type {Record<string, { where: string, guide?: string, rules: string[] }>}
 */
const KINDS = {
  plugin: {
    where: 'You are in a **Pano plugin** (Kotlin backend, Svelte site views, panel UI).',
    rules: [
      'Every site view is a named view `<ns>:<ViewName>` with a contract version: one `.svelte` file with `export const view = {...}`, never a registration with `component` (`plugin-views.md`).',
      'Declare relative API paths only; Pano serves them at `/api/plugins/<pluginId>/...` and `/api/plugins/<pluginId>/panel/...`. Lists answer `{ items }` (+ `{ page }` when paged), errors `{ error: { code } }` (`plugin-api.md`).',
      'Look goes on semantic classes `<ns>-<view>__<part>` and `--pano-*` tokens, logic into controllers; no `<style>` that leaks, no `getContext` in a view (`plugin-views.md`, `plugin-controllers.md`).',
    ],
  },
  'plugin-template': {
    where:
      'You are in a **Pano plugin template** (what a new plugin is started from). Whatever you write here is copied into other plugins, so it must follow the guide exactly.',
    rules: [
      'Every site view is a named view `<ns>:<ViewName>` with a contract version: one `.svelte` file with `export const view = {...}`, never a registration with `component` (`plugin-views.md`).',
      'Declare relative API paths only; Pano serves them at `/api/plugins/<pluginId>/...` and `/api/plugins/<pluginId>/panel/...`. Lists answer `{ items }` (+ `{ page }` when paged), errors `{ error: { code } }` (`plugin-api.md`).',
      'Do not add features by hand to generated output: `pano-boilerplate-plugin` is what `pano-plugin new` writes, its template is `theme-core/packages/plugin-kit/bin/templates/plugin/` (`plugin-new.md`).',
    ],
  },
  theme: {
    where: 'You are in a **Pano theme** (a thin repo on `@panomc/theme-core`).',
    rules: [
      'Take the cheapest step: tokens and CSS on semantic classes first, `eject-view` only for structure, `<PluginBlock>` to move a piece; new data or behaviour belongs to the plugin, not the theme (`theme-plugin-ui.md`).',
      'Overrides are ejected and registered in `theme.config.js` with their contract; keep every slot, hook and root class; a mismatch falls back to the default view (`theme-override-view.md`).',
      '`src/routes/`, `src/lib/`, `lang/` and `plugin-contracts/` are generated; pages, renames and the home page are keys of `theme.config.js`. `theme-core check --strict` must pass (`theme-routes-home.md`, `testing.md`).',
    ],
  },
  panel: {
    where:
      'You are in a **Pano panel UI** repo. The panel is not themed and its pages are not named views; the guide matters here when you touch what plugins and the API share with the panel.',
    rules: [
      'Core panel endpoints are `/api/v1/panel/...`; a plugin panel endpoint is `/api/plugins/<pluginId>/panel/...`, not below the panel base (`plugin-api.md`).',
      'Lists are read from `items` and pages from `page`; errors from `error.code` (`plugin-api.md`).',
      'Plugin panel pages are registered in code (`pano.ui.page.register`) and follow `design/README.md` (`plugin-panel-ui.md`).',
    ],
  },
  headless: {
    where: 'You are in a **headless Pano front-end** (the SvelteKit starter: a site that talks to Pano over the API).',
    rules: [
      'Every call to Pano is made by this server with the front-end key; the session token stays in an `HttpOnly` cookie and never reaches browser JavaScript (`headless.md`).',
      'Core is `/api/v1/...`, a plugin `/api/plugins/<pluginId>/...`; never call `/api/v1/panel/...`. Branch on `error.code` (`headless.md`).',
      '`src/lib/pano/` is generated by `bun run pano:pull`: never edit it. JavaScript with JSDoc only (`headless.md`, `testing.md`).',
    ],
  },
  showcase: {
    where:
      'You are in the **Pano showcase**: one design built as themes (`theme/`, `theme-evori/`) and as a headless front-end (`headless/`). The guide quotes these folders as worked examples, so keep them correct.',
    rules: [
      'In `theme*/`: restyle before you eject, keep slots, hooks and root classes, never edit generated `src/routes/` (`theme-plugin-ui.md`, `theme-override-view.md`).',
      'In `headless/`: the server calls Pano, the generated client is never edited, never `/api/v1/panel/...` (`headless.md`).',
      'Shared markup lives in `design/` and imports nothing of Pano; a rule that holds in the theme must hold in its headless twin.',
    ],
  },
  engine: {
    where:
      'You are in **theme-core** (repo `PanoMC/sdk`): the theme engine, the SDK, the plugin kit and the client packages. The agent guide is edited HERE, in `agent-guide/`.',
    guide:
      'Read `agent-guide/README.md` for the rules themes, plugins and headless front-ends follow. When a change here alters\n' +
      'one of those rules, a command or a flag, update the topic file in the same commit, then run\n' +
      '`bun docs/check-links.mjs` and `bun scripts/sync-agent-guide.js` (the copies in the other repos are committed there).',
    rules: [
      'A rule in the guide must be true in the code: change both together, never the guide alone.',
      'Run tests per file with `bun scripts/test-each.js [filter]`, not a bare `bun test` at the root.',
      'JavaScript with JSDoc only; every engine change is ported to the themes with `theme-core sync` + `check`.',
    ],
  },
  platform: {
    where:
      'Guidance for **plugins, themes and headless front-ends** does not live in this repo. It is the agent guide in `theme-core/agent-guide/` (repo `PanoMC/sdk`); every plugin under `plugins/` carries a synced copy as `agent-guide/`.',
    guide:
      'Working in `plugins/<plugin>/`: read that plugin\'s `agent-guide/README.md` first, then the topic for your task.\n' +
      'Working on the platform itself: the guide states what plugin and front-end authors are promised, so do not break it.',
    rules: [
      'Core is `/api/v1/...` (panel `/api/v1/panel/...`); plugins are mounted at `/api/plugins/<pluginId>/...` and `/api/plugins/<pluginId>/panel/...` from relative declared paths.',
      'Lists answer `{ items }` (+ `{ page }` when paged) and errors `{ error: { code, ... } }` with declared codes, on every endpoint.',
      'A plugin or theme without an API level is refused; inside `/api/v1` and inside a plugin the API is additive only.',
    ],
  },
};

/**
 * @param {string} kind
 * @returns {string}
 */
function blockFor(kind) {
  const { where, guide, rules } = KINDS[kind];

  return `${START}
## Agent guide

${where}

${guide ?? READ_FIRST}

The three rules you will break first:

${rules.map((rule, index) => `${index + 1}. ${rule}`).join('\n')}
${END}`;
}

/**
 * @param {string} dir
 * @param {(name: string) => boolean} keep
 * @returns {string[]}
 */
function children(dir, keep) {
  return existsSync(dir)
    ? readdirSync(dir)
        .filter(keep)
        .sort()
        .map((name) => join(dir, name))
    : [];
}

const plugins = children(join(root, 'pano-web-platform', 'plugins'), (name) => name.startsWith('pano-plugin-'));
const themes = children(join(root, 'themes'), (name) => name.endsWith('-theme'));

/** Repos that get a copy of the guide and a pointer block. @type {{ dir: string, kind: string }[]} */
const consumers = [
  ...plugins.map((dir) => ({ dir, kind: dir.endsWith('-template') ? 'plugin-template' : 'plugin' })),
  { dir: join(root, 'pano-boilerplate-plugin'), kind: 'plugin-template' },
  ...themes.map((dir) => ({ dir, kind: 'theme' })),
  { dir: join(root, 'panel-ui'), kind: 'panel' },
  { dir: join(root, 'setup-ui'), kind: 'panel' },
  { dir: join(root, 'pano-showcase'), kind: 'showcase' },
  { dir: join(root, 'pano-starter-sveltekit'), kind: 'headless' },
].filter(({ dir }) => existsSync(join(dir, '.git')));

/** Repos that get the pointer block only. @type {{ dir: string, kind: string, files: string[] }[]} */
const pointerOnly = [
  { dir: themeCore, kind: 'engine', files: ['CLAUDE.md', 'AGENTS.md'] },
  // the platform keeps a single agent file; the guide itself is not copied into it
  { dir: join(root, 'pano-web-platform'), kind: 'platform', files: ['CLAUDE.md'] },
].filter(({ dir }) => existsSync(join(dir, '.git')));

/** @type {string[]} */
const stale = [];
const name = (path) => relative(root, path) || '.';

/**
 * The first lines of an agent file this script has to create, pointing at the repo's other agent file when it has one.
 *
 * @param {string} file
 * @returns {string}
 */
function headerFor(file) {
  const dir = dirname(file);
  const base = file.slice(dir.length + 1);
  const others = ['CLAUDE.md', 'AGENTS.md', 'AGENT.md'].filter(
    (other) => other !== base && existsSync(join(dir, other)) && !readFileSync(join(dir, other), 'utf8').startsWith(`# ${other}\n\nThis repo's own notes`),
  );
  const own = others.find((other) => other !== 'AGENT.md') ?? others[0];

  return own ? `# ${base}\n\nThis repo's own notes for agents are in \`${own}\`: read it too.\n\n` : `# ${base}\n\n`;
}

/**
 * @param {string} file
 * @param {string} kind
 */
function ensurePointer(file, kind) {
  const block = blockFor(kind);
  const exists = existsSync(file);
  const current = exists ? readFileSync(file, 'utf8') : '';
  const start = current.indexOf(START);
  const end = current.indexOf(END);

  const next =
    start !== -1 && end !== -1
      ? current.slice(0, start) + block + current.slice(end + END.length)
      : (current.trimEnd() ? current.trimEnd() + '\n\n' : headerFor(file)) + block + '\n';

  if (next === current) return;

  if (check) stale.push(`${name(file)}: ${exists ? 'pointer block is stale or missing' : 'file is missing'}`);
  else writeFileSync(file, next);
}

/**
 * @param {string} dest
 * @returns {boolean} true when `dest` holds exactly the files of the source, with the same content
 */
function sameAsSource(dest) {
  if (!existsSync(dest)) return false;

  const files = readdirSync(source).sort();

  if (files.join('\n') !== readdirSync(dest).sort().join('\n')) return false;

  return files.every((file) => readFileSync(join(source, file), 'utf8') === readFileSync(join(dest, file), 'utf8'));
}

/** What a consumer's Prettier must skip: the copy is formatted by its source, not by each repo's own config. */
const PRETTIER_SKIP = ['agent-guide', 'CLAUDE.md', 'AGENTS.md'];

/**
 * Keeps the synced files out of a repo's `prettier -c .`. Only repos that already have a `.prettierignore` are touched.
 * @param {string} dir
 */
function ensurePrettierIgnore(dir) {
  const file = join(dir, '.prettierignore');

  if (!existsSync(file)) return;

  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n').map((line) => line.trim());
  const missing = PRETTIER_SKIP.filter((entry) => !lines.includes(entry) && !lines.includes(`${entry}/`) && !lines.includes(`/${entry}`));

  if (!missing.length) return;

  if (check) stale.push(`${name(file)}: does not skip ${missing.join(', ')}`);
  else writeFileSync(file, `${text.endsWith('\n') || !text ? text : `${text}\n`}${missing.join('\n')}\n`);
}

for (const { dir, kind } of consumers) {
  const dest = join(dir, 'agent-guide');

  if (!sameAsSource(dest)) {
    if (check) stale.push(`${name(dest)}: copy is stale or missing`);
    else {
      rmSync(dest, { recursive: true, force: true });
      cpSync(source, dest, { recursive: true });
    }
  }

  ensurePointer(join(dir, 'CLAUDE.md'), kind);
  ensurePointer(join(dir, 'AGENTS.md'), kind);
  ensurePrettierIgnore(dir);

  if (!check) console.log(`synced ${name(dir)} (${kind})`);
}

for (const { dir, kind, files } of pointerOnly) {
  for (const file of files) ensurePointer(join(dir, file), kind);

  if (!check) console.log(`pointer ${name(dir)} (${kind})`);
}

if (check) {
  if (stale.length) {
    console.error(stale.join('\n'));
    console.error(`\n${stale.length} stale; run: bun scripts/sync-agent-guide.js`);
    process.exit(1);
  }

  console.log(`agent guide ok: ${consumers.length} copies, ${pointerOnly.length} pointer-only repos`);
}
