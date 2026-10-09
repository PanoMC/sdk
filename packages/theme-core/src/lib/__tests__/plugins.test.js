import { afterEach, describe, expect, test } from "bun:test";
import { register, reset } from "@panomc/sdk/core/js/ControllerRegistry.js";

import { hasPlugin, pluginInfo } from "../plugins.js";

const siteInfo = {
  plugins: {
    "pano-plugin-market": { version: "1.4.0", uiHash: "abc", dependencies: [] },
    "acme-shop": { version: null, uiHash: "def", dependencies: ["pano-plugin-market"] },
  },
};

afterEach(() => reset());

describe("hasPlugin / pluginInfo", () => {
  test("an installed plugin by full id and by namespace", () => {
    expect(hasPlugin(siteInfo, "pano-plugin-market")).toBe(true);
    expect(hasPlugin(siteInfo, "market")).toBe(true);
    expect(pluginInfo(siteInfo, "market")).toEqual({ version: "1.4.0", uiHash: "abc", dependencies: [] });
    expect(pluginInfo(siteInfo, "pano-plugin-market")?.version).toBe("1.4.0");
  });

  test("a plugin that is not installed", () => {
    expect(hasPlugin(siteInfo, "pano-plugin-faq")).toBe(false);
    expect(hasPlugin(siteInfo, "faq")).toBe(false);
    expect(pluginInfo(siteInfo, "faq")).toBeNull();
  });

  test("a namespace registered by a plugin with an own id", () => {
    expect(hasPlugin(siteInfo, "shop")).toBe(false);
    register("acme-shop", "shop", {});
    expect(hasPlugin(siteInfo, "shop")).toBe(true);
    expect(pluginInfo(siteInfo, "shop")?.version).toBeNull();
  });

  test("no site info yet, an empty map, odd input", () => {
    for (const info of [undefined, null, {}, { plugins: null }, { plugins: {} }]) {
      expect(hasPlugin(info, "pano-plugin-market")).toBe(false);
      expect(pluginInfo(info, "market")).toBeNull();
    }
    expect(hasPlugin(siteInfo, "")).toBe(false);
    expect(hasPlugin(siteInfo, undefined)).toBe(false);
    expect(hasPlugin(siteInfo, "toString")).toBe(false);
    expect(hasPlugin(siteInfo, "constructor")).toBe(false);
  });

  test("keeps no state between calls (two requests, two site infos)", () => {
    const other = { plugins: {} };
    expect(hasPlugin(siteInfo, "market")).toBe(true);
    expect(hasPlugin(other, "market")).toBe(false);
    expect(hasPlugin(siteInfo, "market")).toBe(true);
  });
});
