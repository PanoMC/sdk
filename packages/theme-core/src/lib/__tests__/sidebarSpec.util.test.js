import { describe, expect, test } from "bun:test";

import {
  parseSidebarSpec,
  resolveSidebarSpec,
  SIDEBAR_ID_PATTERN,
} from "../components/sidebars/sidebarSpec.util.js";

describe("parseSidebarSpec (T5 + T8)", () => {
  test("a non-string value is a component (unchanged behaviour)", () => {
    for (const value of [undefined, null, {}, () => {}, 12, class A {}]) {
      expect(parseSidebarSpec(value)).toEqual({ kind: "component" });
    }
  });

  test("home and profile are host sidebars", () => {
    expect(parseSidebarSpec("home")).toEqual({ kind: "host", id: "home" });
    expect(parseSidebarSpec("profile")).toEqual({ kind: "host", id: "profile" });
  });

  test("plugin:<id> with a valid id is an engine sidebar", () => {
    expect(parseSidebarSpec("plugin:fixture")).toEqual({ kind: "plugin", sidebarId: "fixture" });
    expect(parseSidebarSpec("plugin:market:cart-1")).toEqual({ kind: "plugin", sidebarId: "market:cart-1" });
    expect(parseSidebarSpec("plugin:0a")).toEqual({ kind: "plugin", sidebarId: "0a" });
  });

  test("other host ids and malformed plugin ids are invalid", () => {
    for (const value of [
      "player-detail",
      "support",
      "ticket",
      "",
      "Home",
      "plugin:",
      "plugin:Upper",
      "plugin:-lead",
      "plugin::lead",
      "plugin:has space",
      "plugin:a/b",
      "plugin:" + "a".repeat(65),
      " plugin:x",
    ]) {
      expect(parseSidebarSpec(value).kind).toBe("invalid");
    }
  });

  test("the id pattern accepts 64 characters and rejects 65", () => {
    expect(SIDEBAR_ID_PATTERN.test("a".repeat(64))).toBe(true);
    expect(SIDEBAR_ID_PATTERN.test("a".repeat(65))).toBe(false);
  });
});

describe("resolveSidebarSpec", () => {
  const HomeComponent = { name: "Home" };
  const ProfileComponent = { name: "Profile" };
  const PluginSidebar = { name: "PluginSidebar" };
  const event = { url: new URL("https://pano.example/store") };

  function setup({ visible = {}, loadResult } = {}) {
    const calls = [];
    const hosts = {
      home: { default: HomeComponent, load: async (e) => calls.push(["home.load", e]) },
      profile: { default: ProfileComponent, load: async (e) => calls.push(["profile.load", e]) },
    };
    const warnings = [];
    const args = {
      event,
      hosts,
      PluginSidebar,
      executeSidebarLoad: async (id, e) => calls.push(["executeSidebarLoad", id, e]),
      countVisible: (id) => visible[id] ?? 0,
      warn: (...a) => warnings.push(a),
    };
    return { args, calls, warnings };
  }

  test("a component value leaves the output unchanged (returns null)", async () => {
    const { args, calls } = setup();
    expect(await resolveSidebarSpec({ ...args, sidebar: HomeComponent })).toBeNull();
    expect(await resolveSidebarSpec({ ...args, sidebar: undefined })).toBeNull();
    expect(calls).toEqual([]);
  });

  test('"profile" runs the host load with the event and returns the host component', async () => {
    const { args, calls } = setup();
    const out = await resolveSidebarSpec({ ...args, sidebar: "profile", sidebarProps: { side: "left" } });

    expect(out).toEqual({ sidebar: ProfileComponent });
    expect(calls).toEqual([["profile.load", event]]);
  });

  test('"home" runs the home load', async () => {
    const { args, calls } = setup();
    const out = await resolveSidebarSpec({ ...args, sidebar: "home" });

    expect(out).toEqual({ sidebar: HomeComponent });
    expect(calls).toEqual([["home.load", event]]);
  });

  test("a host without a load function is still resolved", async () => {
    const { args } = setup();
    args.hosts.home = { default: HomeComponent };
    expect(await resolveSidebarSpec({ ...args, sidebar: "home" })).toEqual({ sidebar: HomeComponent });
  });

  test("plugin:<id> with items => PluginSidebar and sidebarProps merged with the id", async () => {
    const { args, calls } = setup({ visible: { fixture: 2 } });
    const out = await resolveSidebarSpec({
      ...args,
      sidebar: "plugin:fixture",
      sidebarProps: { side: "left", sidebarId: "ignored" },
    });

    expect(calls).toEqual([["executeSidebarLoad", "fixture", event]]);
    expect(out).toEqual({ sidebar: PluginSidebar, sidebarProps: { side: "left", sidebarId: "fixture" } });
  });

  test("plugin:<id> with items and no sidebarProps", async () => {
    const { args } = setup({ visible: { fixture: 1 } });
    const out = await resolveSidebarSpec({ ...args, sidebar: "plugin:fixture" });
    expect(out).toEqual({ sidebar: PluginSidebar, sidebarProps: { sidebarId: "fixture" } });
  });

  test("plugin:<id> with zero visible items => no sidebar (full width)", async () => {
    const { args, calls } = setup({ visible: { fixture: 0 } });
    const out = await resolveSidebarSpec({ ...args, sidebar: "plugin:fixture" });

    expect(out.sidebar).toBeNull();
    expect(calls).toEqual([["executeSidebarLoad", "fixture", event]]);
  });

  test("the sidebar load runs before the items are counted", async () => {
    const order = [];
    const { args } = setup();
    args.executeSidebarLoad = async () => order.push("load");
    args.countVisible = () => (order.push("count"), 1);
    await resolveSidebarSpec({ ...args, sidebar: "plugin:x" });
    expect(order).toEqual(["load", "count"]);
  });

  test("anything else => null sidebar and exactly one console.warn, no loads", async () => {
    for (const value of ["support", "ticket", "player-detail", "plugin:Bad Id", "nonsense"]) {
      const { args, calls, warnings } = setup();
      const out = await resolveSidebarSpec({ ...args, sidebar: value });

      expect(out.sidebar).toBeNull();
      expect(warnings.length).toBe(1);
      expect(String(warnings[0][0])).toContain(value);
      expect(calls).toEqual([]);
    }
  });
});
