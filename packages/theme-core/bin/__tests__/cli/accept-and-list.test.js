import { describe, expect, test } from "bun:test";
import { cleanupAfterAll, cli, exists, importConfig, makeTheme, read, themeWithMarket, write } from "./helpers.js";

cleanupAfterAll();

const OUTDATED_CONFIG = `export default {
  views: {
    "market:ProductCard": {
      contract: 1,
      controllers: ["market/cart"],
      component: () => import("./src/views/market/ProductCard.svelte"),
    },
  },
  controllers: { "market/cart": 1, "market/format": 1 },
};
`;

/** A theme whose ProductCard override was made for contract 1 while the plugin is on contract 2, cart 3. */
function outdatedTheme() {
  const { theme } = themeWithMarket({ config: OUTDATED_CONFIG, packageOptions: { productCardContract: 2, cartVersion: 3 } });
  write(theme, "src/views/market/ProductCard.svelte", "<div>mine</div>\n");
  write(theme, "src/views/market/ProductCard.svelte.new", "<div>plugin</div>\n");
  return theme;
}

describe("accept", () => {
  test("sets contract to the snapshot's, re-pins the override's controllers and deletes .new", async () => {
    const theme = outdatedTheme();
    const run = cli(theme, ["accept", "market:ProductCard"]);
    expect(run.code).toBe(0);
    expect(run.out).toContain("market:ProductCard now targets contract 2");
    expect(run.out).toContain("market/cart");

    const config = await importConfig(theme);
    expect(config.views["market:ProductCard"].contract).toBe(2);
    // only the controllers the override names are re-pinned
    expect(config.controllers).toEqual({ "market/cart": 3, "market/format": 1 });
    expect(config.views["market:ProductCard"].controllers).toEqual(["market/cart"]);
    expect(exists(theme, "src/views/market/ProductCard.svelte.new")).toBe(false);
    expect(read(theme, "src/views/market/ProductCard.svelte")).toBe("<div>mine</div>\n");
  });

  test("works from a snapshot alone (the plugin is not installed)", async () => {
    const theme = outdatedTheme();
    cli(theme, ["contracts", "pull"]);
    cli(theme, ["accept", "market:ProductCard"]);
    // reset and remove plugins/
    write(theme, "theme.config.js", OUTDATED_CONFIG);
    const { rmSync } = await import("node:fs");
    rmSync(`${theme}/plugins`, { recursive: true });

    const run = cli(theme, ["accept", "market:ProductCard"]);
    expect(run.code).toBe(0);
    expect((await importConfig(theme)).views["market:ProductCard"].contract).toBe(2);
  });

  test("a bare thunk entry becomes the object form", async () => {
    const config = `export default {
  views: {
    "market:PriceTag": () => import("./src/views/market/PriceTag.svelte"),
  },
};
`;
    const { theme } = themeWithMarket({ config });
    write(theme, "src/views/market/PriceTag.svelte", "<span></span>\n");
    expect(cli(theme, ["accept", "market:PriceTag"]).code).toBe(0);
    const loaded = await importConfig(theme);
    expect(loaded.views["market:PriceTag"].contract).toBe(1);
    expect(typeof loaded.views["market:PriceTag"].component).toBe("function");
  });

  test("an entry without contract gets one", async () => {
    const config = `export default {
  views: {
    "market:ProductCard": { component: () => import("./src/views/market/ProductCard.svelte") },
  },
};
`;
    const { theme } = themeWithMarket({ config, packageOptions: { productCardContract: 4 } });
    expect(cli(theme, ["accept", "market:ProductCard"]).code).toBe(0);
    expect((await importConfig(theme)).views["market:ProductCard"].contract).toBe(4);
  });

  test("an engine view takes the engine contract", async () => {
    const config = `export default {\n  views: {\n    LoginView: { contract: 0, component: () => import("./src/views/LoginView.svelte") },\n  },\n};\n`;
    const theme = makeTheme({ config });
    write(theme, "src/views/LoginView.svelte.new", "x");
    expect(cli(theme, ["accept", "LoginView"]).code).toBe(0);
    expect((await importConfig(theme)).views.LoginView.contract).toBe(1);
    expect(exists(theme, "src/views/LoginView.svelte.new")).toBe(false);
  });

  test("a view that is not overridden is an error", () => {
    const { theme } = themeWithMarket();
    const run = cli(theme, ["accept", "market:ProductCard"]);
    expect(run.code).toBe(1);
    expect(run.out).toContain("not overridden");
  });

  test("a view the plugin removed, an unknown plugin and a missing argument are errors", () => {
    const theme = outdatedTheme();
    expect(cli(theme, ["accept", "market:Gone"]).out).toContain("not in the snapshot");
    expect(cli(theme, ["accept", "shop:Thing"]).out).toContain("no snapshot for 'shop'");
    expect(cli(theme, ["accept"]).out).toContain("usage");
  });
});

describe("list-views", () => {
  test("marks overridden and outdated views, engine and plugin", async () => {
    const config = `export default {
  views: {
    LoginView: () => import("./src/views/LoginView.svelte"),
    "market:ProductCard": { contract: 1, component: () => import("./src/views/market/ProductCard.svelte") },
    "market:PriceTag": { contract: 1, component: () => import("./src/views/market/PriceTag.svelte") },
    "market:Ghost": { contract: 1, component: () => import("./src/views/market/Ghost.svelte") },
  },
};
`;
    const { theme } = themeWithMarket({ config, packageOptions: { productCardContract: 2 } });
    const run = cli(theme, ["list-views", "--json"]);
    expect(run.code).toBe(0);
    const result = JSON.parse(run.stdout);

    const login = result.engine.find((v) => v.id === "LoginView");
    expect(login).toMatchObject({ contract: 1, overridden: true, outdated: false });
    expect(result.engine.find((v) => v.id === "RulesView").overridden).toBe(false);

    const byId = Object.fromEntries(result.plugins.map((v) => [v.id, v]));
    expect(byId["market:ProductCard"]).toMatchObject({ contract: 2, overridden: true, outdated: true, overrideContract: 1, kind: "component" });
    expect(byId["market:PriceTag"]).toMatchObject({ contract: 1, overridden: true, outdated: false });
    expect(byId["market:StorePage"]).toMatchObject({ overridden: false, kind: "page", page: "/store", pluginId: "pano-plugin-market" });
    expect(result.unknown).toEqual(["market:Ghost"]);
  });

  test("pulls a missing snapshot first and prints the plain list", () => {
    const { theme } = themeWithMarket();
    expect(exists(theme, "plugin-contracts/market/views.json")).toBe(false);
    const run = cli(theme, ["list-views"]);
    expect(run.code).toBe(0);
    expect(exists(theme, "plugin-contracts/market/views.json")).toBe(true);
    expect(run.stdout).toContain("Engine views");
    expect(run.stdout).toContain("Plugin views");
    expect(run.stdout).toContain("market:ProductCard contract 1");
    expect(run.stdout).toContain("market:StorePage contract 1 page /store");
  });

  test("text output carries the overridden marks", () => {
    const { theme } = themeWithMarket({ config: OUTDATED_CONFIG, packageOptions: { productCardContract: 2 } });
    const run = cli(theme, ["list-views"]);
    expect(run.stdout).toContain("market:ProductCard contract 2 component overridden (contract 1, outdated)");
  });

  test("a theme without plugins still lists the engine views", () => {
    const run = cli(makeTheme(), ["list-views"]);
    expect(run.code).toBe(0);
    expect(run.stdout).toContain("LoginView contract 1");
    expect(run.stdout).toContain("install a plugin");
  });
});
