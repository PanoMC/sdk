import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writable } from "svelte/store";

import { buildCases, findSvelte, mainContext, renderAll, renderPart } from "./engineParts.helper.js";

// The registry reads SvelteKit's `dev` flag.
mock.module("$app/environment", () => ({ browser: false, dev: false }));

const registry = await import("../../registry/index.js");

const pkg = join(import.meta.dir, "..", "..", "..");
const lib = join(pkg, "src", "lib");
const read = (...parts) => readFileSync(join(...parts), "utf-8");
const svelteDir = findSvelte();

const PARTS = ["Main", "Sidebar", "Breadcrumb", "Post", "Posts", "Tickets", "TicketRow", "TicketStatus"];

// Two things differ by construction and nothing else: the controller wraps the part in a
// <svelte:component>, which adds one level of Svelte's hydration marker comments (<!--[--> ... <!--]-->),
// and Svelte derives the scoped-style class from the component file, so moving the Breadcrumb
// markup to a part file renames that one token. Elements, attributes and text are compared exactly.
const normalize = (html) => html.replace(/<!--[\s\S]*?-->/g, "").replace(/svelte-[a-z0-9]{4,8}/g, "svelte-H");

describe("engine parts: files and contract (TC-20)", () => {
  test("every part has a controller and a part file", () => {
    for (const name of PARTS) {
      const controller = read(lib, "components", `${name}.svelte`);
      expect(existsSync(join(lib, "views", "parts", `${name}.svelte`))).toBe(true);
      expect(controller).toContain(`getOverride("${name}")`);
      expect(controller).toContain(`$pano/lib/views/parts/${name}.svelte`);
    }
  });

  test("skin-contract lists the eight parts as component views of contract 1 with their props", () => {
    const contract = JSON.parse(read(pkg, "skin-contract.json"));
    for (const name of PARTS) {
      const entry = contract.views[name];
      expect(entry).toBeDefined();
      expect(entry.kind).toBe("component");
      expect(entry.contract).toBe(1);

      // every `export let` of the part is listed, and nothing else
      const exported = [...read(lib, "views", "parts", `${name}.svelte`).matchAll(/export let (\w+)/g)].map((m) => m[1]);
      expect(Object.keys(entry.props ?? {}).sort()).toEqual(exported.sort());
    }
  });

  test("a part imports no controller of itself and TicketStatuses stays exported from the controller", () => {
    expect(read(lib, "components", "TicketStatus.svelte")).toMatch(/export \{ TicketStatuses \}/);
    for (const name of PARTS) {
      expect(read(lib, "views", "parts", `${name}.svelte`)).not.toMatch(new RegExp(`import[^;]*components/${name}\\.svelte`));
    }
  });
});

describe.skipIf(!svelteDir)("engine parts: default render is unchanged", () => {
  const expected = JSON.parse(read(import.meta.dir, "fixtures", "engine-parts.ssr.json"));
  /** @type {Record<string, string>} */
  let actual;

  beforeAll(async () => {
    registry.resetRegistryForTests();
    registry.setThemeConfig({});
    actual = await renderAll(svelteDir);
  });

  test("the snapshot covers every case", () => {
    expect(Object.keys(actual).sort()).toEqual(Object.keys(buildCases()).sort());
    expect(Object.keys(expected).sort()).toEqual(Object.keys(buildCases()).sort());
  });

  for (const name of Object.keys(buildCases())) {
    test(`${name} renders the same HTML as before the split`, () => {
      expect(normalize(actual[name])).toBe(normalize(expected[name]));
    });
  }
});

describe.skipIf(!svelteDir)("engine parts: an override renders", () => {
  /** @type {string} */
  let dir;

  const registerPart = (name) => {
    // what the generated engine table registers: the part as the default of the view
    registry.registerEngineViews({ [name]: { contract: 1, component: () => import(join(dir, `${name}.default.mjs`)) } });
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "tc20-override-"));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    registry.resetRegistryForTests();
  });

  /** A server component written by hand (Svelte 5 server signature) so no compile step is needed. */
  const writeComponent = (file, body) => {
    writeFileSync(join(dir, file), `export default function Component($$renderer, $$props) {\n${body}\n}\n`);
  };

  async function renderWithOverride(name, overrideBody, entryProps, extra = {}, entry = name) {
    registry.resetRegistryForTests();
    writeComponent(`${name}.default.mjs`, `$$renderer.push("<default/>");`);
    writeComponent(`${name}.override.mjs`, overrideBody);
    registerPart(name);
    registry.setThemeConfig({ views: { [name]: () => import(join(dir, `${name}.override.mjs`)) } });
    await registry.preloadViews([name]);
    expect(registry.getOverride(name)).not.toBeNull();

    return renderPart({
      svelteDir,
      entry: `$pano/lib/components/${entry}.svelte`,
      props: entryProps,
      ...extra,
    });
  }

  test("an override of Posts replaces the list markup and receives posts", async () => {
    const html = await renderWithOverride(
      "Posts",
      "$$renderer.push(`<ol class=\"custom-posts\">${$$props.posts.map((p) => `<li>${p.title}</li>`).join(\"\")}</ol>`);",
      { posts: [{ title: "A" }, { title: "B" }] },
      { context: new Map([["themeSettings", {}]]) },
    );

    expect(html).toContain('<ol class="custom-posts"><li>A</li><li>B</li></ol>');
    expect(html).not.toContain("row g-3");
  });

  test("without a loaded override the default part renders", async () => {
    registry.resetRegistryForTests();
    registry.setThemeConfig({});
    const html = await renderPart({
      svelteDir,
      entry: "$pano/lib/components/Posts.svelte",
      props: { posts: [] },
      context: new Map([["themeSettings", {}]]),
    });

    expect(html).toContain("row g-3");
  });

  test("an override of Main receives the resolved props and the slot", async () => {
    const html = await renderWithOverride(
      "Main",
      [
        "const title = $$props.resolvedTitle.title;",
        "$$renderer.push(`<div class=\"custom-main\" data-title=\"${title}\" data-pos=\"${$$props.sidebarPosition}\" data-enabled=\"${$$props.sidebarEnabled}\">`);",
        "$$props.children?.($$renderer);",
        "$$renderer.push(`</div>`);",
      ].join("\n"),
      {},
      {
        context: mainContext({ pageTitle: "home.title", sidebarProps: { side: "left" } }),
        slot: `<p id="slot">content</p>`,
      },
    );

    expect(html).toContain('class="custom-main" data-title="home.title" data-pos="LEFT" data-enabled="true"');
    expect(html).toContain('<p id="slot">content</p>');
  });

  test("an override of TicketRow renders inside Tickets and gets the close handler", async () => {
    const html = await renderWithOverride(
      "TicketRow",
      "$$renderer.push(`<tr class=\"custom-row\" data-close=\"${typeof $$props.onCloseTicket}\"><td>${$$props.ticket.title}</td></tr>`);",
      { tickets: [{ id: 1, title: "T1", status: "NEW", category: { title: "-", url: "x" }, lastUpdate: "1" }] },
      {},
      "Tickets",
    );

    expect(html).toContain('<tr class="custom-row" data-close="function"><td>T1</td></tr>');
    expect(html).toContain("table table-hover");
  });
});
