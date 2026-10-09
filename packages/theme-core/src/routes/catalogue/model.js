// View catalogue, pure part (doc 02 section 7): ids, urls, rows, filters and sample states.
//
// Nothing here imports SvelteKit, the registry or a component, so the list, the stage, `views.json` and
// the tests all build on the same functions. The catalogue exists in theme dev mode only: the generated
// route files import `list.js` / `stage.js` / `views-json.js` dynamically behind `dev` (see bin/sync.js).

/** Namespace of the engine's own views in catalogue urls (engine ids stay bare: `LoginView`). */
export const ENGINE_NS = "pano";

/** Where the catalogue lives. */
export const CATALOGUE_PATH = "/__pano/views";

/** The four state names the catalogue knows; other keys of a samples file are allowed and listed. */
export const STANDARD_STATES = Object.freeze(["empty", "filled", "error", "loading"]);

/** The six `themeColor` values (doc 03): the stage puts one on `data-bs-theme`. */
export const PALETTES = Object.freeze(["dark", "light", "copper", "emerald", "midnight", "crimson"]);

export const STATUSES = Object.freeze(["default", "overridden", "override outdated"]);

/**
 * One sample state (doc 02 section 7): the props the view gets, a patch per controller, the session the
 * stage simulates and a title. The engine's samples may build stores; plugin samples are pure data.
 *
 * @typedef {object} SampleState
 * @property {Record<string, any>} [props]
 * @property {Record<string, Record<string, any>>} [controllers]
 * @property {"guest" | "user"} [session]
 * @property {string} [label]
 */

/**
 * The default export of a `*.samples.js`: state name -> state (or a function returning one).
 * Standard names: `empty`, `filled`, `error`, `loading`; other names are allowed and listed.
 *
 * @typedef {{ [state: string]: SampleState | (() => SampleState | Promise<SampleState>) | undefined }} Samples
 */

/**
 * `LoginView` -> `{ ns: "pano", name: "LoginView", pluginId: null }`; `market:ProductCard` -> `{ ns: "market", ... }`.
 * @param {string} id
 */
export function splitViewId(id) {
  const at = String(id).indexOf(":");

  if (at <= 0) return { ns: ENGINE_NS, name: String(id), engine: true };

  return { ns: id.slice(0, at), name: id.slice(at + 1), engine: false };
}

/** Inverse of the stage route: `/__pano/views/<ns>/<view>` -> the view id. */
export function viewIdFromParams(ns, view) {
  return ns === ENGINE_NS ? view : `${ns}:${view}`;
}

/**
 * @param {string} id
 * @param {{ state?: string, palette?: string, source?: string, bare?: boolean }} [query]
 */
export function stageUrl(id, query = {}) {
  const { ns, name } = splitViewId(id);
  const params = new URLSearchParams();

  if (query.state) params.set("state", query.state);
  if (query.palette) params.set("palette", query.palette);
  if (query.source && query.source !== "theme") params.set("source", query.source);
  if (query.bare) params.set("bare", "1");

  const qs = params.toString();

  return `${CATALOGUE_PATH}/${encodeURIComponent(ns)}/${encodeURIComponent(name)}${qs ? `?${qs}` : ""}`;
}

/** The command that copies a view into the theme (doc 01 section 4, `eject-view`). */
export function ejectCommand(id) {
  return `bunx theme-core eject-view ${id}`;
}

/**
 * The stage's query string, validated. Unknown values fall back to the defaults.
 * @param {URLSearchParams} searchParams
 * @param {string[]} states  the state names of the view
 */
export function parseStageQuery(searchParams, states = []) {
  const wanted = searchParams.get("state");
  const state = wanted && states.includes(wanted) ? wanted : states.includes("filled") ? "filled" : (states[0] ?? null);
  const palette = PALETTES.includes(searchParams.get("palette") ?? "") ? searchParams.get("palette") : null;
  const source = searchParams.get("source") === "default" ? "default" : "theme";
  const bare = searchParams.get("bare") === "1";

  return { state, requestedState: wanted, palette, source, bare };
}

/**
 * Kind of an engine view: the skin contract only types the parts (`component`).
 * @param {string} name
 * @param {{ kind?: string }} def
 */
export function engineKind(name, def) {
  if (def?.kind) return def.kind;

  return /LayoutView$/.test(name) ? "layout" : "page";
}

/**
 * State names of a samples module (`export default { ... }`), standard ones first.
 * @param {Record<string, unknown> | null | undefined} samples
 */
export function stateNames(samples) {
  const keys = Object.keys(samples ?? {}).filter((key) => samples?.[key] !== undefined);
  const standard = STANDARD_STATES.filter((key) => keys.includes(key));

  return [...standard, ...keys.filter((key) => !STANDARD_STATES.includes(key))];
}

/**
 * Controller names the object-form states of a samples module patch (function states are not run here).
 * @param {Record<string, any> | null | undefined} samples
 */
export function controllersOfSamples(samples) {
  const names = new Set();

  for (const entry of Object.values(samples ?? {})) {
    if (entry && typeof entry === "object") for (const name of Object.keys(entry.controllers ?? {})) names.add(name);
  }

  return [...names].sort();
}

/**
 * One state of a samples module as plain data: a function is called, a missing field gets its default.
 * @param {Record<string, any> | null | undefined} samples
 * @param {string | null} state
 * @returns {Promise<{ props: Record<string, any>, controllers: Record<string, any>, session: "guest" | "user" | null, label: string | null } | null>}
 */
export async function resolveSample(samples, state) {
  if (!state || !samples || samples[state] === undefined) return null;

  const entry = typeof samples[state] === "function" ? await samples[state]() : samples[state];

  return {
    props: entry?.props ?? {},
    controllers: entry?.controllers ?? {},
    session: entry?.session === "guest" || entry?.session === "user" ? entry.session : null,
    label: typeof entry?.label === "string" ? entry.label : null,
  };
}

/**
 * Status of a view in the theme: `default`, `overridden` (an override renders) or `override outdated`
 * (the theme has an override the registry refused, so the default renders).
 * @param {{ overridden: boolean } | null} described  `describeView(id)`
 * @param {"override" | "default" | null} source  `resolveViewModule(id).source`
 */
export function statusOf(described, source) {
  if (!described?.overridden) return "default";

  return source === "override" ? "overridden" : "override outdated";
}

/**
 * @typedef {object} Row
 * @property {string} id
 * @property {string} ns
 * @property {string} name
 * @property {string | null} pluginId
 * @property {string} kind
 * @property {number} contract
 * @property {string} status
 * @property {string[]} states
 * @property {string[]} badges
 * @property {string} url
 * @property {string} source  path of the readable source (engine: relative to the engine package; plugin: relative to `contract/`)
 * @property {Record<string, any>} props  the props contract
 * @property {string[]} uses
 * @property {Array<{ type: string, [k: string]: any }>} issues
 */

/**
 * The engine's rows, from `skin-contract.json`.
 * @param {{ views?: Record<string, any> }} skinContract
 * @returns {Array<Omit<Row, "status" | "states" | "badges" | "issues">>}
 */
export function engineRows(skinContract) {
  return Object.entries(skinContract?.views ?? {}).map(([name, def]) => ({
    id: name,
    ns: ENGINE_NS,
    name,
    pluginId: null,
    kind: engineKind(name, def),
    contract: def.contract ?? 1,
    url: stageUrl(name),
    source: def.source ?? `src/lib/views/${name}.svelte`,
    props: def.props ?? {},
    uses: def.uses ?? [],
  }));
}

/**
 * The rows of one plugin, from its `contract/views.json`.
 * @param {{ pluginId?: string, namespace?: string, views?: Record<string, any> }} viewsJson
 * @param {string} [fallbackPluginId]
 */
export function pluginRows(viewsJson, fallbackPluginId) {
  const pluginId = viewsJson?.pluginId ?? fallbackPluginId ?? null;

  return Object.entries(viewsJson?.views ?? {}).map(([id, def]) => {
    const { ns, name } = splitViewId(id);

    return {
      id,
      ns: viewsJson?.namespace ?? ns,
      name,
      pluginId,
      kind: def.kind ?? "component",
      contract: def.contract ?? 1,
      url: stageUrl(id),
      source: def.source ?? "",
      props: def.props ?? {},
      uses: def.uses ?? [],
      block: def.block === true,
      page: def.page ?? null,
      inject: def.inject ?? null,
      widget: def.widget ?? null,
    };
  });
}

/**
 * Badges of a row (doc 02: contracts, controllers, blocks, samples, widgets are opt-in and shown as badges).
 * @param {Partial<Row> & { block?: boolean, page?: any, inject?: any, widget?: any }} row
 * @param {string[]} states
 * @param {string[]} controllersUsed
 */
export function badgesOf(row, states, controllersUsed = []) {
  const badges = [];

  if ((row.contract ?? 1) > 1) badges.push(`contract ${row.contract}`);
  if (controllersUsed.length) badges.push("controllers");
  if (row.block) badges.push("block");
  if (row.page) badges.push("page");
  if (row.inject) badges.push("injection");
  if (row.widget) badges.push("widget");
  if (states.includes("filled")) badges.push("samples");

  return badges;
}

/**
 * Filters of the list: plugin (`pano` = the engine), kind, status; each empty value matches everything.
 * @template {{ ns: string, kind: string, status: string }} T
 * @param {T[]} rows
 * @param {{ plugin?: string, kind?: string, status?: string }} [filters]
 * @returns {T[]}
 */
export function filterRows(rows, filters = {}) {
  return rows.filter(
    (row) =>
      (!filters.plugin || row.ns === filters.plugin) &&
      (!filters.kind || row.kind === filters.kind) &&
      (!filters.status || row.status === filters.status),
  );
}

/** Values the three filter selects offer, from the rows. */
export function filterOptions(rows) {
  const uniq = (key) => [...new Set(rows.map((row) => row[key]))].sort();

  return { plugin: uniq("ns"), kind: uniq("kind"), status: uniq("status") };
}

/**
 * The shape of `/__pano/views.json`: input of the visual comparison and the "same as before" shots.
 * @param {Row[]} rows
 * @param {string} [origin]  prefix of every url (the page origin), "" for site-relative urls
 */
export function viewsJsonOf(rows, origin = "") {
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    contract: row.contract,
    status: row.status,
    states: row.states,
    url: origin + row.url,
  }));
}
