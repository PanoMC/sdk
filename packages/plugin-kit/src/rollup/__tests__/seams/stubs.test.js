import { describe, expect, test } from "bun:test";
import * as kit from "../../index.js";
import { panoFallbackCss } from "../../../styles/fallback-css.js";
import { panoSemanticClasses } from "../../../styles/semantic-classes.js";
import { panoPluginCss } from "../../../styles/plugin-css.js";
import * as root from "../../../index.js";

// The seams of unit TC-01. Most stubs have an owner by now, so this test only pins what must stay true
// for the rest of the kit: every name of doc 02's file map is exported, is callable with its documented
// options, and gives back an object with a name (a rollup plugin, or a svelte preprocessor). What each
// plugin does is tested by the unit that owns it and by __tests__/e2e.
describe("kit seams", () => {
  test("every rollup export is a function and returns a named plugin", () => {
    const options = {
      panoEntry: {},
      panoControllersModule: {},
      panoViews: { dirs: [], namespace: "x", pluginId: "pano-plugin-x" },
      panoRules: {},
      panoHelpers: {},
      panoStamp: {},
      panoControllers: {},
      panoMeta: { pluginId: "pano-plugin-x", namespace: "x" },
      panoTypes: {},
      panoSamples: {},
      panoWidgets: { pluginId: "pano-plugin-x", namespace: "x" },
      panoClientGen: { pluginId: "pano-plugin-x", namespace: "x" },
    };

    for (const [name, given] of Object.entries(options)) {
      expect(typeof kit[name], name).toBe("function");

      const plugin = kit[name](given);

      expect(typeof plugin.name, name).toBe("string");
    }

    for (const plugin of [panoFallbackCss({ ns: "x" }), panoPluginCss({ ns: "x" }), panoSemanticClasses({ ns: "x" })]) {
      expect(typeof plugin.name).toBe("string");
    }
  });

  test("panoPlugin returns a promise of config objects and refuses an unknown side", async () => {
    expect(typeof kit.panoPlugin).toBe("function");
    await expect(kit.panoPlugin({ side: "panel" })).rejects.toThrow(/side/);
  });

  test("the root entry re-exports config and lock without loading rollup", () => {
    for (const name of ["loadConfig", "namespaceOf", "readLock", "writeLockSection", "diffSection"]) {
      expect(typeof root[name], name).toBe("function");
    }
  });
});
