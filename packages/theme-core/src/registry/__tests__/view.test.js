import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("$app/environment", () => ({ dev: false, browser: false }));

const { blockKey, stableJson, pluginView } = await import("../view.js");
const registry = await import("../index.js");

beforeEach(() => registry.resetRegistryForTests());
afterAll(() => registry.resetRegistryForTests());

describe("blockKey", () => {
  test("is block:<id>#<json of primitive props, keys sorted>", () => {
    expect(blockKey("market:Grid", { limit: 8, category: "vip", on: true })).toBe(
      'block:market:Grid#{"category":"vip","limit":8,"on":true}',
    );
    expect(blockKey("market:NavCart")).toBe("block:market:NavCart#{}");
    expect(blockKey("market:NavCart", {})).toBe("block:market:NavCart#{}");
  });

  test("prop order never matters, different values do", () => {
    expect(blockKey("a:B", { x: 1, y: 2 })).toBe(blockKey("a:B", { y: 2, x: 1 }));
    expect(blockKey("a:B", { x: 1 })).not.toBe(blockKey("a:B", { x: 2 }));
    expect(blockKey("a:B", { x: "1" })).not.toBe(blockKey("a:B", { x: 1 }));
  });

  test("objects, functions, undefined, null and NaN are not part of the key", () => {
    expect(stableJson({ a: 1, f() {}, o: { z: 1 }, u: undefined, n: null, nan: NaN })).toBe('{"a":1}');
  });
});

describe("pluginView", () => {
  const record = (label) =>
    function C(anchor, props) {
      return { label, anchor, props };
    };

  test("renders nothing for an unknown view", () => {
    expect(() => pluginView("market:Nope")("anchor", {})).not.toThrow();
  });

  test("renders the override when there is one, else the default", async () => {
    registry.setThemeConfig({ views: { "market:A": { contract: 1, component: async () => ({ default: record("ov") }) } } });
    registry.registerViews([
      { name: "market:A", pluginId: "pano-plugin-market", component: async () => ({ default: record("def-a") }) },
      { name: "market:B", pluginId: "pano-plugin-market", component: async () => ({ default: record("def-b") }) },
    ]);
    await registry.preloadViews(["market:A", "market:B"]);
    expect(pluginView("market:A")("x", { p: 1 })).toEqual({ label: "ov", anchor: "x", props: { p: 1 } });
    expect(pluginView("market:B")("y", {}).label).toBe("def-b");
    expect(pluginView("pano-plugin-market:B")("y", {}).label).toBe("def-b");
  });
});
