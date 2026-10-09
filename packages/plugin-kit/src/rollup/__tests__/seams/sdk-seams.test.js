import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { createViewProxy } from "../../../../../sdk/src/views.js";
import { route } from "../../../../../sdk/src/utils/route.js";
import { RUNTIME_SPECIFIERS } from "../../../../../theme-core/src/kit/specifiers.js";

const packages = path.resolve(import.meta.dir, "../../../../..");
const NEW_SPECIFIERS = {
  "@panomc/sdk/views": "sdk/views.js",
  "@panomc/sdk/controllers": "sdk/controllers.js",
  "@panomc/sdk/utils/route": "sdk/utils-route.js",
};

function setContext(context) {
  globalThis.__PANO_CONTEXT__ = { context, listeners: [] };
}

afterEach(() => {
  delete globalThis.__PANO_CONTEXT__;
});

describe("createViewProxy", () => {
  const Default = (anchor, props) => ["default", anchor, props];
  const Override = (anchor, props) => ["override", anchor, props];

  test("without a views context the default view renders", () => {
    setContext({});
    expect(createViewProxy("market:ProductCard", Default)("a", { p: 1 })).toEqual(["default", "a", { p: 1 }]);
  });

  test("an override wins and goes through views.wrap with its source", () => {
    const calls = [];
    setContext({
      views: {
        getOverride: (name) => (name === "market:ProductCard" ? Override : null),
        wrap: (name, C, source) => {
          calls.push([name, source]);
          return C;
        },
      },
    });
    expect(createViewProxy("market:ProductCard", Default)("a", {})[0]).toBe("override");
    expect(createViewProxy("market:Other", Default)("a", {})[0]).toBe("default");
    expect(calls).toEqual([
      ["market:ProductCard", "override"],
      ["market:Other", "default"],
    ]);
  });

  test("a wrap that returns nothing falls back to the component", () => {
    setContext({ views: { getOverride: () => null, wrap: () => undefined } });
    expect(createViewProxy("x:Y", Default)("a", {})[0]).toBe("default");
  });
});

describe("route", () => {
  test("returns the path unchanged without a route map", () => {
    setContext({});
    expect(route("/profile")).toBe("/profile");
  });

  test("uses routes.resolve of the pano context", () => {
    setContext({ routes: { resolve: (p) => `/en${p}` } });
    expect(route("/profile")).toBe("/en/profile");
  });
});

describe("runtime specifiers", () => {
  test("the three new specifiers are listed with their shim files", () => {
    for (const [spec, file] of Object.entries(NEW_SPECIFIERS)) {
      expect(RUNTIME_SPECIFIERS[spec]).toBe(file);
    }
  });

  test("hooks-client.js keeps one literal import() per specifier", () => {
    const source = fs.readFileSync(path.join(packages, "theme-core/src/kit/hooks-client.js"), "utf8");
    const mapped = [...source.matchAll(/^\s*"([^"]+)":\s*\(\)\s*=>\s*(?:\n\s*)?import\("([^"]+)"\)/gm)];
    expect(mapped.every(([, key, target]) => key === target)).toBe(true);
    expect(mapped.map(([, key]) => key).sort()).toEqual(Object.keys(RUNTIME_SPECIFIERS).sort());
  });

  test("the sdk package.json exports the new subpaths and the pano-api bin", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(packages, "sdk/package.json"), "utf8"));
    for (const subpath of ["./views", "./controllers", "./utils/route"]) {
      expect(pkg.exports[subpath]?.default, subpath).toBeTruthy();
    }
    expect(pkg.bin["pano-api"]).toBe("./bin/pano-api.js");
    for (const subpath of ["./views", "./utils/route"]) {
      expect(fs.existsSync(path.join(packages, "sdk", pkg.exports[subpath].default)), subpath).toBe(true);
    }
  });
});
