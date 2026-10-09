import { addRootClass, rootClassOf, SemanticClassCollisionError } from "../styles/semantic-classes.js";
import { checkStyles } from "../styles/check-styles.js";
import { getBuildContext } from "./meta.js";

/**
 * The glue between the kit plugins of one `panoPlugin()` build (TC-31).
 *
 * The plugins of doc 02's file map each know one thing about a view: panoViews its contract,
 * panoRules the import mode, panoHelpers the helper closure, panoStamp the controller versions,
 * the semantic-class step its root classes. `pano-plugin.json` wants all of it in one entry per
 * view. This file holds the two pieces that put it together:
 *
 *  - `viewClassInfo` / `lockClassesOf`: what the root-class step does to one view source, and the
 *    classes the lock keeps for it (root class always; every own class once the plugin holds the
 *    `semanticClasses` badge);
 *  - `panoBuildContext`: a rollup plugin that copies what the other plugins found (their shared
 *    `context` object) into the build context that `panoMeta` reads when it writes the index.
 */

/** @param {string} text */
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * What `addRootClass` makes of one view source.
 *
 * - `code`: the source with the root class (the readable copy in `contract/src`)
 * - `roots`: tag names of the root elements (empty when the view has no element root)
 * - `rootClass`: `<ns>-<view-kebab>`
 * - `warnings`: the "no root element" message, when it applies
 *
 * A collision with a Bootstrap / FontAwesome class throws (the build fails with the fix). A
 * source Svelte cannot parse is left alone: the compiler reports it with better positions.
 *
 * @param {string} source
 * @param {{ ns: string, view: string }} ctx
 * @returns {{ code: string, roots: string[], rootClass: string, warnings: string[] }}
 */
export function viewClassInfo(source, ctx) {
  const rootClass = rootClassOf(ctx.ns, ctx.view);

  try {
    const result = addRootClass(source, ctx);

    return { code: result.code, roots: result.roots, rootClass, warnings: result.warnings };
  } catch (error) {
    if (error instanceof SemanticClassCollisionError) throw error;

    return { code: source, roots: [], rootClass, warnings: [] };
  }
}

/**
 * Every class of the view that follows the plugin convention: the root class and its parts
 * (`min-hello-page`, `min-hello-page__title`), sorted.
 *
 * @param {string} source source after the root-class step
 * @param {string} rootClass
 * @returns {string[]}
 */
export function ownClassesOf(source, rootClass) {
  const found = new Set();
  const pattern = new RegExp(`(?<![\\w-])${escapeRe(rootClass)}(?:__[a-z0-9-]+)?(?![\\w-])`, "g");

  for (const match of source.matchAll(pattern)) found.add(match[0]);

  return [...found].sort();
}

/**
 * Whether the plugin passes the style lint at `badge` level, which is what sets
 * `badges.semanticClasses` (doc 03 section 3). Never throws: a lint that cannot run is "no".
 *
 * @param {{ root: string, ns: string, viewsDir?: string, views: { name: string, file: string }[], styles?: Record<string, any> }} input
 * @returns {boolean}
 */
export function passesBadge({ root, ns, viewsDir, views, styles = {} }) {
  if (views.length === 0) return false;

  try {
    return checkStyles({
      root,
      ns,
      viewsDir,
      views,
      styleAttrAllow: styles.styleAttrAllow,
      dynamicClassAllow: styles.dynamicClassAllow,
      safelist: styles.safelist,
      level: "badge",
    }).every((finding) => finding.level !== "error");
  } catch {
    return false;
  }
}

/**
 * @typedef {object} ClassPolicyOptions
 * @property {string} root plugin root (absolute)
 * @property {string} ns plugin namespace
 * @property {() => ({ views: Map<string, { name: string, file: string, source: string }> } | null)} scan the panoViews scan
 * @property {Record<string, any>} [styles] `styles` of pano.plugin.js
 * @property {string} [viewsDir] folder the style lint walks, default `src/theme`
 */

/**
 * The class rules of one build, decided once per scan: whether the plugin holds the
 * `semanticClasses` badge, and the classes of every view that the lock and the package index keep
 * (root class always, its parts too once the badge is held).
 *
 * @param {ClassPolicyOptions} options
 * @returns {{ badge(): boolean, infoOf(info: { source: string, name: string }): { roots: string[], classes: string[], code: string } }}
 */
export function createClassPolicy({ root, ns, scan, styles, viewsDir }) {
  /** @type {{ scan: any, badge: boolean } | null} */
  let cached = null;

  const badge = () => {
    const found = scan();

    if (!found) return false;

    if (!cached || cached.scan !== found) {
      cached = {
        scan: found,
        badge: passesBadge({
          root,
          ns,
          viewsDir,
          views: [...found.views.values()].map((info) => ({ name: info.name, file: info.file })),
          styles,
        }),
      };
    }

    return cached.badge;
  };

  return {
    badge,

    infoOf(info) {
      const classInfo = viewClassInfo(info.source, { ns, view: info.name });

      if (classInfo.roots.length === 0) return { roots: [], classes: [], code: classInfo.code };

      return {
        roots: classInfo.roots,
        classes: badge() ? ownClassesOf(classInfo.code, classInfo.rootClass) : [classInfo.rootClass],
        code: classInfo.code,
      };
    },
  };
}

/**
 * @typedef {object} BuildContextOptions
 * @property {string} root plugin root (absolute)
 * @property {Record<string, any>} context the object handed to panoRules, panoHelpers and panoStamp
 * @property {() => ({ views: Map<string, { name: string, file: string, source: string }> } | null)} scan the panoViews scan
 * @property {ReturnType<typeof createClassPolicy>} policy
 */

/**
 * Copies what the other kit plugins found into the shared build context of the plugin root
 * (`getBuildContext`), so `panoMeta` writes it into `pano-plugin.json`:
 *
 *   views.<Name> = { controllers, helpers, roots, classes }     (samples: a later unit)
 *   badges.semanticClasses                                      (the style lint at `badge` level)
 *   viewImports                                                 (migration mode)
 *
 * Runs in `writeBundle`, which is after every compile (the stamp step has seen all views) and before
 * `panoMeta` writes the index in `closeBundle`.
 *
 * @param {BuildContextOptions} options
 * @returns {import('rollup').Plugin}
 */
export function panoBuildContext({ root, context, scan, policy }) {
  return {
    name: "pano-build-context",

    writeBundle() {
      const found = scan();

      if (!found) return;

      const shared = getBuildContext(root);
      const usage = context.controllerUsage ?? new Map();
      const helpers = context.helpers ?? new Map();

      for (const info of found.views.values()) {
        const { roots, classes } = policy.infoOf(info);

        shared.views[info.name] = {
          ...(shared.views[info.name] ?? {}),
          controllers: { ...(usage.get(info.name) ?? {}) },
          helpers: [...(helpers.get(info.name) ?? [])],
          roots,
          classes,
        };
      }

      shared.badges.semanticClasses = policy.badge();
      shared.viewImports = context.viewImports === "warn" ? "warn" : undefined;
    },
  };
}
