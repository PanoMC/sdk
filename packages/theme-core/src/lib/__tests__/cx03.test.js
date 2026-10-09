import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { writable, get } from "svelte/store";

import { ENGINE_SAMPLES } from "../../routes/catalogue/engineSamples.js";
import * as model from "../../routes/catalogue/model.js";
import skinContract from "../../../skin-contract.json" with { type: "json" };

// CX-03: the readers of the public lists read `items` + `page.nextCursor` (no fallback to the old keys), the
// block guard of describeView, and the catalogue samples of the five sidebar parts.
//
// The page logics are run for real: their imports are rewritten to small stubs (answers stubbed per path).

const lib = resolve(import.meta.dir, "..");
const src = resolve(lib, "..");

mock.module("$app/environment", () => ({ browser: false, dev: false }));

const state = (globalThis.__cx03 = { answers: {}, calls: [] });

const STUBS = {
  svelte: `export const onMount = () => {}; export const onDestroy = () => {};`,
  "$app/environment": `export const browser = false; export const dev = false;`,
  "$pano/lib/api.util.js": `const s = globalThis.__cx03;
export const NETWORK_ERROR = "NETWORK_ERROR";
export default { get: async ({ path }) => { s.calls.push(path); return s.answers[path] ?? { error: true }; }, delete: async () => ({}) };`,
  "$pano/lib/api.util": `export { default, NETWORK_ERROR } from "$pano/lib/api.util.js";`,
  "$pano/lib/siteRealtime.js": `export const onNotificationRefresh = () => () => {};`,
  "$pano/lib/Store.js": `export const requireLogin = () => {};`,
  "$pano/lib/components/sidebars/ProfileSidebar.svelte": `export default {}; export const load = async () => ({});`,
  "$pano/lib/components/modals/ConfirmRemoveAllNotificationsModal.svelte": `export const setCallback = () => {}; export const show = () => {};`,
  "$pano/lib/services/profile": `export const sendChangeEmail = async () => ({}); export const sendResetPassword = async () => ({}); export const sendUpdateProfile = async () => ({});`,
  "$pano/lib/PluginAPI": `export const executeLifecycle = async () => {}; export const executeViewLoad = async () => {};
const edit = { edit: (fn) => fn([]) };
export const panoApiServer = { ui: { settings: { content: edit, cardRows: edit } } };`,
  "$pano/lib/language.util.js": `export const changeLanguage = async () => {}; export const getLanguageByLocale = () => ({});`,
  "date-fns": `export const formatDistanceToNow = () => "";`,
  "@jill64/universal-sanitizer": `export const sanitize = (v) => v;`,
};

let dir;
const stubFiles = new Map();

function stubFile(spec) {
  if (!stubFiles.has(spec)) {
    const file = join(dir, `stub-${stubFiles.size}.mjs`);
    stubFiles.set(spec, file);
    writeFileSync(file, STUBS[spec].replace(/from "(\$pano[^"]+)"/g, (_, s) => `from "${stubFile(s)}"`));
  }

  return stubFiles.get(spec);
}

async function loadLogics(rel) {
  const source = readFileSync(join(lib, rel), "utf8").replace(/from\s+"([^"]+)"/g, (whole, spec) => (STUBS[spec] ? `from "${stubFile(spec)}"` : whole));
  const file = join(dir, rel.split("/").pop().replace(/\.js$/, `.${Math.random().toString(36).slice(2)}.mjs`));

  writeFileSync(file, source);

  return import(file);
}

beforeAll(() => {
  const scratch = join(src, "..", "node_modules");
  mkdirSync(scratch, { recursive: true });
  dir = mkdtempSync(join(scratch, ".cx03-"));
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("the notifications page reads items and page.nextCursor", () => {
  const item = (id) => ({ id, status: "READ", type: "x", date: "1" });

  async function setup() {
    state.answers = {};
    state.calls = [];
    const logics = await loadLogics("ui-logics/page-logics/NotificationsPageLogics.js");
    const notifications = writable([item(1), item(2)]);
    const count = writable(25);

    // init() ties the count store to the list store; its onMount / onDestroy need a component, so run it by hand
    return { logics, notifications, count };
  }

  test("loadMore appends `items` and keeps offering Show more while nextCursor is set", async () => {
    const { logics } = await setup();
    const data = { notificationCount: 25, notifications: [item(1), item(2)] };
    const stores = initOutsideComponent(logics, data);

    state.answers["/notifications/2/more"] = { items: [item(3), item(4)], page: { size: 2, nextCursor: "c4" }, notificationCount: 25 };

    await logics.loadMore(stores.notifications, stores.loadMoreLoading);

    expect(get(stores.notifications).map((n) => n.id)).toEqual([1, 2, 3, 4]);
    expect(get(stores.count)).toBe(25);
    expect(get(stores.loadMoreLoading)).toBe(false);
  });

  test("a null nextCursor ends the list: the count follows the list, so the button goes away", async () => {
    const { logics } = await setup();
    const stores = initOutsideComponent(logics, { notificationCount: 25, notifications: [item(1), item(2)] });

    state.answers["/notifications/2/more"] = { items: [item(3)], page: { size: 2, nextCursor: null }, notificationCount: 25 };

    await logics.loadMore(stores.notifications, stores.loadMoreLoading);

    expect(get(stores.notifications)).toHaveLength(3);
    expect(get(stores.count)).toBe(3);
  });

  test("the old key is not read: an answer with `notifications` adds nothing and does not throw into the view", async () => {
    const { logics } = await setup();
    const stores = initOutsideComponent(logics, { notificationCount: 5, notifications: [item(1)] });

    state.answers["/notifications/1/more"] = { notifications: [item(2)], page: { nextCursor: null } };

    await logics.loadMore(stores.notifications, stores.loadMoreLoading).catch(() => {});

    expect(get(stores.notifications)).toHaveLength(1);
    expect(get(stores.loadMoreLoading)).toBe(false);
  });

  test("processLoad reads `items` of GET /notifications", async () => {
    const { logics } = await setup();

    state.answers["/notifications"] = { items: [item(1)], page: { totalItems: "1", nextCursor: null } };

    const out = await logics.processLoad({ parent: async () => ({ session: {} }) });

    expect(out.notifications.map((n) => n.id)).toEqual([1]);
    expect(out.notificationCount).toBe(1);
  });

  test("the cursor decides whether more is offered, not totalItems", async () => {
    const { logics } = await setup();

    // a cursor but a total that is not above the loaded list: the view still has to offer "Show more"
    state.answers["/notifications"] = { items: [item(1), item(2)], page: { totalItems: "2", nextCursor: "c2" } };
    expect((await logics.processLoad({ parent: async () => ({ session: {} }) })).notificationCount).toBeGreaterThan(2);

    // no cursor but a total above the loaded list: nothing more is offered
    state.answers["/notifications"] = { items: [item(1), item(2)], page: { totalItems: "9", nextCursor: null } };
    expect((await logics.processLoad({ parent: async () => ({ session: {} }) })).notificationCount).toBe(2);
  });

  test("countByCursor", async () => {
    const { logics } = await setup();

    expect(logics.countByCursor({ totalItems: "25", nextCursor: "c" }, 10)).toBe(25);
    expect(logics.countByCursor({ totalItems: "10", nextCursor: "c" }, 10)).toBe(11);
    expect(logics.countByCursor({ nextCursor: "c" }, 10)).toBe(11);
    expect(logics.countByCursor({ totalItems: "99", nextCursor: null }, 10)).toBe(10);
    expect(logics.countByCursor(undefined, 4)).toBe(4);
  });
});

/** init() registers onMount / onDestroy, which are no-ops outside a component; svelte's server build ignores them. */
function initOutsideComponent(logics, data) {
  return logics.init(data);
}

describe("the settings page reads sessions as items", () => {
  test("GET /profile/sessions -> `items`", async () => {
    state.answers = { "/profile/sessions": { items: [{ id: "s1" }, { id: "s2" }], page: { size: 2, nextCursor: null } } };

    const logics = await loadLogics("ui-logics/page-logics/SettingsPageLogics.js");
    const out = await logics.processLoad({ parent: async () => ({}) });

    expect(out.sessions.map((s) => s.id)).toEqual(["s1", "s2"]);
  });

  test("the old key `sessions` is not read", async () => {
    state.answers = { "/profile/sessions": { sessions: [{ id: "old" }] } };

    const logics = await loadLogics("ui-logics/page-logics/SettingsPageLogics.js");
    const out = await logics.processLoad({ parent: async () => ({}) });

    expect(out.sessions ?? []).toEqual([]);
  });
});

describe("no reader of the old list keys is left", () => {
  const read = (rel) => readFileSync(join(lib, rel), "utf8");

  test("the quick notifications of the pop-up container read `items`", () => {
    const source = read("components/NotificationContainer.svelte");

    expect(source).toContain("setNotifications(body.items)");
    expect(source).not.toMatch(/body\.notifications/);
  });
});

describe("PluginBlock only runs views that are blocks", () => {
  test("describeView carries the block flag", async () => {
    const registry = await import("../../registry/index.js");

    registry.resetRegistryForTests();
    registry.registerViews([
      { name: "cx:Grid", pluginId: "pano-plugin-cx", contract: 1, kind: "component", block: true, component: async () => ({}) },
      { name: "cx:Plain", pluginId: "pano-plugin-cx", contract: 1, kind: "component", component: async () => ({}) },
    ]);

    expect(registry.describeView("cx:Grid").block).toBe(true);
    expect(registry.describeView("cx:Plain").block).toBe(false);
    expect(registry.describeView("cx:Nope")).toBeNull();

    registry.resetRegistryForTests();
  });

  test("PluginBlock calls the browser load only for a block (the behaviour is in engineWiring.test.js)", () => {
    const source = readFileSync(join(lib, "components", "PluginBlock.svelte"), "utf8");

    expect(source).toContain("describeView(blockId)?.block");
    expect(source).toContain("if (dev) warnNotBlock(blockId)");
  });
});

describe("catalogue samples of the five sidebar parts", () => {
  const PARTS = ["HomeSidebar", "PlayerDetailSidebar", "ProfileSidebar", "SupportSidebar", "TicketCreateAndDetailSidebar"];

  test("each is in the table and on disk, with filled and empty", async () => {
    const files = readdirSync(join(lib, "views")).filter((f) => f.endsWith(".samples.js"));

    for (const name of PARTS) {
      expect(Object.keys(ENGINE_SAMPLES)).toContain(name);
      expect(files).toContain(`${name}.samples.js`);

      const mod = await ENGINE_SAMPLES[name]();
      const states = model.stateNames(mod.default);

      expect(states).toEqual(expect.arrayContaining(["filled", "empty"]));

      const contractProps = Object.keys(skinContract.views[name].props);

      for (const state of states) {
        const resolved = await model.resolveSample(mod.default, state);

        for (const prop of Object.keys(resolved.props)) expect(contractProps).toContain(prop);
        // every prop the contract names is given
        for (const prop of contractProps) expect(Object.keys(resolved.props)).toContain(prop);
      }
    }
  });
});
