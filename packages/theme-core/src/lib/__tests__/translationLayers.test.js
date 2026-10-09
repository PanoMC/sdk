import { describe, expect, test } from "bun:test";
import { mergeTranslationLayers } from "../translationLayers.js";

const KEY = "plugins.pano-plugin-market.theme.store.title";
const plugins = [{ id: "pano-plugin-market", namespace: "market" }];

/** The worked example of doc 03 section 5.3. */
function layers({ plugin, themeOverride, admin }) {
  const tree = (value) => ({ theme: { store: { title: value } } });

  return {
    theme: {},
    themePlugins: themeOverride ? { market: tree(themeOverride) } : {},
    api: { plugins: { "pano-plugin-market": tree(admin ?? plugin) } },
    pluginAdminKeys: admin ? { "pano-plugin-market": ["theme.store.title"] } : {},
    plugins,
  };
}

describe("mergeTranslationLayers", () => {
  test("section 5.3 table", () => {
    expect(mergeTranslationLayers(layers({ plugin: "Mağaza" }))[KEY]).toBe("Mağaza");
    expect(mergeTranslationLayers(layers({ plugin: "Mağaza", themeOverride: "Dükkan" }))[KEY]).toBe("Dükkan");
    expect(mergeTranslationLayers(layers({ plugin: "Mağaza", themeOverride: "Dükkan", admin: "Market" }))[KEY]).toBe("Market");
    expect(mergeTranslationLayers(layers({ plugin: "Mağaza", admin: "Market" }))[KEY]).toBe("Market");
  });

  test("theme file beats plugin default, admin beats theme file, per key", () => {
    const result = mergeTranslationLayers({
      theme: { theme: { nav: { home: "Theme home", about: "Theme about" } }, a: "theme-a" },
      themePlugins: {},
      api: { theme: { nav: { home: "Admin home" } }, plugins: {} },
      plugins: [],
    });

    expect(result).toEqual({
      "theme.nav.home": "Admin home",
      "theme.nav.about": "Theme about",
      a: "theme-a",
    });
  });

  test("result is flat and keyed plugins.<id>.<key>", () => {
    const result = mergeTranslationLayers({
      theme: { hello: "Hi" },
      themePlugins: {},
      api: { plugins: { "pano-plugin-market": { a: { b: "1" }, c: "2" } } },
      plugins,
    });

    expect(result).toEqual({
      hello: "Hi",
      "plugins.pano-plugin-market.a.b": "1",
      "plugins.pano-plugin-market.c": "2",
    });
  });

  test("missing pluginAdminKeys (older backend): every plugin key is layer 1, theme override still wins", () => {
    const result = mergeTranslationLayers({
      theme: {},
      themePlugins: { market: { x: "theme" } },
      api: { plugins: { "pano-plugin-market": { x: "api", y: "api-y" } } },
      plugins,
    });

    expect(result["plugins.pano-plugin-market.x"]).toBe("theme");
    expect(result["plugins.pano-plugin-market.y"]).toBe("api-y");
  });

  test("admin keys list only wins for its own plugin and key", () => {
    const result = mergeTranslationLayers({
      theme: {},
      themePlugins: { market: { a: "theme-a", b: "theme-b" }, tickets: { a: "theme-t" } },
      api: { plugins: { "pano-plugin-market": { a: "admin-a", b: "api-b" }, "pano-plugin-tickets": { a: "api-t" } } },
      pluginAdminKeys: { "pano-plugin-market": ["a"] },
      plugins: [...plugins, { id: "pano-plugin-tickets", namespace: "tickets" }],
    });

    expect(result["plugins.pano-plugin-market.a"]).toBe("admin-a");
    expect(result["plugins.pano-plugin-market.b"]).toBe("theme-b");
    expect(result["plugins.pano-plugin-tickets.a"]).toBe("theme-t");
  });

  test("a dotted plugin id stays one segment of the flat key", () => {
    const result = mergeTranslationLayers({
      theme: {},
      themePlugins: { "my.plugin": { greeting: "theme" } },
      api: { plugins: { "my.plugin": { greeting: "api", farewell: "bye" } } },
      plugins: [{ id: "my.plugin", namespace: "my.plugin" }],
    });

    expect(result).toEqual({
      "plugins.my.plugin.greeting": "theme",
      "plugins.my.plugin.farewell": "bye",
    });
  });

  test("theme folders: namespace and full id both resolve, the id folder wins, unknown folders are ignored", () => {
    const result = mergeTranslationLayers({
      theme: {},
      themePlugins: {
        market: { a: "by-namespace", b: "by-namespace" },
        "pano-plugin-market": { a: "by-id" },
        nobody: { a: "lost" },
      },
      api: { plugins: {} },
      plugins,
    });

    expect(result).toEqual({
      "plugins.pano-plugin-market.a": "by-id",
      "plugins.pano-plugin-market.b": "by-namespace",
    });
  });

  test("a theme plugin file may add keys the plugin does not have", () => {
    const result = mergeTranslationLayers({
      theme: {},
      themePlugins: { market: { extra: { label: "New" } } },
      api: { plugins: { "pano-plugin-market": { a: "1" } } },
      plugins,
    });

    expect(result["plugins.pano-plugin-market.extra.label"]).toBe("New");
    expect(result["plugins.pano-plugin-market.a"]).toBe("1");
  });

  test("arrays and non-string leaves are kept as leaves", () => {
    const result = mergeTranslationLayers({
      theme: { list: ["a", "b"], n: 3 },
      themePlugins: {},
      api: { plugins: {} },
      plugins: [],
    });

    expect(result).toEqual({ list: ["a", "b"], n: 3 });
  });

  test("missing or empty layers give an empty dictionary; prototype keys are skipped", () => {
    expect(mergeTranslationLayers({})).toEqual({});
    expect(mergeTranslationLayers(undefined)).toEqual({});

    const result = mergeTranslationLayers({ theme: JSON.parse('{"__proto__":{"x":"1"},"ok":"y"}') });
    expect(result).toEqual({ ok: "y" });
    expect({}.x).toBeUndefined();
  });

  test("does not change its input", () => {
    const input = {
      theme: { a: { b: "1" } },
      themePlugins: { market: { c: "2" } },
      api: { plugins: { "pano-plugin-market": { c: "3" } } },
      pluginAdminKeys: { "pano-plugin-market": ["c"] },
      plugins,
    };
    const copy = structuredClone(input);

    mergeTranslationLayers(input);
    expect(input).toEqual(copy);
  });
});
