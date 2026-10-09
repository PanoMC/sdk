import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { writable } from "svelte/store";

// Server-renders the engine's sidebar cards (FX-05) and the Navbar with a small module graph, like
// engineParts.helper.js: `.svelte` files are compiled from `root` (an overlay of `src/` that falls back to the
// real package), plain `.js` files are imported from the real package, and everything that needs SvelteKit, the
// plugin runtime or the network is a stub. The same graph renders a copy of the sources from before the split
// (to record the snapshot) and the working tree.

const pkgDir = resolve(import.meta.dir, "..", "..", "..");

/** State of the stubbed plugin runtime and API, reachable through `session.module(specifier)`. */
const PLUGIN_API = `import { readable, writable } from "svelte/store";
export const sidebarItems = {};
export const navItems = writable([]);
export const dropdownItems = writable([]);
export const rightItems = writable([]);
export const siteLinks = writable([]);
const sidebar = (id) => (sidebarItems[id] ??= writable([]));
const edit = (store) => (callback) => store.update((list) => { const copy = [...list]; callback(copy); return copy; });
export const panoApi = {
  ui: {
    sidebar: {
      register: ({ sidebarId, ...item }) => sidebar(sidebarId).update((list) => [...list.filter((i) => i.id !== item.id), item].sort((a, b) => b.priority - a.priority)),
      get: (id) => sidebar(id),
    },
    profile: { nav: { edit: edit(navItems), get: () => navItems } },
  },
};
export const panoApiClient = {
  ui: {
    nav: {
      site: { getNavLinks: () => siteLinks },
      rightComponents: { edit: edit(rightItems), get: () => rightItems },
      profileDropdown: { edit: edit(dropdownItems), get: () => dropdownItems },
    },
  },
};
export const executeSidebarLoad = async () => {};`;

const STUB_JS = {
  "svelte-i18n": `import { readable } from "svelte/store";
export const _ = readable((key, options) => (options && options.values && Object.keys(options.values).length ? key + JSON.stringify(options.values) : key));`,
  "$app/environment": `export const dev = false; export const browser = false;`,
  "$app/stores": `import { readable } from "svelte/store"; export const page = readable({ url: { pathname: "/profile" } });`,
  "$app/paths": `export const base = "";`,
  "copy-to-clipboard": `export default function copy() {}`,
  "$pano/lib/tooltip.util": `export default function tooltip() {}`,
  "$pano/lib/Store": `import { readable } from "svelte/store";
export const avatarVersion = readable("v7");
export const notificationsCount = readable(2);
export const logout = async () => {};`,
  "$pano/lib/PluginAPI": PLUGIN_API,
  "$pano/lib/PluginAPI.js": PLUGIN_API,
  "$pano/lib/api.util.js": `export const responses = {};
export default { get: async ({ path }) => responses[path] ?? {} };`,
  "$pano/lib/auth.util.js": `export const hasPermission = () => true;`,
};

/** Components that need the network, the browser or packages the temp folder cannot resolve. */
const STUB_SVELTE = {
  "$pano/lib/components/ViewComponent.svelte": `{#if component && typeof component !== 'function'}\n  {@const Component = component.default || component}\n  <Component {...rest} />\n{/if}\n<script>\n  let { component, ...rest } = $props();\n</script>`,
  "$pano/lib/components/PlayerHead.svelte": `<img class="player-head-stub" alt={username} data-check="{checkTime}" data-in-game="{inGame}" />\n<script>export let username; export let inGame = false; export let banned = false; export let lastActivityTime = 0; export let checkTime = 0; export let width = ""; export let height = "";</script>`,
  "$pano/lib/components/PlayerStatusBadge.svelte": `<span class="player-status-stub" data-banned="{banned}" data-in-game="{inGame}"></span>\n<script>export let banned = false; export let inGame = false; export let lastActivityTime = 0; export let checkTime = 0;</script>`,
  "$pano/lib/components/PlayerPermissionBadge.svelte": `<span class="player-permission-stub">{permissionGroupName}</span>\n<script>export let permissionGroupName = "";</script>`,
  "$pano/lib/components/modals/ConfirmRemoveAllNotificationsModal.svelte": `<script context="module">export const show = () => {};</script>`,
  "$pano/lib/components/modals/CloseTicketConfirmModal.svelte": `<script context="module">export const show = () => {};</script>`,
  "$pano/lib/components/Date.svelte": `<span class="date-stub">{time}</span>\n<script>export let time;</script>`,
};

/**
 * @param {object} args
 * @param {string} args.svelteDir
 * @param {string} [args.root]  folder with a `src/lib/...` overlay (default: the real package)
 * @param {Record<string, string>} [args.extraJs]  specifier -> JS source (stubs for one test)
 * @param {Record<string, string>} [args.extraSvelte]  specifier -> .svelte source
 */
export async function openSession({ svelteDir, root = pkgDir, extraJs = {}, extraSvelte = {} }) {
  const compiler = await import(join(svelteDir, "src", "compiler", "index.js"));
  const dir = mkdtempSync(join(tmpdir(), "fx05-ssr-"));
  mkdirSync(join(dir, "node_modules"));
  symlinkSync(svelteDir, join(dir, "node_modules", "svelte"), "dir");

  const stubJs = { ...STUB_JS, ...extraJs };
  const stubSvelte = { ...STUB_SVELTE, ...extraSvelte };

  /** @type {Map<string, string>} */
  const written = new Map();
  let counter = 0;

  const fromPackage = (rel) => join(pkgDir, "src", rel);

  function locate(specifier, importerDir) {
    if (specifier in stubJs) return { kind: "js", source: stubJs[specifier], file: `stub:${specifier}` };
    if (specifier in stubSvelte) return { kind: "svelte", source: stubSvelte[specifier], file: `stub:${specifier}` };

    let candidates = [];
    if (specifier.startsWith("$pano/")) {
      const rel = specifier.slice("$pano/".length);
      candidates = [join(root, "src", rel), fromPackage(rel)];
    } else if (specifier.startsWith(".") || isAbsolute(specifier)) {
      // a file of the overlay finds its neighbours in the package when the overlay does not carry them
      candidates = [resolve(importerDir, specifier), resolve(importerDir.replace(root, pkgDir), specifier)];
    } else {
      return { kind: "bare" };
    }

    for (const candidate of candidates) {
      const file = existsSync(candidate) ? candidate : existsSync(candidate + ".js") ? candidate + ".js" : null;
      if (file) return { kind: file.endsWith(".svelte") ? "svelte" : "js", file };
    }
    throw new Error(`cannot resolve ${specifier} from ${importerDir}`);
  }

  function emit(loc, specifier) {
    if (loc.kind === "bare") return specifier;
    if (loc.kind === "js" && !loc.file.startsWith("stub:")) return loc.file;

    const key = loc.file;
    if (written.has(key)) return written.get(key);

    const out = join(dir, `m${counter++}.mjs`);
    written.set(key, out);

    let code;
    let sourceDir = pkgDir;
    if (loc.kind === "svelte") {
      const source = loc.source ?? readFileSync(loc.file, "utf-8");
      if (!loc.file.includes(":")) sourceDir = dirname(loc.file);
      code = compiler.compile(source, { generate: "server", filename: loc.file.includes(":") ? "Part.svelte" : loc.file.split("/").pop() }).js.code;
    } else {
      code = loc.source;
    }

    code = code.replace(/(from\s+|import\s+)(["'])([^"']+)\2/g, (whole, lead, _quote, spec) => {
      if (spec.startsWith("svelte/") || spec === "svelte") return whole;
      return `${lead}${JSON.stringify(emit(locate(spec, sourceDir), spec))}`;
    });
    writeFileSync(out, code);
    return out;
  }

  return {
    /** The compiled module of a specifier (a controller's `load`, a stub's state). */
    async module(specifier) {
      return import(emit(locate(specifier, pkgDir), specifier));
    },

    /**
     * @param {object} args
     * @param {string} args.entry  specifier of the component to render
     * @param {object} [args.props]
     * @param {Map<any, any>} [args.context]
     * @param {string} [args.slot]
     */
    async render({ entry, props = {}, context, slot }) {
      const harness = `<script>
  import Part from ${JSON.stringify(entry)};
  export let props = {};
</script>
${slot === undefined ? "<Part {...props} />" : `<Part {...props}>${slot}</Part>`}`;
      const file = emit({ kind: "svelte", source: harness, file: "stub:harness" }, "harness");
      const { default: Component } = await import(file);
      const { render } = await import(join(svelteDir, "src", "server", "index.js"));

      return render(Component, { props: { props }, ...(context ? { context } : {}) }).body;
    },

    close() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** A hand-written server component (Svelte 5 server signature) a plugin would inject as a sidebar item. */
export function pluginItemComponent($$renderer, $$props) {
  $$renderer.push(`<div class="plugin-item" data-extra="${$$props.extra ?? ""}" data-keys="${Object.keys($$props).sort().join(",")}"></div>`);
}

const wrap = (id, extra = {}) => ({ id, priority: 50, component: { default: pluginItemComponent }, props: { extra: id }, ...extra });

const settings = (extra = {}) => new Map([["themeSettings", extra]]);
const session = (user, themeSettings = {}) => new Map([["themeSettings", themeSettings], ["session", writable({ user, siteInfo: {} })]]);

/**
 * The cases of the snapshot: stable names; `setup(modules)` prepares the stubbed runtime and API, `context()` builds
 * the render context. Everything is plain data apart from the injected plugin component.
 */
export function buildSidebarCases() {
  const HOME = "$pano/lib/components/sidebars/HomeSidebar.svelte";
  const PROFILE = "$pano/lib/components/sidebars/ProfileSidebar.svelte";
  const SUPPORT = "$pano/lib/components/sidebars/SupportSidebar.svelte";
  const PLAYER = "$pano/lib/components/sidebars/PlayerDetailSidebar.svelte";
  const TICKET = "$pano/lib/components/sidebars/TicketCreateAndDetailSidebar.svelte";

  const home = {
    mainServer: { status: "ONLINE", playerCount: 3, maxPlayerCount: 20 },
    serverGameVersion: "1.21",
    ipAddress: "play.example.com",
    lastRegisteredUsers: [
      { username: "alex", lastActivityTime: 1, inGame: false },
      { username: "steve", lastActivityTime: 1, inGame: true },
    ],
  };
  const profileData = { lastActivityTime: 1, inGame: false, permissionGroupName: "Member", isBanned: false };
  const ticket = (status) => ({ id: 5, title: "T", status });

  return {
    "HomeSidebar/style-2": { entry: HOME, kind: "home", api: { "/sidebars/home": home }, context: () => settings(), props: { side: "right" } },
    "HomeSidebar/style-1-settings": {
      entry: HOME,
      kind: "home",
      api: { "/sidebars/home": { ...home, mainServer: { status: "OFFLINE" } } },
      context: () =>
        settings({
          playCardStyle: "style-1",
          playCardBgEffect: "gradient",
          playCardBorderColor: "border-danger",
          playCardIpColor: "warning",
          playCardIpText: "mc.custom-network.example.org",
          playCardBgOpacity: 0.3,
          playCardVersionInfo: false,
          defaultHeaderBg: false,
          defaultPlayCardBg: false,
          files: { playCardBackgroundImage: "bg.png" },
          headerBgImagePosition: "top",
        }),
      props: { side: "left" },
    },
    "HomeSidebar/style-2-minimal-and-hidden-registrants": {
      entry: HOME,
      kind: "home",
      api: { "/sidebars/home": home },
      context: () => settings({ playCardStatusBadge: false, playCardPlayerCount: false, sidebarCarts: { lastRegistrants: false } }),
      props: { side: "right" },
    },
    "HomeSidebar/plugin-item": {
      entry: HOME,
      kind: "home",
      api: { "/sidebars/home": home },
      items: { home: [wrap("shop-teaser", { priority: 70 })] },
      context: () => settings(),
      props: { side: "right" },
    },
    "ProfileSidebar/default": {
      entry: PROFILE,
      kind: "profile",
      api: { "/sidebars/profile": profileData },
      context: () => session({ username: "alex" }),
      props: { side: "right" },
    },
    "ProfileSidebar/delete-all-and-plugin-item": {
      entry: PROFILE,
      kind: "profile",
      api: { "/sidebars/profile": { ...profileData, inGame: true, isBanned: true } },
      items: { profile: [wrap("badges", { priority: 90 })] },
      context: () => session({ username: "alex" }),
      props: { side: "left", showDeleteAll: true },
    },
    "ProfileSidebar/visitor": {
      entry: PROFILE,
      kind: "profile",
      api: { "/sidebars/profile": profileData },
      context: () => session(undefined),
      props: { side: "right" },
    },
    "SupportSidebar/admins": {
      entry: SUPPORT,
      kind: "support",
      api: { "/sidebars/support": { items: ["root", "mod"] } },
      context: () => settings(),
      props: { side: "right" },
    },
    "SupportSidebar/no-admins-plugin-item": {
      entry: SUPPORT,
      kind: "support",
      api: { "/sidebars/support": { items: [] } },
      items: { support: [wrap("faq", { priority: 60 })] },
      context: () => settings({ sidebarCarts: { onlineAdmins: false } }),
      props: { side: "left" },
    },
    "PlayerDetailSidebar/default": {
      entry: PLAYER,
      kind: "player",
      params: { player: "steve" },
      api: { "/sidebars/profile/steve": { lastActivityTime: 1, inGame: true, permissionGroupName: "VIP", banned: false } },
      context: () => settings(),
      props: { side: "right" },
    },
    "PlayerDetailSidebar/banned-plugin-item": {
      entry: PLAYER,
      kind: "player",
      params: { player: "alex" },
      api: { "/sidebars/profile/alex": { lastActivityTime: 1, inGame: false, permissionGroupName: "", banned: true } },
      items: { "player-detail": [wrap("stats", { priority: 60 })] },
      context: () => settings(),
      props: { side: "left" },
    },
    "TicketCreateAndDetailSidebar/open-ticket": {
      entry: TICKET,
      kind: "ticket",
      api: { "/sidebars/support": { items: ["root"] } },
      ticket: ticket("NEW"),
      context: () => settings(),
      props: { side: "right" },
    },
    "TicketCreateAndDetailSidebar/closed-ticket": {
      entry: TICKET,
      kind: "ticket",
      api: { "/sidebars/support": { items: [] } },
      ticket: ticket("CLOSED"),
      context: () => settings(),
      props: { side: "right" },
    },
    "TicketCreateAndDetailSidebar/create-page-plugin-item": {
      entry: TICKET,
      kind: "ticket",
      api: { "/sidebars/support": { items: ["root"] } },
      items: { ticket: [wrap("ticket-help", { priority: 105 })] },
      context: () => settings(),
      props: { side: "left" },
    },
  };
}

/** Renders every sidebar case against `root`, each in a fresh module graph (the controllers keep state at module level). */
export async function renderAllSidebars(svelteDir, root) {
  const out = {};
  for (const [name, c] of Object.entries(buildSidebarCases())) {
    out[name] = await renderSidebarCase(svelteDir, root, c);
  }
  return out;
}

export async function renderSidebarCase(svelteDir, root, c, { props = {} } = {}) {
  const session = await openSession({ svelteDir, root });
  try {
    const api = await session.module("$pano/lib/api.util.js");
    Object.assign(api.responses, c.api);
    const runtime = await session.module("$pano/lib/PluginAPI");
    for (const [id, list] of Object.entries(c.items ?? {})) {
      for (const item of list) runtime.panoApi.ui.sidebar.register({ sidebarId: id, ...item });
    }
    const controller = await session.module(c.entry);
    await controller.load({ params: c.params ?? {} }, c.ticket);

    return await session.render({ entry: c.entry, props: { ...c.props, ...props }, context: c.context() });
  } finally {
    session.close();
  }
}
