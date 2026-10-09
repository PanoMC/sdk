// View catalogue, data part (doc 02 section 7): builds the rows the list, the stage and `views.json` share.
//
// Everything that touches the world (the registry, the plugin files, the engine's samples) arrives through
// `deps`, so the tests run it without SvelteKit. `deps.js` makes the real ones.

import { badgesOf, controllersOfSamples, engineRows, pluginRows, stateNames, statusOf } from "./model.js";

/**
 * @typedef {object} CatalogueDeps
 * @property {{ views?: Record<string, any> }} skinContract
 * @property {Record<string, () => Promise<{ default?: any, notApplicable?: string[] }>>} engineSamples  view name -> lazy `*.samples.js`
 * @property {{
 *   resolveViewModule: (id: string) => Promise<{ source: "override" | "default" } | null>,
 *   describeView: (id: string) => { overridden: boolean, status?: string } | null,
 *   getIssues: () => Array<{ type: string, view: string, [k: string]: any }>,
 * }} registry
 * @property {() => Promise<string[]>} pluginIds  plugins whose package is installed
 * @property {(pluginId: string) => Promise<any | null>} pluginViews  `contract/views.json` of a plugin
 * @property {(pluginId: string) => Promise<{ default?: Record<string, any>, notApplicable?: Record<string, string[]> } | null>} pluginSamples  `samples/samples.mjs`
 */

/**
 * @typedef {import("./model.js").Row & {
 *   block?: boolean, page?: any, inject?: any, widget?: any,
 *   notApplicable: string[], controllers: string[], hasSamples: boolean,
 * }} CatalogueRow
 */

/**
 * The samples module of one view: `{ states, samples, notApplicable }`. A view with no samples file has no states.
 * @param {CatalogueDeps} deps
 * @param {{ id: string, name: string, pluginId: string | null }} row
 * @param {Map<string, any>} pluginCache  plugin id -> samples module (read once per plugin)
 */
export async function samplesOf(deps, row, pluginCache = new Map()) {
  try {
    if (!row.pluginId) {
      const load = deps.engineSamples?.[row.name];
      const mod = load ? await load() : null;
      const samples = mod?.default ?? null;

      return { samples, states: stateNames(samples), notApplicable: mod?.notApplicable ?? [] };
    }

    if (!pluginCache.has(row.pluginId)) pluginCache.set(row.pluginId, deps.pluginSamples(row.pluginId).catch(() => null));
    const mod = await pluginCache.get(row.pluginId);
    const samples = mod?.default?.[row.name] ?? null;

    return { samples, states: stateNames(samples), notApplicable: mod?.notApplicable?.[row.name] ?? [] };
  } catch (e) {
    console.warn(`[theme-core] catalogue: the samples of '${row.id}' could not be loaded`, e);

    return { samples: null, states: [], notApplicable: [] };
  }
}

/**
 * Status of a view from the registry: it is resolved first, because the registry only knows the
 * outcome (override rendered or refused) after a resolution.
 * @param {CatalogueDeps} deps
 * @param {string} id
 */
async function statusFor(deps, id) {
  const described = deps.registry.describeView(id);
  if (!described) return { status: "default", loaded: false };

  let source = null;
  try {
    source = (await deps.registry.resolveViewModule(id))?.source ?? null;
  } catch {
    source = "default";
  }

  return { status: statusOf(described, source), loaded: true };
}

/**
 * Every view the theme can show: the engine's from the skin contract, each installed plugin's from its
 * `contract/views.json`.
 * @param {CatalogueDeps} deps
 * @param {{ only?: string }} [options]  build only the row of this view id (the stage)
 * @returns {Promise<CatalogueRow[]>}
 */
export async function loadCatalogue(deps, { only } = {}) {
  /** @type {any[]} */
  const base = engineRows(deps.skinContract);
  const wanted = (id) => !only || only === id;

  let pluginIds = [];
  try {
    pluginIds = await deps.pluginIds();
  } catch (e) {
    console.warn("[theme-core] catalogue: the installed plugins could not be listed", e);
  }

  for (const pluginId of pluginIds) {
    let viewsJson = null;
    try {
      viewsJson = await deps.pluginViews(pluginId);
    } catch {
      viewsJson = null;
    }
    if (!viewsJson) continue;
    base.push(...pluginRows(viewsJson, pluginId));
  }

  const issues = deps.registry.getIssues();
  const pluginCache = new Map();

  const rows = await Promise.all(
    base.filter((row) => wanted(row.id)).map(async (row) => {
      const [{ status }, { samples, states, notApplicable }] = await Promise.all([statusFor(deps, row.id), samplesOf(deps, row, pluginCache)]);
      const controllers = controllersOfSamples(samples);

      return {
        ...row,
        status,
        states,
        notApplicable,
        controllers,
        hasSamples: states.length > 0,
        badges: badgesOf(row, states, controllers),
        issues: issues.filter((issue) => issue.view === row.id),
      };
    }),
  );

  return rows;
}
