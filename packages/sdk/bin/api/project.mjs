// Loads a tree of Kotlin sources and resolves its @Endpoint classes: base class through supertypes,
// namespace / mount overrides, `Path(...)` declarations with constants. Used by extract-routes and migrate-v1.
import fs from 'node:fs';
import path from 'node:path';
import { walk, readText, rel, pluginIdFor } from './util.mjs';
import { parseKotlin, findPathCalls, evalPathExpr } from './kotlin.mjs';

/** Base classes of the platform an endpoint finally has to extend. */
export const TERMINALS = new Set(['Api', 'LoggedInApi', 'PanelApi', 'SetupApi', 'Template']);

/**
 * Where the Kotlin sources of `root` live: a pano-web-platform checkout is scanned at `Pano/src/main/kotlin`
 * (core only, its plugins are separate repositories).
 * @param {string} root
 * @returns {{ kotlinRoot: string, apiDir: string, core: boolean }}
 */
export function layoutOf(root) {
  const abs = path.resolve(root);
  const core = path.join(abs, 'Pano', 'src', 'main', 'kotlin');
  if (fs.existsSync(core)) return { kotlinRoot: core, apiDir: path.join(abs, 'Pano', 'api'), core: true };
  return { kotlinRoot: abs, apiDir: path.join(abs, 'api'), core: false };
}

/**
 * @typedef {import('./kotlin.mjs').KotlinFile} KotlinFile
 * @typedef {import('./kotlin.mjs').ClassInfo} ClassInfo
 * @typedef {{
 *   cls: ClassInfo, file: KotlinFile, pluginId: string | null, terminal: string, namespace: 'SITE' | 'PANEL',
 *   namespaceExplicit: boolean, mount: 'API' | 'ROOT',
 *   calls: { method: string, line: number, file: KotlinFile, value: string, pieces: import('./kotlin.mjs').Piece[] }[]
 * }} Endpoint
 */

/**
 * @param {string} root directory holding the Kotlin sources
 * @param {{ pluginId?: string | null, labelRoot?: string }} [opts] `labelRoot` is what file labels are relative to
 */
export function loadKotlinProject(root, opts = {}) {
  const rootAbs = path.resolve(root);
  const labelRoot = path.resolve(opts.labelRoot || root);
  const files = walk(rootAbs, { exts: ['.kt'], kotlinMain: true }).map((p) => parseKotlin(readText(p), p, rel(labelRoot, p)));
  /** @type {Map<string, ClassInfo[]>} */
  const classes = new Map();
  /** @type {Map<string, import('./kotlin.mjs').ConstInfo[]>} */
  const consts = new Map();
  for (const f of files) {
    for (const c of f.classes) {
      if (!classes.has(c.name)) classes.set(c.name, []);
      classes.get(c.name).push(c);
    }
    for (const k of f.consts) {
      if (!consts.has(k.name)) consts.set(k.name, []);
      consts.get(k.name).push(k);
    }
  }
  const idCache = new Map();
  const pluginIdOf = (f) => opts.pluginId ?? pluginIdFor(path.dirname(f.path), rootAbs, idCache);

  /** @type {(file: KotlinFile, ref: string) => import('./kotlin.mjs').ConstInfo | null} */
  const resolveConst = (file, ref) => {
    const parts = ref.split('.').filter((p) => p !== 'Companion');
    const name = parts[parts.length - 1];
    const ownerName = parts.length > 1 ? parts[parts.length - 2] : null;
    const cands = consts.get(name) || [];
    if (!cands.length) return null;
    if (ownerName) {
      const hit = cands.find((k) => k.owner === ownerName);
      if (hit) return hit;
    }
    const same = cands.filter((k) => k.file === file);
    if (same.length === 1) return same[0];
    if (same.length > 1) return same.find((k) => k.owner === null) || same[0];
    const samePkg = cands.filter((k) => k.file.pkg === file.pkg);
    if (samePkg.length === 1) return samePkg[0];
    return cands.length === 1 ? cands[0] : ownerName ? null : cands[0];
  };

  /** @param {string} name @param {KotlinFile} from */
  const findClass = (name, from) => {
    const cands = classes.get(name) || [];
    if (cands.length <= 1) return cands[0] || null;
    return cands.find((c) => c.file === from) || cands.find((c) => c.file.pkg === from.pkg) || cands[0];
  };

  /**
   * @param {ClassInfo} cls
   * @param {Set<ClassInfo>} [seen]
   * @returns {{ terminal: string | null, chain: ClassInfo[] }}
   */
  const resolveBase = (cls, seen = new Set()) => {
    if (seen.has(cls)) return { terminal: null, chain: [cls] };
    seen.add(cls);
    const ordered = [...cls.supers.filter((s) => s.call), ...cls.supers.filter((s) => !s.call)];
    for (const sup of ordered) {
      if (TERMINALS.has(sup.name)) return { terminal: sup.name, chain: [cls] };
      const next = findClass(sup.name, cls.file);
      if (next && next.kind !== 'interface') {
        const r = resolveBase(next, seen);
        if (r.terminal) return { terminal: r.terminal, chain: [cls, ...r.chain] };
      }
    }
    return { terminal: null, chain: [cls] };
  };

  /** @type {{ file: string, line: number, message: string }[]} */
  const errors = [];
  /** @type {Endpoint[]} */
  const endpoints = [];
  for (const f of files) {
    for (const cls of f.classes) {
      if (!cls.annotations.includes('Endpoint') || cls.kind !== 'class' || cls.abstract) continue;
      const fail = (message, line = cls.line) => errors.push({ file: f.rel, line, message: `${cls.name}: ${message}` });
      const { terminal, chain } = resolveBase(cls);
      if (!terminal) {
        fail(
          `cannot resolve its base class (supertypes: ${cls.supers.map((s) => s.name).join(', ') || 'none'}); ` +
            `it has to reach ${[...TERMINALS].filter((t) => t !== 'Template').join(', ')} or Template through classes in the scanned sources`,
        );
        continue;
      }
      let namespace = terminal === 'PanelApi' ? 'PANEL' : 'SITE';
      let namespaceExplicit = false;
      let mount = terminal === 'Template' ? 'ROOT' : 'API';
      let nsFound = false;
      let mountFound = false;
      for (const c of chain) {
        if (!c.body) continue;
        const bodyText = c.file.text.slice(c.body[0], c.body[1]);
        const ns = /override\s+val\s+namespace\s*(?::\s*\w+\s*)?=\s*(?:[\w.]*\.)?Namespace\.(SITE|PANEL)\b/.exec(bodyText);
        const mo = /override\s+val\s+mount\s*(?::\s*\w+\s*)?=\s*(?:[\w.]*\.)?Mount\.(API|ROOT)\b/.exec(bodyText);
        if (ns && !nsFound) {
          namespace = ns[1];
          namespaceExplicit = true;
          nsFound = true;
        }
        if (mo && !mountFound) {
          mount = mo[1];
          mountFound = true;
        }
      }
      let calls = [];
      let declaredIn = null;
      for (const c of chain) {
        if (!c.body) continue;
        const found = findPathCalls(c.file, c.body[0], c.body[1]);
        if (found.length) {
          calls = found.map((p) => ({ ...p, file: c.file }));
          declaredIn = c;
          break;
        }
      }
      if (!calls.length || !declaredIn) {
        fail('no Path(...) declaration found in the class or its base classes');
        continue;
      }
      const resolved = [];
      let bad = false;
      for (const call of calls) {
        try {
          const ev = evalPathExpr(call.file, call.expr, resolveConst);
          resolved.push({ method: call.method, line: call.line, file: call.file, value: ev.value, pieces: ev.pieces });
        } catch (e) {
          fail(e.message, call.line);
          bad = true;
        }
      }
      if (bad) continue;
      endpoints.push({ cls, file: f, pluginId: pluginIdOf(f), terminal, namespace, namespaceExplicit, mount, calls: resolved });
    }
  }
  return { rootAbs, files, classes, consts, endpoints, errors, resolveConst, findClass, pluginIdOf };
}
