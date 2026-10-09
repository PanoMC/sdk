import { describe, expect, test } from "bun:test";
import { createRouteMap } from "../route-map.js";
import { createReroute, route, setRouteConfig, DISABLED_PATH } from "../../registry/routes.js";

const config = {
  routes: {
    rename: { "/store": "/shop", "/store/[slug]": "/shop/[slug]", "/post/[url]": "/news/[url]" },
    disable: ["/rules", "/wiki/[...rest]"],
  },
};

describe("createRouteMap", () => {
  const map = createRouteMap(config.routes);

  test("round trips every rename", () => {
    for (const [canonical, pub] of [
      ["/store", "/shop"],
      ["/store/vip", "/shop/vip"],
      ["/post/hello-world", "/news/hello-world"],
    ]) {
      expect(map.toPublic(canonical)).toBe(pub);
      expect(map.toCanonical(pub)).toBe(canonical);
    }
  });

  test("paths without a rename are unchanged", () => {
    expect(map.toPublic("/profile")).toBe("/profile");
    expect(map.toCanonical("/profile")).toBe("/profile");
    expect(map.toPublic("/store/vip/extra")).toBe("/store/vip/extra");
    expect(map.toCanonical("/")).toBe("/");
    expect(map.toPublic("/")).toBe("/");
  });

  test("params keep their raw (encoded) text", () => {
    expect(map.toPublic("/store/a%20b")).toBe("/shop/a%20b");
    expect(map.toCanonical("/shop/a%2Fb")).toBe("/store/a%2Fb");
  });

  test("query, hash and trailing slash are kept", () => {
    expect(map.toPublic("/store?page=2#top")).toBe("/shop?page=2#top");
    expect(map.toCanonical("/shop/vip/?x=1")).toBe("/store/vip/?x=1");
    expect(map.toPublic("/store/")).toBe("/shop/");
  });

  test("non site paths are returned as given", () => {
    for (const value of ["https://example.com/store", "//cdn/store", "#top", "mailto:a@b.c", "store", ""]) {
      expect(map.toPublic(value)).toBe(value);
    }
  });

  test("disabled path is null, also behind a rename and with a rest param", () => {
    expect(map.toCanonical("/rules")).toBeNull();
    expect(map.toCanonical("/rules/")).toBeNull();
    expect(map.toCanonical("/wiki")).toBeNull();
    expect(map.toCanonical("/wiki/a/b")).toBeNull();
    expect(map.toCanonical("/rulesx")).toBe("/rulesx");

    const both = createRouteMap({ rename: { "/store": "/shop" }, disable: ["/store"] });
    expect(both.toCanonical("/shop")).toBeNull();
    expect(both.toCanonical("/store")).toBeNull();
  });

  test("isRenamedAway is true only for the canonical path of a rename", () => {
    expect(map.isRenamedAway("/store")).toBe(true);
    expect(map.isRenamedAway("/store/vip")).toBe(true);
    expect(map.isRenamedAway("/shop")).toBe(false);
    expect(map.isRenamedAway("/profile")).toBe(false);
    expect(map.isRenamedAway("/store/vip/extra")).toBe(false);
  });

  test("a swap is consistent and nothing is renamed away that is also public", () => {
    const swap = createRouteMap({ rename: { "/a": "/b", "/b": "/a" } });
    expect(swap.toCanonical("/a")).toBe("/b");
    expect(swap.toCanonical("/b")).toBe("/a");
    expect(swap.isRenamedAway("/a")).toBe(false);
  });

  test("more specific rename wins", () => {
    const m = createRouteMap({ rename: { "/s/[x]": "/p/[x]", "/s/featured": "/p/top" } });
    expect(m.toPublic("/s/featured")).toBe("/p/top");
    expect(m.toPublic("/s/other")).toBe("/p/other");
    expect(m.toCanonical("/p/top")).toBe("/s/featured");
  });

  test("rest params and reordered params", () => {
    const m = createRouteMap({ rename: { "/docs/[...path]": "/help/[...path]", "/u/[a]/[b]": "/x/[b]/[a]" } });
    expect(m.toPublic("/docs/a/b/c")).toBe("/help/a/b/c");
    expect(m.toPublic("/docs")).toBe("/help");
    expect(m.toCanonical("/help/a/b")).toBe("/docs/a/b");
    expect(m.toPublic("/u/1/2")).toBe("/x/2/1");
    expect(m.toCanonical("/x/2/1")).toBe("/u/1/2");
  });

  test("empty config is the identity", () => {
    const m = createRouteMap();
    expect(m.toPublic("/store")).toBe("/store");
    expect(m.toCanonical("/store")).toBe("/store");
    expect(m.isRenamedAway("/store")).toBe(false);
  });

  describe("errors", () => {
    test("param mismatch", () => {
      expect(() => createRouteMap({ rename: { "/store/[slug]": "/shop/[id]" } })).toThrow(/same params/);
      expect(() => createRouteMap({ rename: { "/store/[slug]": "/shop" } })).toThrow(/same params/);
      expect(() => createRouteMap({ rename: { "/store/[slug]": "/shop/[...slug]" } })).toThrow(/rest/);
    });

    test("bad patterns", () => {
      expect(() => createRouteMap({ rename: { store: "/shop" } })).toThrow(/Invalid route pattern/);
      expect(() => createRouteMap({ disable: ["//x"] })).toThrow(/Invalid route pattern/);
      expect(() => createRouteMap({ disable: ["/a/[x]/[x]"] })).toThrow(/twice/);
      expect(() => createRouteMap({ disable: ["/[...r]/edit"] })).toThrow(/last/);
      expect(() => createRouteMap({ disable: ["/a/b[x]"] })).toThrow(/unsupported/);
      expect(() => createRouteMap({ disable: ["/a?x=1"] })).toThrow(/query/);
    });

    test("two renames to the same public path", () => {
      expect(() => createRouteMap({ rename: { "/a": "/c", "/b": "/c" } })).toThrow(/both/);
    });
  });
});

describe("registry/routes", () => {
  test("route() is toPublic after setRouteConfig, identity before and after a reset", () => {
    setRouteConfig(undefined);
    expect(route("/store")).toBe("/store");

    setRouteConfig(config);
    expect(route("/store")).toBe("/shop");
    expect(route("/post/x?y=1")).toBe("/news/x?y=1");
    expect(route("/profile")).toBe("/profile");

    setRouteConfig({});
    expect(route("/store")).toBe("/store");
  });

  test("createReroute maps public to canonical and disabled to /__pano-disabled", () => {
    const reroute = createReroute(config);
    const at = (p) => reroute({ url: new URL(p, "http://localhost") });

    expect(at("/shop")).toBe("/store");
    expect(at("/shop/vip?x=1")).toBe("/store/vip");
    expect(at("/news/hello")).toBe("/post/hello");
    expect(at("/profile")).toBeUndefined();
    expect(at("/rules")).toBe(DISABLED_PATH);
    expect(at("/wiki/a/b")).toBe("/__pano-disabled");
    expect(at("/store")).toBeUndefined();
  });

  test("createReroute without routes does nothing", () => {
    const reroute = createReroute({});
    expect(reroute({ url: new URL("http://localhost/rules") })).toBeUndefined();
  });
});
