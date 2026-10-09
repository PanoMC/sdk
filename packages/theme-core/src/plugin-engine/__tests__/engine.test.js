import { describe, expect, test } from "bun:test";
import { get } from "svelte/store";

import { createHookEngine, createSlotRegistry } from "../engine.js";

const module = (label, load) => ({ default: function Component() {}, label, ...(load ? { load } : {}) });
const thunk = (m) => async () => m;
const slotsOf = (policy = {}) =>
  createSlotRegistry({ getPlugins: () => ({}), browser: true, executeLifecycle: async () => {}, ...policy });

describe("hook engine: isSuppressed keeps positions aligned", () => {
  test("getHook and executeHookLoad list the same entries in the same order", async () => {
    const calls = [];
    const engine = createHookEngine({ isSuppressed: (entry) => entry.view === "market:NavCart" });

    for (const [id, view] of [
      ["a", "market:A"],
      ["claimed", "market:NavCart"],
      ["c", "market:C"],
    ]) {
      engine.register({
        name: "theme:top",
        id,
        view,
        component: thunk(module(id, async () => (calls.push(id), { from: id }))),
      });
    }

    const list = get(engine.get("theme:top"));
    const props = await engine.executeHookLoad("theme:top", {});

    expect(list.map((entry) => entry.id)).toEqual(["a", "c"]);
    expect(props.map((p) => p.from)).toEqual(["a", "c"]);
    // no wasted load for the claimed entry
    expect(calls.sort()).toEqual(["a", "c"]);
  });

  test("an entry without `view` is never suppressed", () => {
    const engine = createHookEngine({ isSuppressed: (entry) => entry.view === "x:Y" });
    engine.register({ name: "h", id: "one", component: thunk(module("one")) });

    expect(get(engine.get("h")).length).toBe(1);
  });

  test("no policy = today's behaviour", async () => {
    const engine = createHookEngine();
    engine.register({ name: "h", component: thunk(module("a", async () => ({ x: 1 }))) });

    expect(get(engine.get("h")).length).toBe(1);
    expect(await engine.executeHookLoad("h", {})).toEqual([{ x: 1 }]);
  });

  test("normalizeItem can drop a hook entry", () => {
    const engine = createHookEngine({ normalizeItem: (item) => (item.id === "bad" ? null : item) });
    engine.register({ name: "h", id: "bad", component: thunk(module("bad")) });
    engine.register({ name: "h", id: "ok", component: thunk(module("ok")) });

    expect(get(engine.get("h")).map((entry) => entry.id)).toEqual(["ok"]);
  });

  test("the plugin's registration object is not mutated by normalizeItem", () => {
    const engine = createHookEngine({
      normalizeItem: (item) => {
        item.component = thunk(module("n"));
        return item;
      },
    });
    const options = { name: "h", id: "x", view: "a:B" };
    engine.register(options);

    expect(options.component).toBeUndefined();
    expect(typeof get(engine.get("h"))[0].component).toBe("function");
  });
});

describe("slot registry: isSuppressed", () => {
  test("a claimed item is not read, not loaded and stays in the store", async () => {
    const loads = [];
    const registry = slotsOf({ isSuppressed: (item) => item.view === "market:NavCart" });

    registry.register({
      viewId: "navbar-right",
      id: "cart",
      view: "market:NavCart",
      component: thunk(module("cart", async () => (loads.push("cart"), { n: 1 }))),
    });
    registry.register({
      viewId: "navbar-right",
      id: "other",
      view: "market:Other",
      component: thunk(module("other", async () => (loads.push("other"), { n: 2 }))),
    });

    expect(get(registry.get("navbar-right")).map((item) => item.id)).toEqual(["other"]);

    const resolved = await registry.executeViewLoad("navbar-right", {});

    expect(resolved.map((item) => item.id)).toEqual(["other"]);
    expect(resolved[0].props.data).toEqual({ n: 2 });
    expect(loads).toEqual(["other"]);
    // the claimed item was not thrown away
    expect(get(registry.uiItems)["navbar-right"].map((item) => item.id).sort()).toEqual(["cart", "other"]);
  });

  test("register keeps `view`, `props` and `pluginId` on the item", () => {
    const registry = slotsOf();
    registry.register({
      viewId: "s",
      id: "a",
      view: "x:Y",
      pluginId: "pano-plugin-x",
      props: { sidebarId: "s" },
      component: thunk(module("a")),
    });

    const [item] = get(registry.get("s"));
    expect(item).toMatchObject({ id: "a", view: "x:Y", pluginId: "pano-plugin-x", props: { sidebarId: "s" } });
    expect(item.viewId).toBeUndefined();
  });

  test("re-registering an id replaces the component and keeps the order key", () => {
    const registry = slotsOf();
    registry.register({ viewId: "s", id: "a", component: thunk(module("one")) });
    const seq = get(registry.uiItems).s[0]._seq;
    const second = thunk(module("two"));
    registry.register({ viewId: "s", id: "a", component: second, priority: 3 });

    const [item] = get(registry.uiItems).s;
    expect(item.component).toBe(second);
    expect(item.priority).toBe(3);
    expect(item._seq).toBe(seq);
  });

  test("normalizeItem runs after edit and drops what it returns null for, in place", () => {
    const registry = slotsOf({ normalizeItem: (item) => (item.drop ? null : item) });
    let given;
    registry.edit("s", (items) => {
      given = items;
      items.push({ id: "keep", priority: 1 }, { id: "gone", drop: true });
    });

    expect(given.map((item) => item.id)).toEqual(["keep"]);
    expect(get(registry.get("s")).map((item) => item.id)).toEqual(["keep"]);
  });

  test("normalizeItem runs on upsert", () => {
    const registry = slotsOf({ normalizeItem: (item) => (item.drop ? null : item) });
    registry.upsert("s", { id: "a", drop: true });
    registry.upsert("s", { id: "b" });

    expect(get(registry.uiItems).s.map((item) => item.id)).toEqual(["b"]);
  });

  test("without a policy nothing changes for edit / register / load", async () => {
    const registry = slotsOf();
    registry.edit("s", (items) => items.push({ id: "a", component: thunk(module("a", async () => ({ z: 1 }))) }));

    const resolved = await registry.executeViewLoad("s", {});
    expect(resolved[0].props.data).toEqual({ z: 1 });
  });
});
