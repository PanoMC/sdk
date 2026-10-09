// migrate-v1: the /api/v1 cutover codemod (doc 04 section 9). Steps:
//   a  Kotlin paths     b  Error codes      c  validation import prefix
//   d  api-level helper e  client path literals   f  client result reads
// Every step is idempotent; `check` changes nothing and says what would change.
import fs from 'node:fs';
import path from 'node:path';
import { loadKotlinProject, layoutOf } from './project.mjs';
import { maskKotlin, splitArgs } from './kotlin.mjs';
import { applyRenames } from './rename-table.mjs';
import { resolvePath, isLegacy, API_ROOT, PLUGINS_ROOT } from './extract-routes.mjs';
import { rewritePathLiterals, rewriteResults, findJsLeftovers } from './js-scan.mjs';
import { walk, readText, rel, applyEdits, lineIndex, prettyJson, pluginIdFor } from './util.mjs';

export const ALL_STEPS = ['a', 'b', 'c', 'd', 'e', 'f'];
// Files that hold /api text which is not a Pano route. DatabaseMigration58to59.kt is the migration's own description
// text (it names the old paths on purpose), not a request path.
const OUTBOUND_ALLOWLIST = new Set(['ApiPaths.kt', 'PanoApiManager.kt', 'ServerSoftwareUrls.kt', 'PluginSourceCatalog.kt', 'DatabaseMigration58to59.kt']);

/** `TextUtil.convertToSnakeCase().uppercase()` of the platform. @param {string} name */
export const errorCodeOf = (name) => name.replace(/([a-z])([A-Z])/g, (_m, a, b) => `${a}_${b.toLowerCase()}`).toUpperCase();

/**
 * New declared path of a legacy one (step a).
 * @param {string} old declared path with the `/api` prefix
 * @param {{ isCore: boolean, strip?: string | null, namespace: 'SITE' | 'PANEL' }} ctx
 */
export function newDeclared(old, ctx) {
  let p = old.slice('/api'.length) || '/';
  if (ctx.isCore) p = applyRenames(p).path;
  if (ctx.namespace === 'PANEL' && (p === '/panel' || p.startsWith('/panel/'))) p = p.slice('/panel'.length) || '/';
  if (!ctx.isCore && ctx.strip) {
    if (p === `/${ctx.strip}`) p = '/';
    else if (p.startsWith(`/${ctx.strip}/`)) p = p.slice(ctx.strip.length + 1);
  }
  return p;
}

const GRADLE_HELPER = `
// api-level (pano-api migrate-v1): "panoApiLevel" of the pano-web-platform tree this plugin is built in, else "current" from
// the pano-api-level.properties inside the Pano jar on compileClasspath. \`apiLevel=\` in gradle.properties lowers it.
val panoApiLevel: String? by lazy {
    (findProperty("apiLevel") as String?)
        ?: (rootProject.findProperty("panoApiLevel") as String?)
        ?: configurations.findByName("compileClasspath")?.files?.firstNotNullOfOrNull { jar ->
            if (!jar.isFile || !jar.name.endsWith(".jar")) null
            else ZipFile(jar).use { zip ->
                zip.getEntry("pano-api-level.properties")?.let { entry ->
                    Properties().apply { load(zip.getInputStream(entry)) }.getProperty("current")
                }
            }
        }
}
`;

const GRADLE_IMPORTS = ['import java.util.Properties', 'import java.util.zip.ZipFile'];

/**
 * Puts the missing `import` lines at the top of a build script (below leading comments, blank lines and
 * `@file:` / `package` lines). Inside a Gradle script `java.` is the `java {}` extension, so the helper
 * has to use the short class names.
 * @param {string} src
 * @returns {string}
 */
function withGradleImports(src) {
  const missing = GRADLE_IMPORTS.filter((line) => !new RegExp(`^\\s*${line}\\s*$`, 'm').test(src));
  if (!missing.length) return src;
  const lines = src.split('\n');
  let at = 0;
  let inBlock = false;
  while (at < lines.length) {
    const t = lines[at].trim();
    if (inBlock) {
      if (t.includes('*/')) inBlock = false;
    } else if (t.startsWith('/*')) {
      inBlock = !t.includes('*/');
    } else if (!(t === '' || t.startsWith('//') || t.startsWith('@file:') || t.startsWith('package '))) {
      break;
    }
    at++;
  }
  lines.splice(at, 0, ...missing, ...(at < lines.length && lines[at].trim() !== '' && !/^\s*import\s/.test(lines[at]) ? [''] : []));
  return lines.join('\n');
}

/**
 * Step d on one build.gradle.kts.
 * @param {string} src
 * @returns {{ text: string, changed: boolean, warning?: string }}
 */
export function addApiLevelHelper(src) {
  if (/api-level/.test(src)) {
    // a helper written by an earlier run used fully qualified names, which do not compile in a Gradle script
    if (!/java\.util\.(?:zip\.ZipFile|Properties)\(/.test(src)) return { text: src, changed: false };
    const fixed = withGradleImports(src.replace(/java\.util\.zip\.ZipFile\(/g, 'ZipFile(').replace(/java\.util\.Properties\(/g, 'Properties('));
    return { text: fixed, changed: fixed !== src };
  }
  const manifest = /^([ \t]*)attributes\["(?:pano-version|id)"\]\s*=.*$/m.exec(src);
  if (!manifest) {
    if (/\bpluginId\b/.test(src) && /shadowJar|attributes\[/.test(src)) return { text: src, changed: false, warning: 'no jar manifest block with attributes["id"] found; add attributes["api-level"] by hand' };
    return { text: src, changed: false };
  }
  const line = `${manifest[1]}panoApiLevel?.let { attributes["api-level"] = it }`;
  const manifestEnd = manifest.index + manifest[0].length;
  let out = src.slice(0, manifestEnd) + '\n' + line + src.slice(manifestEnd);
  const anchor = /^val pluginId: String by project.*$/m.exec(out);
  if (anchor) {
    const at = anchor.index + anchor[0].length;
    out = out.slice(0, at) + '\n' + GRADLE_HELPER + out.slice(at);
  } else {
    out = out.replace(/\s*$/, '\n') + GRADLE_HELPER;
  }
  return { text: withGradleImports(out), changed: true };
}

/**
 * @typedef {{
 *   root: string, check?: boolean, only?: string[], strip?: string | null, pluginId?: string | null,
 *   quiet?: boolean
 * }} MigrateOptions
 * @typedef {{
 *   changes: Map<string, Set<string>>, leftovers: { file: string, line: number, what: string, text: string }[],
 *   warnings: string[], errors: string[], pairs: import('./js-scan.mjs').PathPair[]
 * }} MigrateResult
 */

/**
 * @param {MigrateOptions} o
 * @returns {MigrateResult}
 */
export function migrateV1(o) {
  const rootAbs = path.resolve(o.root);
  const steps = new Set(o.only && o.only.length ? o.only : ALL_STEPS);
  const layout = layoutOf(rootAbs);
  /** @type {MigrateResult} */
  const res = { changes: new Map(), leftovers: [], warnings: [], errors: [], pairs: [] };
  const mark = (file, step) => {
    if (!res.changes.has(file)) res.changes.set(file, new Set());
    res.changes.get(file).add(step);
  };
  /** @type {Map<string, string>} absolute path -> new content */
  const writes = new Map();
  const pluginId = o.pluginId ?? (layout.core ? null : pluginIdFor(rootAbs, rootAbs));

  // ---- Kotlin: steps a, b, c and the leftover scan ----
  const project = loadKotlinProject(layout.kotlinRoot, { pluginId: o.pluginId ?? undefined, labelRoot: rootAbs });
  /** @type {Map<string, { start: number, end: number, text: string }[]>} */
  const edits = new Map();
  const addEdit = (file, e, step) => {
    const list = edits.get(file.path) || [];
    const dup = list.find((x) => x.start === e.start && x.end === e.end);
    if (dup) {
      if (dup.text !== e.text) res.warnings.push(`${file.rel}: two endpoints want different rewrites of the same path text; kept the first`);
      return;
    }
    list.push(e);
    edits.set(file.path, list);
    mark(file.rel, step);
  };

  if (steps.has('a')) {
    if (project.errors.length) {
      for (const e of project.errors) res.errors.push(`${e.file}:${e.line} ${e.message}`);
    }
    for (const ep of project.endpoints) {
      if (ep.mount === 'ROOT') continue;
      let namespace = ep.namespace;
      const first = ep.calls.find((c) => isLegacy(c.value));
      if (first && namespace === 'SITE' && !ep.namespaceExplicit && /^\/api\/panel(\/|$)/.test(first.value)) {
        namespace = 'PANEL';
        res.warnings.push(`${ep.file.rel}:${ep.cls.line} ${ep.cls.name} extends ${ep.terminal} but serves ${first.value}; add "override val namespace = Namespace.PANEL"`);
      }
      if (ep.terminal === 'PanelApi' && !ep.namespaceExplicit && first && !/^\/api\/panel(\/|$)/.test(first.value)) {
        res.warnings.push(`${ep.file.rel}:${ep.cls.line} ${ep.cls.name} is a PanelApi serving ${first.value}; add "override val namespace = Namespace.SITE"`);
      }
      for (const call of ep.calls) {
        if (!isLegacy(call.value)) continue;
        const fresh = newDeclared(call.value, { isCore: !ep.pluginId, strip: o.strip, namespace });
        const p0 = call.pieces.find((p) => p.value.length > 0);
        if (!p0) continue;
        const restText = call.value.slice(p0.value.length);
        if (!fresh.endsWith(restText)) {
          res.warnings.push(`${ep.file.rel}:${call.line} ${ep.cls.name}: cannot rewrite "${call.value}" (the path is built from several parts); edit it by hand to "${fresh}"`);
        } else {
          const text = fresh.slice(0, fresh.length - restText.length);
          if (text !== p0.value) addEdit(p0.file, { start: p0.start, end: p0.end, text }, 'a');
        }
        const mounted = resolvePath(fresh, 'API', namespace, ep.pluginId);
        res.pairs.push({
          method: call.method, old: call.value, new: mounted, relative: (mounted.startsWith(PLUGINS_ROOT + '/') ? mounted.slice('/api'.length) : mounted.slice(API_ROOT.length)) || '/',
          class: ep.cls.name, file: ep.file.rel,
        });
      }
    }
  }

  if (steps.has('b')) {
    const errorClasses = new Set();
    for (const f of project.files) {
      const usesPlatformError = f.pkg === 'com.panomc.platform.model' || f.imports.includes('com.panomc.platform.model.Error') || f.imports.includes('com.panomc.platform.model.*');
      for (const c of f.classes) {
        const sup = c.supers.find((s) => s.call && s.name === 'Error');
        if (!sup || !usesPlatformError) continue;
        errorClasses.add(c.name);
        const args = splitArgs(f.code, sup.open + 1, sup.close);
        const first = args.length ? f.text.slice(args[0].start, args[0].end).trim() : '';
        if (/^"[A-Z][A-Z0-9_]*"$/.test(first) || /^code\s*=/.test(first)) continue;
        const inner = f.code.slice(sup.open + 1, sup.close);
        const lit = `"${errorCodeOf(c.name)}"`;
        const text = inner.trim() === '' ? lit : /^\s*\n/.test(inner) ? `${lit},` : `${lit}, `;
        addEdit(f, { start: sup.open + 1, end: sup.open + 1, text }, 'b');
      }
    }
    for (const f of project.files) {
      for (const c of f.classes) {
        const sup = c.supers.find((s) => s.call && errorClasses.has(s.name));
        if (sup) res.warnings.push(`${f.rel}:${c.line} ${c.name} extends the error class ${sup.name}; it inherits that code now (before: ${errorCodeOf(c.name)}); give it its own Error("${errorCodeOf(c.name)}", ...)`);
      }
    }
  }

  if (steps.has('c')) {
    for (const f of project.files) {
      const re = /io\.vertx\.ext\.web\.validation\.builder\./g;
      let m;
      while ((m = re.exec(f.code))) addEdit(f, { start: m.index, end: m.index + m[0].length, text: 'com.panomc.platform.schema.dsl.' }, 'c');
    }
  }

  for (const f of project.files) {
    const list = edits.get(f.path);
    const next = list ? applyEdits(f.src, list) : f.src;
    if (list && !o.check) writes.set(f.path, next);
    // leftover Kotlin literals, measured on the result
    if (OUTBOUND_ALLOWLIST.has(path.basename(f.path))) continue;
    const text = list ? maskKotlin(next).text : f.text;
    const lineOf = list ? lineIndex(next) : f.lineOf;
    for (const m of text.matchAll(/"(\/api(?:\/|")|\/panel\/api(?:\/|"))/g)) {
      res.leftovers.push({ file: f.rel, line: lineOf(m.index), what: '"/api/ literal', text: text.slice(m.index, m.index + 50).split('\n')[0] });
    }
  }

  // ---- Gradle: step d ----
  if (steps.has('d') && !layout.core) {
    for (const p of walk(rootAbs, { exts: ['build.gradle.kts'] })) {
      const src = readText(p);
      const r = addApiLevelHelper(src);
      if (r.warning) res.warnings.push(`${rel(rootAbs, p)}: ${r.warning}`);
      if (r.changed) {
        mark(rel(rootAbs, p), 'd');
        if (!o.check) writes.set(p, r.text);
      }
    }
  }

  // ---- pairs file ----
  const pairsFile = path.join(layout.apiDir, 'paths.old-new.json');
  /** @type {import('./js-scan.mjs').PathPair[]} */
  let existing = [];
  if (fs.existsSync(pairsFile)) {
    try {
      existing = JSON.parse(readText(pairsFile));
    } catch {
      res.errors.push(`${rel(rootAbs, pairsFile)} is not valid JSON`);
    }
  }
  const key = (p) => `${p.method || ''} ${p.old}`;
  const merged = new Map(existing.map((p) => [key(p), p]));
  for (const p of res.pairs) if (!merged.has(key(p))) merged.set(key(p), p);
  const mergedList = [...merged.values()].sort((a, b) => a.old.localeCompare(b.old) || String(a.method).localeCompare(String(b.method)));
  if (steps.has('a') && res.pairs.length && prettyJson(mergedList) !== (fs.existsSync(pairsFile) ? readText(pairsFile) : '')) {
    mark(rel(rootAbs, pairsFile), 'a');
    if (!o.check) writes.set(pairsFile, prettyJson(mergedList));
  }

  // ---- JS / Svelte: steps e, f and the leftover scan ----
  if (!layout.core) {
    const ctx = { pairs: mergedList, strip: o.strip ?? null, pluginId };
    for (const p of walk(rootAbs, { exts: ['.js', '.mjs', '.cjs', '.svelte', '.ts'] })) {
      if (path.basename(p) === 'pano-api.js') continue;
      const src = readText(p);
      let next = src;
      if (steps.has('e')) {
        const r = rewritePathLiterals(next, ctx);
        // in a UI-only repo a plain "drop /api" is the normal case; in a plugin repo it may be a missed own route
        if (mergedList.length || o.strip) for (const g of r.generic) res.warnings.push(`${rel(rootAbs, p)}: "${g}" matched no known route; only the /api prefix was dropped`);
        if (r.count) {
          next = r.text;
          mark(rel(rootAbs, p), 'e');
        }
      }
      if (steps.has('f')) {
        const r = rewriteResults(next);
        if (r.count) {
          next = r.text;
          mark(rel(rootAbs, p), 'f');
        }
      }
      if (next !== src && !o.check) writes.set(p, next);
      for (const l of findJsLeftovers(next)) res.leftovers.push({ file: rel(rootAbs, p), ...l });
    }
  }

  if (!o.check && !res.errors.length) {
    for (const [p, content] of writes) {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, content);
    }
  }
  return res;
}

/**
 * CLI entry.
 * @param {MigrateOptions} o
 * @returns {number}
 */
export function runMigrateV1(o) {
  const r = migrateV1(o);
  for (const e of r.errors) console.error(`error: ${e}`);
  for (const w of r.warnings) console.error(`warning: ${w}`);
  const files = [...r.changes.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [file, steps] of files) console.error(`${o.check ? 'would change' : 'changed'}: ${file} [${[...steps].sort().join(',')}]`);
  for (const l of r.leftovers) console.error(`leftover: ${l.file}:${l.line} ${l.what} ${l.text}`);
  console.error(
    `migrate-v1: ${files.length} file(s) ${o.check ? 'would change' : 'changed'}, ${r.leftovers.length} leftover(s), ${r.warnings.length} warning(s)`,
  );
  if (r.errors.length) return 2;
  if (o.check) return files.length || r.leftovers.length ? 1 : 0;
  return 0;
}
