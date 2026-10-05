/**
 * Pure helpers for the `sidebar` a plugin page's `load` may return (market plugin spec 15 section 4.5).
 *
 * A plugin page returns either a component (unchanged behaviour) or a string:
 *   "home" | "profile"       the host sidebar of that id (its own `load(event)` is run)
 *   "plugin:<sidebarId>"     the generic engine sidebar rendering the slot `<sidebarId>`
 * Anything else is rejected (`player-detail`, `support`, `ticket` need page data).
 *
 * Kept free of SvelteKit / Svelte imports so it can be tested with `bun test`; the route module
 * (`routes/plugin-ui/Page.svelte`) injects the real sidebars and the slot registry.
 */

export const SIDEBAR_ID_PATTERN = /^[a-z0-9][a-z0-9:-]{0,63}$/;

const HOST_SIDEBAR_IDS = ["home", "profile"];
const PLUGIN_PREFIX = "plugin:";

/**
 * Classifies a `sidebar` value.
 * @param {unknown} sidebar
 * @returns {{ kind: "component" } | { kind: "host", id: "home" | "profile" } | { kind: "plugin", sidebarId: string } | { kind: "invalid", value: string }}
 */
export function parseSidebarSpec(sidebar) {
  if (typeof sidebar !== "string") return { kind: "component" };

  if (HOST_SIDEBAR_IDS.includes(sidebar)) return { kind: "host", id: sidebar };

  if (sidebar.startsWith(PLUGIN_PREFIX)) {
    const sidebarId = sidebar.slice(PLUGIN_PREFIX.length);
    if (SIDEBAR_ID_PATTERN.test(sidebarId)) return { kind: "plugin", sidebarId };
  }

  return { kind: "invalid", value: sidebar };
}

/**
 * Resolves a string `sidebar` into the `{ sidebar, sidebarProps }` pair for the page data.
 * Returns `null` when the value is not a string (the caller leaves the output unchanged).
 *
 * @param {object} args
 * @param {unknown} args.sidebar  the value the plugin page returned
 * @param {object} [args.sidebarProps]  the `sidebarProps` the plugin page returned
 * @param {object} args.event  the SvelteKit load event
 * @param {{ home: object, profile: object }} args.hosts  host sidebar modules (`default` + `load`)
 * @param {object} args.PluginSidebar  the engine sidebar component
 * @param {(sidebarId: string, event: object) => Promise<unknown>} args.executeSidebarLoad
 * @param {(sidebarId: string) => number} args.countVisible  number of visible items in the slot
 * @param {(...args: unknown[]) => void} [args.warn]
 * @returns {Promise<null | { sidebar: object | null, sidebarProps?: object }>}
 */
export async function resolveSidebarSpec({
  sidebar,
  sidebarProps,
  event,
  hosts,
  PluginSidebar,
  executeSidebarLoad,
  countVisible,
  warn = console.warn,
}) {
  const spec = parseSidebarSpec(sidebar);

  if (spec.kind === "component") return null;

  if (spec.kind === "host") {
    const module = hosts[spec.id];
    if (typeof module.load === "function") await module.load(event);

    return { sidebar: module.default };
  }

  if (spec.kind === "plugin") {
    await executeSidebarLoad(spec.sidebarId, event);

    if (countVisible(spec.sidebarId) === 0) {
      // Zero items: no sidebar, the content takes the full width.
      return { sidebar: null, sidebarProps: {} };
    }

    return {
      sidebar: PluginSidebar,
      sidebarProps: { ...(sidebarProps || {}), sidebarId: spec.sidebarId },
    };
  }

  warn(
    `[plugin-ui] Unsupported sidebar "${spec.value}" returned by a plugin page; ` +
      `use a component, "home", "profile" or "plugin:<sidebarId>".`,
  );

  return { sidebar: null, sidebarProps: {} };
}
