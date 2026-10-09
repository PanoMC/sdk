// `/__pano/views/<ns>/<view>?state=&palette=&source=theme|default&bare=1` (doc 02 section 7): one view with
// one sample state. Loaded by the generated `+page.js` behind `dev`.
//
// The load resolves everything the stage needs (the component of the chosen source, the sample, the readable
// source); `Stage.svelte` turns sample mode on while it is mounted and off when it leaves.

import { error } from "@sveltejs/kit";

import { loadCatalogue, samplesOf } from "./catalogue.js";
import { createDeps } from "./deps.js";
import { ejectCommand, parseStageQuery, resolveSample, viewIdFromParams } from "./model.js";

/**
 * Props the contract marks as required that the sample does not give. The engine's contract describes props
 * in prose, so only a plugin's `{ type, required }` records are checked.
 * @param {Record<string, any>} contract
 * @param {Record<string, any>} props
 */
export function missingProps(contract, props) {
  return Object.entries(contract ?? {})
    .filter(([name, spec]) => spec && typeof spec === "object" && spec.required === true && !(name in (props ?? {})))
    .map(([name]) => name);
}

/**
 * @param {{ url: URL, params: { ns: string, view: string }, fetch?: typeof fetch }} event
 * @param {import("./catalogue.js").CatalogueDeps & {
 *   components?: { Stage: () => Promise<any> },
 *   readEngineSource?: (path: string) => Promise<string | null>,
 *   readText?: (pluginId: string, path: string) => Promise<string | null>,
 * } | null} [deps]  tests only
 */
export async function load(event, deps = null) {
  const d = deps ?? (await createDeps(event));
  const id = viewIdFromParams(event.params.ns, event.params.view);
  const [row] = await loadCatalogue(d, { only: id });

  if (!row) throw error(404, `No view named '${id}' in this theme`);

  const query = parseStageQuery(event.url.searchParams, row.states);
  const { samples } = await samplesOf(d, row);
  const sample = await resolveSample(samples, query.state);

  // The theme's component (the override while it is valid) or the default one, whichever the page asks for.
  const resolved = await d.registry.resolveViewModule(id).catch(() => null);
  const View = !resolved ? null : query.source === "default" ? (d.registry.getDefault?.(id) ?? resolved.module.default) : resolved.module.default;
  const components = d.components ?? { Stage: () => import("./Stage.svelte") };

  const readSource = row.pluginId
    ? d.readText?.(row.pluginId, row.source)
    : d.readEngineSource?.(row.source);

  return {
    component: (await components.Stage()).default,
    id,
    row,
    ...query,
    sample,
    View,
    overridden: row.status === "overridden",
    missing: missingProps(row.props, sample?.props),
    eject: ejectCommand(id),
    sourceText: Promise.resolve(readSource ?? null).catch(() => null),
    // a bare stage drops the engine's chrome too (RootLayout skips MainLayout for `resetLayout`)
    resetLayout: query.bare,
    // the sample mode is rebuilt whenever one of these changes
    stageKey: `${id}|${query.state}|${query.source}`,
  };
}
