import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writable } from "svelte/store";

import { findSvelte } from "./engineParts.helper.js";
import { buildSidebarCases, openSession, renderAllSidebars, renderSidebarCase } from "./engineSidebars.helper.js";

// FX-05: the five sidebar cards (HomeSidebar, ProfileSidebar, SupportSidebar, PlayerDetailSidebar,
// TicketCreateAndDetailSidebar) are engine views of the registry, and the literal links of the engine components
// go through route().

// The registry reads SvelteKit's `dev` flag.
mock.module("$app/environment", () => ({ browser: false, dev: false }));

const registry = await import("../../registry/index.js");
const routes = await import("../../registry/routes.js");

const pkg = join(import.meta.dir, "..", "..", "..");
const lib = join(pkg, "src", "lib");
const read = (...parts) => readFileSync(join(...parts), "utf-8");
const svelteDir = findSvelte();

const SIDEBARS = ["HomeSidebar", "ProfileSidebar", "SupportSidebar", "PlayerDetailSidebar", "TicketCreateAndDetailSidebar"];

// The moved markup carries the engine's semantic `pano-*` classes (TC-57), which the snapshot (recorded before the
// split) does not have. Everything else is compared exactly: elements, attributes, text and the other classes. Two
// more things differ by construction: the controller wraps the part in a <svelte:component> (one extra level of
// hydration marker comments) and Svelte derives the scoped-style class from the file name.
const normalize = (html) =>
  html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/svelte-[a-z0-9]{4,8}/g, "svelte-H")
    .replace(/class="([^"]*)"/g, (_all, value) => `class="${value.split(/\s+/).filter((c) => c && !c.startsWith("pano-")).join(" ")}"`);

describe("engine sidebars: files and contract (FX-05)", () => {
  test("every card has a controller over a part file", () => {
    for (const name of SIDEBARS) {
      const controller = read(lib, "components", "sidebars", `${name}.svelte`);
      expect(existsSync(join(lib, "views", "parts", `${name}.svelte`))).toBe(true);
      expect(controller).toContain(`getOverride("${name}")`);
      expect(controller).toContain(`$pano/lib/views/parts/${name}.svelte`);
      // the part never imports a controller of a sidebar, and the controller keeps the module API
      expect(read(lib, "views", "parts", `${name}.svelte`)).not.toMatch(/import[^;]*components\/sidebars\/\w+Sidebar\.svelte/);
      expect(controller).toMatch(/export const load = async/);
    }
    expect(read(lib, "components", "sidebars", "TicketCreateAndDetailSidebar.svelte")).toMatch(/export const update = /);
  });

  test("skin-contract lists the five cards as component views of contract 1 with their props", () => {
    const contract = JSON.parse(read(pkg, "skin-contract.json"));
    for (const name of SIDEBARS) {
      const entry = contract.views[name];
      expect(entry).toBeDefined();
      expect(entry.kind).toBe("component");
      expect(entry.contract).toBe(1);
      expect(entry.source).toBe(`src/lib/views/parts/${name}.svelte`);

      // every `export let` of the part is listed, and nothing else
      const exported = [...read(lib, "views", "parts", `${name}.svelte`).matchAll(/export let (\w+)/g)].map((m) => m[1]);
      expect(Object.keys(entry.props).sort()).toEqual(exported.sort());
      // and the registry components list names them
      expect(contract.registry_components).toContain(name);
    }
    // PluginSidebar is not part of the contract
    expect(contract.views.PluginSidebar).toBeUndefined();
  });

  test("the generated engine table registers the five parts as defaults", () => {
    const table = read(lib, "views", "parts", "engine-views.generated.js");
    for (const name of SIDEBARS) expect(table).toContain(`"${name}": { contract: 1, component: () => import("./${name}.svelte")`);
  });

  test("no literal href=\"/...\" is left in the engine components or the parts", () => {
    const hits = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".svelte") && /href="\/[a-z]/.test(readFileSync(full, "utf-8"))) hits.push(full);
      }
    };
    walk(join(lib, "components"));
    walk(join(lib, "views"));
    expect(hits).toEqual([]);
  });
});

describe.skipIf(!svelteDir)("engine sidebars: default render is unchanged", () => {
  const expected = JSON.parse(read(import.meta.dir, "fixtures", "engine-sidebars.ssr.json"));
  /** @type {Record<string, string>} */
  let actual;

  beforeAll(async () => {
    registry.resetRegistryForTests();
    registry.setThemeConfig({});
    routes.setRouteConfig();
    actual = await renderAllSidebars(svelteDir);
  });

  test("the snapshot covers every case", () => {
    expect(Object.keys(actual).sort()).toEqual(Object.keys(buildSidebarCases()).sort());
    expect(Object.keys(expected).sort()).toEqual(Object.keys(buildSidebarCases()).sort());
  });

  for (const name of Object.keys(buildSidebarCases())) {
    test(`${name} renders the same HTML as before the split`, () => {
      expect(normalize(actual[name])).toBe(normalize(expected[name]));
    });
  }
});

describe.skipIf(!svelteDir)("engine sidebars: an override renders in place of the default", () => {
  const contract = JSON.parse(read(pkg, "skin-contract.json"));
  /** @type {string} */
  let dir;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "fx05-override-"));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    registry.resetRegistryForTests();
  });

  /** A server component written by hand (Svelte 5 server signature) so no compile step is needed. */
  const writeComponent = (file, body) => {
    writeFileSync(join(dir, file), `export default function Component($$renderer, $$props) {\n${body}\n}\n`);
  };

  const OVERRIDE = [
    "const keys = Object.keys($$props).sort().join(',');",
    "const store = (v) => typeof v?.subscribe === 'function';",
    "$$renderer.push(`<section class=\"custom-card\" data-side=\"${$$props.side}\" data-keys=\"${keys}\" data-items-store=\"${store($$props.items)}\" data-data-store=\"${store($$props.data)}\"></section>`);",
  ].join("\n");

  async function renderWithOverride(name, caseName) {
    registry.resetRegistryForTests();
    writeComponent(`${name}.default.mjs`, `$$renderer.push("<default/>");`);
    writeComponent(`${name}.override.mjs`, OVERRIDE);
    registry.registerEngineViews({ [name]: { contract: 1, component: () => import(join(dir, `${name}.default.mjs`)) } });
    registry.setThemeConfig({ views: { [name]: () => import(join(dir, `${name}.override.mjs`)) } });
    await registry.preloadViews([name]);
    expect(registry.getOverride(name)).not.toBeNull();

    return renderSidebarCase(svelteDir, undefined, buildSidebarCases()[caseName]);
  }

  const CASES = {
    HomeSidebar: "HomeSidebar/style-2",
    ProfileSidebar: "ProfileSidebar/default",
    SupportSidebar: "SupportSidebar/admins",
    PlayerDetailSidebar: "PlayerDetailSidebar/default",
    TicketCreateAndDetailSidebar: "TicketCreateAndDetailSidebar/open-ticket",
  };

  for (const name of SIDEBARS) {
    test(`an override of ${name} replaces the card and receives exactly the contract props`, async () => {
      const html = await renderWithOverride(name, CASES[name]);
      const keys = Object.keys(contract.views[name].props).sort().join(",");

      expect(html).toContain(`<section class="custom-card" data-side="right" data-keys="${keys}" data-items-store="true" data-data-store="true"></section>`);
      expect(html).not.toContain("vstack");
      expect(html).not.toContain("<default/>");
    });
  }

  test("without a loaded override the default card renders", async () => {
    registry.resetRegistryForTests();
    registry.setThemeConfig({});
    const html = await renderSidebarCase(svelteDir, undefined, buildSidebarCases()["HomeSidebar/style-2"]);

    expect(html).toContain("play.example.com");
    expect(html).toContain("vstack");
  });

  test("an override of Sidebar still wraps a default card (the part keeps using the engine's Sidebar)", async () => {
    registry.resetRegistryForTests();
    writeComponent("Sidebar.default.mjs", `$$renderer.push("<default/>");`);
    writeComponent("Sidebar.override.mjs", "$$renderer.push('<nav class=\"custom-sidebar\">'); $$props.children?.($$renderer); $$renderer.push('</nav>');");
    registry.registerEngineViews({ Sidebar: { contract: 1, component: () => import(join(dir, "Sidebar.default.mjs")) } });
    registry.setThemeConfig({ views: { Sidebar: () => import(join(dir, "Sidebar.override.mjs")) } });
    await registry.preloadViews(["Sidebar"]);

    const html = await renderSidebarCase(svelteDir, undefined, buildSidebarCases()["SupportSidebar/admins"]);

    expect(html).toContain('<nav class="custom-sidebar">');
    expect(html).toContain("online-admin-link");
  });
});

describe.skipIf(!svelteDir)("engine components: links go through route()", () => {
  const user = { username: "alex", panelAccess: false };
  const context = (sessionUser) =>
    new Map([
      ["themeSettings", {}],
      ["session", writable({ user: sessionUser, siteInfo: { hasRegisterAgreement: true } })],
    ]);

  async function render(entry, { props = {}, user: u, config } = {}) {
    routes.setRouteConfig(config);
    const session = await openSession({ svelteDir });
    try {
      return await session.render({ entry, props, context: context(u) });
    } finally {
      session.close();
      routes.setRouteConfig();
    }
  }

  const hrefs = (html) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);

  test("without a route config the Navbar links are the canonical paths", async () => {
    const out = hrefs(await render("$pano/lib/components/Navbar.svelte", { user }));

    for (const path of ["/profile", "/notifications", "/tickets", "/profile/settings", "/support", "/rules"]) expect(out).toContain(path);
  });

  test("with routes.rename { '/profile': '/me' } the Navbar profile link is /me", async () => {
    const out = hrefs(
      await render("$pano/lib/components/Navbar.svelte", { user, config: { routes: { rename: { "/profile": "/me" } } } }),
    );

    expect(out).toContain("/me");
    expect(out).not.toContain("/profile");
    // only the exact path is renamed
    expect(out).toContain("/profile/settings");
  });

  test("the Navbar login and register links follow a rename; the active mark follows too", async () => {
    const html = await render("$pano/lib/components/Navbar.svelte", {
      config: { routes: { rename: { "/login": "/sign-in", "/register": "/sign-up", "/support": "/help" } } },
    });
    const out = hrefs(html);

    expect(out).toContain("/sign-in");
    expect(out).toContain("/sign-up");
    expect(out).toContain("/help");
    expect(out).not.toContain("/login");
    expect(out).not.toContain("/register");
  });

  test("the online admins card and the last registrants link a player through route()", async () => {
    const config = { routes: { rename: { "/player/[name]": "/u/[name]" } } };

    const admins = await render("$pano/lib/components/OnlineAdmins.svelte", { props: { onlineAdmins: ["root"] }, config });
    expect(hrefs(admins)).toContain("/u/root");

    routes.setRouteConfig(config);
    try {
      const home = await renderSidebarCase(svelteDir, undefined, buildSidebarCases()["HomeSidebar/style-2"]);
      expect(hrefs(home)).toContain("/u/alex");
      expect(hrefs(home)).not.toContain("/player/alex");
    } finally {
      routes.setRouteConfig();
    }
  });

  test("the register form's rules link follows a rename", async () => {
    // the link sits in a translated string, which the i18n stub prints as JSON
    const rules = (html) => html.match(/<a class=\\"rounded focus-ring\\" href=\\"([^"\\]*)\\"/)?.[1];
    const base = await render("$pano/lib/components/RegisterForm.svelte", { user: undefined });
    const renamed = await render("$pano/lib/components/RegisterForm.svelte", {
      user: undefined,
      config: { routes: { rename: { "/rules": "/terms" } } },
    });

    expect(rules(base)).toBe("/rules");
    expect(rules(renamed)).toBe("/terms");
  });
});
