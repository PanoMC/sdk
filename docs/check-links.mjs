#!/usr/bin/env bun
// Checks that what the author docs quote exists in this repo. Run from anywhere: `bun docs/check-links.mjs`.
//
// For each of the docs below, and every file of agent-guide/, it checks
//   - markdown links to local files,
//   - repo paths in the text (packages/..., docs/..., test-fixtures/..., scripts/...),
//   - the command word after `theme-core`, `pano-plugin` and `pano-client` in code (inline or fenced),
//   - every --flag on such a command line against the source of that tool,
//   - `@panomc/sdk/...` and `@panomc/plugin-kit/...` specifiers against the package exports.
// Exit code 0 = everything quoted exists, 1 = the problems are printed.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = [
  ...['THEME-AUTHOR-GUIDE.md', 'MIGRATION.md', 'PLUGIN-VIEWS.md', 'CONTROLLERS.md'].map((name) => `docs/${name}`),
  // the agent guide (agent-guide/README.md is its index): same checks, links resolved from its own folder
  ...readdirSync(join(root, 'agent-guide'))
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => `agent-guide/${name}`),
];

const read = (p) => readFileSync(join(root, p), 'utf8');

/** Concatenated source (no tests, no node_modules) of a folder, to look up flags. */
function sourceOf(dir) {
  let text = '';

  for (const entry of readdirSync(join(root, dir))) {
    if (entry === 'node_modules' || entry === '__tests__') continue;

    const rel = `${dir}/${entry}`;
    const stat = statSync(join(root, rel));

    if (stat.isDirectory()) text += sourceOf(rel);
    else if (/\.(js|mjs)$/.test(entry)) text += `\n${read(rel)}`;
  }

  return text;
}

// ---- the tools --------------------------------------------------------------------------------------------------
const themeCoreCli = read('packages/theme-core/bin/theme-core.js');
const commandsBlock = themeCoreCli.match(/const COMMANDS = \{([\s\S]*?)\n\};/)?.[1] ?? '';
const themeCoreCommands = new Set([...commandsBlock.matchAll(/^\s+"?([a-z][a-z-]*)"?:/gm)].map((m) => m[1]));

const pluginCli = read('packages/plugin-kit/bin/pano-plugin.js');
const flagsBlock = pluginCli.match(/const FLAGS = \{([\s\S]*?)\n\};/)?.[1] ?? '';
const pluginCommands = new Set(['new', ...[...flagsBlock.matchAll(/^\s+([a-z][a-z-]*):/gm)].map((m) => m[1])]);

const clientCli = read('packages/client-gen/src/cli.js');
const clientCommands = new Set([...clientCli.matchAll(/^ {2}pano-client ([a-z]+)/gm)].map((m) => m[1]));

const TOOLS = {
  'theme-core': { commands: themeCoreCommands, source: sourceOf('packages/theme-core/bin') },
  'pano-plugin': { commands: pluginCommands, source: sourceOf('packages/plugin-kit/bin') + sourceOf('packages/plugin-kit/src') },
  'pano-client': { commands: clientCommands, source: sourceOf('packages/client-gen/src') },
};

// ---- package exports --------------------------------------------------------------------------------------------
const exportsOf = (pkg) => Object.keys(JSON.parse(read(`packages/${pkg}/package.json`)).exports ?? {});
const PACKAGES = { sdk: exportsOf('sdk'), 'plugin-kit': exportsOf('plugin-kit') };

// Specifiers the plugin kit resolves itself (virtual modules of the rollup preset), not package exports.
const VIRTUAL = new Set(['@panomc/sdk/plugin-api']);

function exported(pkg, subpath) {
  const key = subpath ? `.${subpath}` : '.';

  if (VIRTUAL.has(`@panomc/${pkg}${subpath}`)) return true;

  return PACKAGES[pkg].some((pattern) =>
    pattern.endsWith('/*') ? key.startsWith(pattern.slice(0, -1)) : pattern === key,
  );
}

// ---- the docs ---------------------------------------------------------------------------------------------------
/** Code segments of a markdown text: fenced block lines and inline spans, with the line number. */
function codeSegments(text) {
  const segments = [];
  let fenced = false;

  text.split('\n').forEach((line, index) => {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      return;
    }

    if (fenced) segments.push({ line: index + 1, code: line });
    else for (const m of line.matchAll(/`([^`]+)`/g)) segments.push({ line: index + 1, code: m[1] });
  });

  return segments;
}

const problems = [];
const report = (doc, line, message) => problems.push(`${doc}:${line}: ${message}`);

for (const doc of DOCS) {
  if (!existsSync(join(root, doc))) {
    problems.push(`${doc}: the file does not exist`);
    continue;
  }

  const text = read(doc);
  const lines = text.split('\n');

  // 1. markdown links
  lines.forEach((line, index) => {
    for (const m of line.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = m[1].split('#')[0];

      if (!target || /^(https?:|mailto:)/.test(target)) continue;
      if (!existsSync(resolve(root, dirname(doc), target))) report(doc, index + 1, `link target "${target}" does not exist`);
    }
  });

  // 2. repo paths
  lines.forEach((line, index) => {
    for (const m of line.matchAll(/(?<![\w@$./-])((?:packages|docs|test-fixtures|scripts)\/[A-Za-z0-9_./@*-]*)/g)) {
      let path = m[1].replace(/[.,:;)]+$/, '').replace(/\/$/, '');

      if (path.includes('*')) path = path.slice(0, path.indexOf('*')).replace(/\/[^/]*$/, '');
      if (!existsSync(join(root, path))) report(doc, index + 1, `path "${m[1]}" does not exist`);
    }
  });

  // 3. commands and flags, 4. package specifiers (code only)
  for (const { line, code } of codeSegments(text)) {
    for (const m of code.matchAll(/(?<![\w-])(theme-core|pano-plugin|pano-client)\s+([a-z][a-z-]*)/g)) {
      const tool = TOOLS[m[1]];

      if (!tool.commands.has(m[2])) report(doc, line, `"${m[1]} ${m[2]}" is not a command of ${m[1]}`);
    }

    const tool = Object.keys(TOOLS).find((name) => new RegExp(`(?<![\\w-])${name}\\s+[a-z]`).test(code));

    if (tool) {
      for (const f of code.matchAll(/(?<![\w-])(--[a-z][a-z-]*)/g)) {
        if (!TOOLS[tool].source.includes(f[1])) report(doc, line, `flag ${f[1]} is not known to ${tool}`);
      }
    }

    for (const m of code.matchAll(/@panomc\/(sdk|plugin-kit)((?:\/[A-Za-z0-9_.-]+)*)/g)) {
      const subpath = m[2].replace(/\.$/, '');

      if (!exported(m[1], subpath)) report(doc, line, `"@panomc/${m[1]}${subpath}" is not exported by the package`);
    }
  }
}

if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`\n${problems.length} problem(s) in the docs.`);
  process.exit(1);
}

console.log(`docs ok: ${DOCS.join(', ')}`);
