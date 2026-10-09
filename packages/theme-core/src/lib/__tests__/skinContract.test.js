import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readable, writable } from "svelte/store";

import { findSvelte, renderPart as renderPartWith } from "./engineParts.helper.js";
import {
  applyDerived,
  deriveAll,
  engineTableSource,
  generate,
  hooksOf,
  propNamesOf,
  renderedComponents,
  slotPropsOf,
} from "../../../bin/generate-contract.js";
import { engineViews } from "../views/parts/engine-views.generated.js";

// The registry reads SvelteKit's `dev` flag; the old pre-split modals import the SDK's api util.
mock.module("$app/environment", () => ({ browser: false, dev: false }));
mock.module("@panomc/sdk/core/js/api.util", () => ({ default: {}, NETWORK_ERROR: "NETWORK_ERROR", buildQueryParams: () => "" }));

const registry = await import("../../registry/index.js");

const pkg = join(import.meta.dir, "..", "..", "..");
const lib = join(pkg, "src", "lib");
const read = (...parts) => readFileSync(join(...parts), "utf-8");
const svelteDir = findSvelte();

// DefaultToast imports the SDK's html helper by its package name, which the helper's temp folder
// cannot resolve: hand it the real source as a module-only .svelte file.
const HTML_UTIL = {
  "@panomc/sdk/core/js/html.util.js": `<script context="module">\n${read(pkg, "..", "sdk", "core", "js", "html.util.js")}\n</script>`,
};
const renderPart = (args) => renderPartWith({ ...args, extraSvelte: { ...HTML_UTIL, ...args.extraSvelte } });

const contract = JSON.parse(read(pkg, "skin-contract.json"));

// name -> folder of its controller (the file themes and plugins import today)
const SEVEN = {
  Toast: "components",
  DefaultToast: "components",
  ToastContainer: "components",
  NotificationContainer: "components",
  CloseTicketConfirmModal: "components/modals",
  ConfirmRemoveAllNotificationsModal: "components/modals",
  LogoutSessionConfirmModal: "components/modals",
};
const EIGHT = ["Main", "Sidebar", "Breadcrumb", "Post", "Posts", "Tickets", "TicketRow", "TicketStatus"];
const FORMER_REGISTRY_COMPONENTS = [
  "LoginFormBody",
  "RegisterForm",
  "Date",
  "Pagination",
  "NoContent",
  "PageActions",
  "PageTitle",
  "PlayerHead",
  "Navbar",
  "Header",
  "Footer",
];

const normalize = (html) => html.replace(/<!--[\s\S]*?-->/g, "").replace(/svelte-[a-z0-9]{4,8}/g, "svelte-H");

describe("engine parts (B): files", () => {
  for (const [name, folder] of Object.entries(SEVEN)) {
    test(`${name} is a controller over views/parts/${name}.svelte`, () => {
      const controller = read(lib, folder, `${name}.svelte`);
      expect(existsSync(join(lib, "views", "parts", `${name}.svelte`))).toBe(true);
      expect(controller).toContain(`getOverride("${name}")`);
      expect(controller).toContain(`$pano/lib/views/parts/${name}.svelte`);
      // the part never imports its own controller
      expect(read(lib, "views", "parts", `${name}.svelte`)).not.toMatch(new RegExp(`import[^;]*/${name}\\.svelte`));
    });
  }

  test("the stateful controllers keep their module API", () => {
    const exportsOf = (folder, name) =>
      [...read(lib, folder, `${name}.svelte`).matchAll(/export (?:async )?function (\w+)/g)].map((m) => m[1]).sort();

    expect(exportsOf("components", "ToastContainer")).toEqual(["limitTitle", "show", "showError", "showSuccess"]);
    expect(exportsOf("components", "NotificationContainer")).toEqual(["hide", "show"]);
    expect(exportsOf("components/modals", "CloseTicketConfirmModal")).toEqual(["hide", "onHide", "setCallback", "show"]);
    expect(exportsOf("components/modals", "ConfirmRemoveAllNotificationsModal")).toEqual(["hide", "onHide", "setCallback", "show"]);
    expect(exportsOf("components/modals", "LogoutSessionConfirmModal")).toEqual(["hide", "setCallback", "show"]);
  });
});

describe("skin-contract.json (TC-32)", () => {
  test("the seven parts and the eleven former registry components are component views of contract 1", () => {
    for (const name of [...Object.keys(SEVEN), ...FORMER_REGISTRY_COMPONENTS]) {
      expect(contract.views[name]?.kind).toBe("component");
      // Pagination went to 2 when its page-count prop gained an s (the /api/v1 page shape, TC-42)
      expect(contract.views[name]?.contract).toBe(name === "Pagination" ? 2 : 1);
    }
    // the eight of TC-20 are still there
    for (const name of EIGHT) expect(contract.views[name]?.kind).toBe("component");
  });

  test("registry_components is the derived list of component views (kept for check / list-views)", () => {
    const components = Object.entries(contract.views)
      .filter(([, v]) => v.kind === "component")
      .map(([name]) => name);
    expect(contract.registry_components).toEqual(components);
    for (const name of FORMER_REGISTRY_COMPONENTS) expect(contract.registry_components).toContain(name);
  });

  test("every entry carries source, uses, hooks, slotProps, a lock and the props its source declares", () => {
    const derived = deriveAll(contract);
    for (const [name, entry] of Object.entries(contract.views)) {
      expect(typeof entry.source).toBe("string");
      expect(existsSync(join(pkg, entry.source))).toBe(true);
      expect(Array.isArray(entry.uses)).toBe(true);
      expect(Array.isArray(entry.hooks)).toBe(true);
      expect(typeof entry.slotProps).toBe("object");
      expect(entry.locked.contract).toBe(entry.contract);
      expect(Object.keys(entry.props ?? {}).sort()).toEqual(derived[name].props);
    }
  });

  test("the generated fields and the engine table are current: run `node bin/generate-contract.js` when this fails", () => {
    const { problems, changed } = generate({ check: true });
    expect(problems).toEqual([]);
    expect(changed).toEqual([]);
  });

  test("the engine table lists every view with its contract and a lazy component", () => {
    expect(Object.keys(engineViews)).toEqual(Object.keys(contract.views));
    for (const [name, entry] of Object.entries(engineViews)) {
      expect(entry.contract).toBe(contract.views[name].contract);
      expect(typeof entry.component).toBe("function");
      expect(entry.uses ?? []).toEqual(contract.views[name].uses);
    }
    expect(engineViews.ToastContainer.uses).toEqual(["DefaultToast"]);
    expect(engineViews.DefaultToast.uses).toEqual(["Toast"]);
    expect(engineViews.Posts.uses).toEqual(["NoContent", "Post"]);
  });

  test("the table registers with the registry", () => {
    registry.resetRegistryForTests();
    registry.registerEngineViews(engineViews);
    expect(registry.hasView("ToastContainer")).toBe(true);
    expect(registry.hasView("LogoutSessionConfirmModal")).toBe(true);
    expect(registry.hasView("Navbar")).toBe(true);
    registry.resetRegistryForTests();
  });
});

describe("generate-contract.js", () => {
  test("reads props (export let and $props), hooks, slot props and rendered components", () => {
    const source = `<Hook name="page:top" />
<Child a={1} />
<slot name="footer" row={x} {y} />
<slot />
<script context="module">
  import Dflt from "./Dflt.svelte";
</script>
<script>
  import Child from "./Child.svelte";
  import Constant, { K } from "./Constant.svelte";
  export let one;
  export let two = [1, 2], three = 3;
  let { four = 4, five, ...rest } = $props();
</script>`;

    expect(propNamesOf(source)).toEqual(["five", "four", "one", "three", "two"]);
    expect(hooksOf(source)).toEqual(["page:top"]);
    expect(slotPropsOf(source)).toEqual({ default: [], footer: ["row", "y"] });
    // Child is placed, Dflt is a module default, Constant is only read from
    expect([...renderedComponents(source)].sort()).toEqual(["Child", "Dflt"]);
  });

  describe("the contract rule", () => {
    /** @type {string} */
    let dir;
    const part = (props) => `<div>{one}</div>\n<script>\n${props.map((p) => `  export let ${p};`).join("\n")}\n</script>\n`;
    const write = (rel, text) => {
      mkdirSync(join(dir, rel, ".."), { recursive: true });
      writeFileSync(join(dir, rel), text);
    };
    const entry = (props, contractNumber) => ({
      kind: "component",
      contract: contractNumber,
      props: Object.fromEntries(props.map((p) => [p, `${p} prop`])),
    });
    const setContract = (views) => write("skin-contract.json", JSON.stringify({ views }));

    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), "tc32-contract-"));
      write("src/lib/views/parts/Thing.svelte", part(["one"]));
      setContract({ Thing: entry(["one"], 1) });
    });

    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    test("a first run fills the generated fields, the lock and the table", () => {
      const { problems, changed } = generate({ dir });
      expect(problems).toEqual([]);
      expect(changed).toContain("skin-contract.json");

      const written = JSON.parse(read(dir, "skin-contract.json"));
      expect(written.views.Thing.source).toBe("src/lib/views/parts/Thing.svelte");
      expect(written.views.Thing.locked).toEqual({ contract: 1, props: ["one"] });
      expect(read(dir, "src/lib/views/parts/engine-views.generated.js")).toContain('"Thing": { contract: 1, component: () => import("./Thing.svelte") }');
      expect(generate({ dir, check: true })).toEqual({ problems: [], changed: [] });
    });

    test("a prop added to the source but not described fails", () => {
      write("src/lib/views/parts/Thing.svelte", part(["one", "two"]));
      const { problems } = generate({ dir, check: true });
      expect(problems.join("\n")).toMatch(/Thing: .*not described: two/);
    });

    test("a described prop without a raised contract fails", () => {
      const written = JSON.parse(read(dir, "skin-contract.json"));
      written.views.Thing.props.two = "two prop";
      writeFileSync(join(dir, "skin-contract.json"), JSON.stringify(written));

      const { problems } = generate({ dir });
      expect(problems.join("\n")).toMatch(/Thing: the prop set changed \(one -> one, two\) but "contract" is still 1; raise it to 2/);
      // nothing was written on a failed run
      expect(JSON.parse(read(dir, "skin-contract.json")).views.Thing.locked.props).toEqual(["one"]);
    });

    test("with the contract raised the run passes and records the new lock", () => {
      const written = JSON.parse(read(dir, "skin-contract.json"));
      written.views.Thing.contract = 2;
      writeFileSync(join(dir, "skin-contract.json"), JSON.stringify(written));

      const { problems } = generate({ dir });
      expect(problems).toEqual([]);
      expect(JSON.parse(read(dir, "skin-contract.json")).views.Thing.locked).toEqual({ contract: 2, props: ["one", "two"] });
      expect(generate({ dir, check: true })).toEqual({ problems: [], changed: [] });
      expect(read(dir, "src/lib/views/parts/engine-views.generated.js")).toContain("contract: 2");
    });

    test("lowering the contract fails", () => {
      const written = JSON.parse(read(dir, "skin-contract.json"));
      written.views.Thing.contract = 1;
      writeFileSync(join(dir, "skin-contract.json"), JSON.stringify(written));
      expect(generate({ dir, check: true }).problems.join("\n")).toMatch(/Thing: "contract" went down \(2 -> 1\)/);
    });
  });
});

// ---------------------------------------------------------------------------
// Default render: the same HTML as before the split. The strings below were rendered from the
// pre-split sources (git 3fabe70, same helper, same stubs) with the same props. Since TC-57 they also carry
// the pano-* semantic class tokens (FX-08 proved that stripping them gives the pre-split strings).
// ---------------------------------------------------------------------------

const EXPECTED = {
  "Toast/neutral": "<div id=\"appToast3\" class=\"pano-toast animate__animated animate__bounceInUp toast align-items-center shadow-lg text-bg-tertiary opacity-100 \" role=\"alert\" aria-live=\"assertive\" aria-atomic=\"true\" data-bs-dismiss=\"toast\"><div class=\"toast-body\">msg</div></div>",
  "Toast/success": "<div id=\"appToast4\" class=\"pano-toast animate__animated animate__bounceInUp toast align-items-center shadow-lg text-bg-tertiary opacity-100 text-success\" role=\"alert\" aria-live=\"assertive\" aria-atomic=\"true\" data-bs-dismiss=\"toast\"><div class=\"toast-body\">msg</div></div>",
  "Toast/danger": "<div id=\"appToast5\" class=\"pano-toast animate__animated animate__bounceInUp toast align-items-center shadow-lg text-bg-tertiary opacity-100 text-danger\" role=\"alert\" aria-live=\"assertive\" aria-atomic=\"true\" data-bs-dismiss=\"toast\"><div class=\"toast-body\"><b>m</b></div></div>",
  "Toast/unknown": "<div id=\"appToast6\" class=\"pano-toast animate__animated animate__bounceInUp toast align-items-center shadow-lg text-bg-tertiary opacity-100 \" role=\"alert\" aria-live=\"assertive\" aria-atomic=\"true\" data-bs-dismiss=\"toast\"><div class=\"toast-body\">msg</div></div>",
  "DefaultToast/plain": "<div id=\"appToast1\" class=\"pano-toast animate__animated animate__bounceInUp toast align-items-center shadow-lg text-bg-tertiary opacity-100 \" role=\"alert\" aria-live=\"assertive\" aria-atomic=\"true\" data-bs-dismiss=\"toast\"><div class=\"toast-body\">a.b</div></div>",
  "DefaultToast/values": "<div id=\"appToast2\" class=\"pano-toast animate__animated animate__bounceInUp toast align-items-center shadow-lg text-bg-tertiary opacity-100 text-danger\" role=\"alert\" aria-live=\"assertive\" aria-atomic=\"true\" data-bs-dismiss=\"toast\"><div class=\"toast-body\">a.b{\"name\":\"&lt;i&gt;x&lt;/i&gt;\",\"n\":3}</div></div>",
  "ToastContainer/with-toasts": "<div class=\"pano-toast-container toast-container position-fixed bottom-0 start-50 translate-middle-x mb-3\"><div id=\"appToast1\" class=\"pano-toast animate__animated animate__bounceInUp toast align-items-center shadow-lg text-bg-tertiary opacity-100 \" role=\"alert\" aria-live=\"assertive\" aria-atomic=\"true\" data-bs-dismiss=\"toast\"><div class=\"toast-body\">t.one{\"who\":\"&lt;b&gt;w&lt;/b&gt;\",\"text\":\"t.one\"}</div></div><div id=\"appToast2\" class=\"pano-toast animate__animated animate__bounceInUp toast align-items-center shadow-lg text-bg-tertiary opacity-100 text-success\" role=\"alert\" aria-live=\"assertive\" aria-atomic=\"true\" data-bs-dismiss=\"toast\"><div class=\"toast-body\">t.two{\"text\":\"t.two\"}</div></div></div>",
  "ToastContainer/empty": "<div class=\"pano-toast-container toast-container position-fixed bottom-0 start-50 translate-middle-x mb-3\"></div>",
  "CloseTicketConfirmModal/default": "<div aria-hidden=\"true\" class=\"pano-close-ticket-confirm-modal modal fade\" id=\"closeTicketConfirmModal\" role=\"dialog\" tabindex=\"-1\"><div class=\"modal-dialog modal-dialog-centered\" role=\"dialog\"><div class=\"modal-content\"><div class=\"pano-close-ticket-confirm-modal__body modal-body text-center\"> <div class=\"pb-3\"><i class=\"fas fa-question-circle fa-3x d-block m-auto text-gray\"></i></div> components.modals.close-ticket-confirm.title</div> <div class=\"pano-close-ticket-confirm-modal__footer modal-footer flex-nowrap\"><button class=\"pano-close-ticket-confirm-modal__action btn btn-link col-6 m-0\" data-bs-dismiss=\"modal\" type=\"button\" aria-disabled=\"false\">buttons.cancel</button> <button class=\"pano-close-ticket-confirm-modal__yes btn btn-danger col-6 m-0\" type=\"button\" aria-disabled=\"false\">buttons.yes</button></div></div></div></div>",
  "ConfirmRemoveAllNotificationsModal/default": "<div aria-hidden=\"true\" class=\"pano-confirm-remove-all-notifications-modal modal fade\" id=\"confirmDeleteAllNotifications\" role=\"dialog\" tabindex=\"-1\"><div class=\"modal-dialog modal-dialog-centered\" role=\"dialog\"><div class=\"modal-content\"><div class=\"pano-confirm-remove-all-notifications-modal__body modal-body text-center\"><div class=\"pb-3\"><i class=\"fas fa-question-circle fa-3x d-block m-auto text-gray\"></i></div> components.modals.confirm-remove-all-notifications.title</div> <div class=\"pano-confirm-remove-all-notifications-modal__footer modal-footer flex-nowrap\"><button class=\"pano-confirm-remove-all-notifications-modal__action btn btn-link col-6 m-0\" type=\"button\">buttons.cancel</button> <button class=\"pano-confirm-remove-all-notifications-modal__yes btn btn-danger col-6 m-0\" type=\"button\">buttons.yes</button></div></div></div></div>",
  "LogoutSessionConfirmModal/default": "<div aria-hidden=\"true\" class=\"pano-logout-session-confirm-modal modal fade\" id=\"logoutSessionConfirmModal\" role=\"dialog\" tabindex=\"-1\"><div class=\"modal-dialog modal-dialog-centered\" role=\"dialog\"><div class=\"modal-content\"><div class=\"pano-logout-session-confirm-modal__body modal-body text-center\"><div class=\"pb-3\"><i class=\"fas fa-question-circle fa-3x d-block m-auto text-gray\"></i></div> components.modals.logout-session-confirm.title</div> <div class=\"pano-logout-session-confirm-modal__footer modal-footer flex-nowrap\"><button class=\"pano-logout-session-confirm-modal__action btn btn-link col-6 m-0\" type=\"button\">buttons.cancel</button> <button class=\"pano-logout-session-confirm-modal__yes btn btn-danger col-6 m-0\" type=\"button\">buttons.yes</button></div></div></div></div>",
  "NotificationContainer/four": "<div class=\"pano-notification-container toast-container position-fixed bottom-0 end-0 p-3 d-xl-block d-none\"><article id=\"notificationToast1\" class=\"toast position-relative\" aria-live=\"assertive\" aria-atomic=\"true\"><div class=\"toast-header text-bg-primary\"><strong class=\"me-auto\">components.notification-container.notification</strong> <small>T7-1700000000000-object</small> <button type=\"button\" class=\"btn-close btn-close-white position-relative z-3\" aria-label=\"buttons.close\" data-bs-dismiss=\"toast\"></button></div> <div class=\"toast-body\"><div class=\"pano-notification-container__item fw-normal list-group-item list-group-item-action d-flex align-items-center gap-3 text-wrap\"><button type=\"button\" title=\"buttons.view\" class=\"text-start border-0 bg-transparent p-0 d-flex align-items-center gap-3\"><span class=\"d-flex align-items-center\"><i class=\"fa-solid fa-star fa-fw\"></i></span> <span class=\"text-start\"><span class=\"text-wrap markdown-renderer text-break\">notif.1{\"faIcon\":\"fa-solid fa-star\"}</span></span></button></div></div> <button type=\"button\" class=\"stretched-link p-0 border-0 bg-transparent position-absolute top-0 start-0 w-100 h-100\" aria-label=\"buttons.view\"></button></article><article id=\"notificationToast2\" class=\"toast position-relative\" aria-live=\"assertive\" aria-atomic=\"true\"><div class=\"toast-header text-bg-primary\"><strong class=\"me-auto\">components.notification-container.notification</strong> <small>T7-1700000000001-object</small> <button type=\"button\" class=\"btn-close btn-close-white position-relative z-3\" aria-label=\"buttons.close\" data-bs-dismiss=\"toast\"></button></div> <div class=\"toast-body\"><div class=\"pano-notification-container__item fw-normal list-group-item list-group-item-action d-flex align-items-center gap-3 text-wrap\"><button type=\"button\" title=\"buttons.view\" class=\"text-start border-0 bg-transparent p-0 d-flex align-items-center gap-3\"><span class=\"d-flex align-items-center\"><img src=\"/api/v1/profile/picture/bob?v9\" alt=\"buttons.view\" width=\"48\" height=\"48\" class=\"pano-notification-container__image rounded\"/></span> <span class=\"text-start\"><span class=\"text-wrap markdown-renderer text-break\">notif.2{\"username\":\"bob\"}</span></span></button></div></div> <button type=\"button\" class=\"stretched-link p-0 border-0 bg-transparent position-absolute top-0 start-0 w-100 h-100\" aria-label=\"buttons.view\"></button></article><article id=\"notificationToast3\" class=\"toast position-relative\" aria-live=\"assertive\" aria-atomic=\"true\"><div class=\"toast-header text-bg-primary\"><strong class=\"me-auto\">components.notification-container.notification</strong> <small>T7-1700000000002-object</small> <button type=\"button\" class=\"btn-close btn-close-white position-relative z-3\" aria-label=\"buttons.close\" data-bs-dismiss=\"toast\"></button></div> <div class=\"toast-body\"><div class=\"pano-notification-container__item fw-normal list-group-item list-group-item-action d-flex align-items-center gap-3 text-wrap\"><button type=\"button\" title=\"buttons.view\" class=\"text-start border-0 bg-transparent p-0 d-flex align-items-center gap-3\"><span class=\"d-flex align-items-center\"><img src=\"/i.png\" alt=\"buttons.view\" width=\"48\" height=\"48\" class=\"pano-notification-container__image rounded\"/></span> <span class=\"text-start\"><span class=\"text-wrap markdown-renderer text-break\">notif.3{\"image\":\"/i.png\",\"x\":\"<b>\"}</span></span></button></div></div> <button type=\"button\" class=\"stretched-link p-0 border-0 bg-transparent position-absolute top-0 start-0 w-100 h-100\" aria-label=\"buttons.view\"></button></article><article id=\"notificationToast4\" class=\"toast position-relative\" aria-live=\"assertive\" aria-atomic=\"true\"><div class=\"toast-header text-bg-primary\"><strong class=\"me-auto\">components.notification-container.notification</strong> <small>T7-1700000000003-object</small> <button type=\"button\" class=\"btn-close btn-close-white position-relative z-3\" aria-label=\"buttons.close\" data-bs-dismiss=\"toast\"></button></div> <div class=\"toast-body\"><div class=\"pano-notification-container__item fw-normal list-group-item list-group-item-action d-flex align-items-center gap-3 text-wrap\"><button type=\"button\" title=\"buttons.view\" class=\"text-start border-0 bg-transparent p-0 d-flex align-items-center gap-3\"><span class=\"d-flex align-items-center\"><i class=\"fa fa-fw fa-bolt\"></i></span> <span class=\"text-start\"><span class=\"text-wrap markdown-renderer text-break\">notif.4</span></span></button></div></div> <button type=\"button\" class=\"stretched-link p-0 border-0 bg-transparent position-absolute top-0 start-0 w-100 h-100\" aria-label=\"buttons.view\"></button></article></div>"
};

const WRAP_TOASTS = `<ToastContainer />
<script>
  import ToastContainer, { show, showSuccess } from "$pano/lib/components/ToastContainer.svelte";
  show("t.one", { who: "<b>w</b>" }).catch(() => {});
  showSuccess("t.two").catch(() => {});
</script>`;

const WRAP_WARNING = `<ToastContainer />
<script>
  import ToastContainer, { show } from "$pano/lib/components/ToastContainer.svelte";
  show("t.warn", {}, undefined, { variant: "warning" }).catch(() => {});
  show("t.none", {}, undefined, null).catch(() => {});
  show("t.custom", {}, CustomToast, { variant: "danger" }).catch(() => {});
  import CustomToast from "extra:custom-toast";
</script>`;

const NOTIFICATIONS = {
  notifications: writable([
    { id: 1, createdAt: "1700000000000", details: { faIcon: "fa-solid fa-star" } },
    { id: 2, createdAt: "1700000000001", details: { username: "bob" } },
    { id: 3, createdAt: "1700000000002", details: { image: "/i.png", x: "<b>" } },
    { id: 4, createdAt: "1700000000003", details: {} },
  ]),
  checkTime: 7,
  currentLanguage: readable({ dateFnsCode: "enUS" }),
  locales: { enUS: {} },
  avatarVersion: readable("v9"),
  getTime: (check, time, locale) => `T${check}-${time}-${typeof locale}`,
  onNotificationClick: () => {},
  navigate: () => {},
  notificationTextKey: (n) => `notif.${n.id}`,
  sanitizeObject: (o) => o,
  onClick: () => {},
};

const C = "$pano/lib/components/";
const CASES = {
  "Toast/neutral": { entry: `${C}Toast.svelte`, props: { id: 3 }, slot: "msg" },
  "Toast/success": { entry: `${C}Toast.svelte`, props: { id: 4, variant: "success" }, slot: "msg" },
  "Toast/danger": { entry: `${C}Toast.svelte`, props: { id: 5, variant: "danger" }, slot: "<b>m</b>" },
  "Toast/unknown": { entry: `${C}Toast.svelte`, props: { id: 6, variant: "x" }, slot: "msg" },
  "DefaultToast/plain": { entry: `${C}DefaultToast.svelte`, props: { id: 1, text: "a.b", values: {}, variant: null } },
  "DefaultToast/values": {
    entry: `${C}DefaultToast.svelte`,
    props: { id: 2, text: "a.b", values: { name: "<i>x</i>", n: 3 }, variant: "danger" },
  },
  "ToastContainer/with-toasts": { entry: "extra:wrap-toast", extraSvelte: { "extra:wrap-toast": WRAP_TOASTS } },
  "ToastContainer/empty": { entry: `${C}ToastContainer.svelte` },
  "CloseTicketConfirmModal/default": { entry: `${C}modals/CloseTicketConfirmModal.svelte` },
  "ConfirmRemoveAllNotificationsModal/default": { entry: `${C}modals/ConfirmRemoveAllNotificationsModal.svelte` },
  "LogoutSessionConfirmModal/default": { entry: `${C}modals/LogoutSessionConfirmModal.svelte` },
  // the controller needs the whole app (realtime, stores): the markup is rendered through the part
  "NotificationContainer/four": { entry: "$pano/lib/views/parts/NotificationContainer.svelte", props: NOTIFICATIONS },
};

describe.skipIf(!svelteDir)("engine parts (B): default render is unchanged", () => {
  beforeAll(() => {
    registry.resetRegistryForTests();
    registry.setThemeConfig({});
  });

  test("every expected render is covered", () => {
    expect(Object.keys(CASES).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  for (const [name, c] of Object.entries(CASES)) {
    test(`${name} renders the same HTML as before the split`, async () => {
      const html = await renderPart({ svelteDir, entry: c.entry, props: c.props ?? {}, slot: c.slot, extraSvelte: c.extraSvelte });
      expect(normalize(html)).toBe(EXPECTED[name]);
    });
  }
});

describe.skipIf(!svelteDir)("toasts: the 4th argument { variant }", () => {
  beforeAll(() => {
    registry.resetRegistryForTests();
    registry.setThemeConfig({});
  });

  test("a variant colours the toast, null and a custom component stay neutral", async () => {
    const html = await renderPart({
      svelteDir,
      entry: "extra:wrap-warning",
      extraSvelte: {
        "extra:wrap-warning": WRAP_WARNING,
        "extra:custom-toast": `<div class="custom" id="appToast{id}">{text}</div>\n<script>export let id; export let text;</script>`,
      },
    });

    const toast = (id) => html.match(new RegExp(`<div id="appToast${id}"[^>]*class="([^"]*)"`))?.[1] ?? "";
    expect(toast(1)).toContain("text-warning");
    expect(toast(2)).not.toMatch(/text-(success|danger|warning)/);
    // DefaultToast is replaced, so `variant` is not threaded into the custom component
    expect(html).toContain('<div class="custom" id="appToast3">t.custom</div>');
  });
});

// ---------------------------------------------------------------------------
// Overrides
// ---------------------------------------------------------------------------

describe.skipIf(!svelteDir)("engine parts (B): an override renders", () => {
  /** @type {string} */
  let dir;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "tc32-override-"));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    registry.resetRegistryForTests();
  });

  /** A server component written by hand (Svelte 5 server signature) so no compile step is needed. */
  const writeComponent = (file, body) => {
    writeFileSync(join(dir, file), `export default function Component($$renderer, $$props) {\n${body}\n}\n`);
  };

  /** Registers `name` with a default module and a theme override, then loads the override. */
  async function setup(name, overrideBody, { overrideContract } = {}) {
    registry.resetRegistryForTests();
    writeComponent(`${name}.default.mjs`, `$$renderer.push("<default/>");`);
    writeComponent(`${name}.override.mjs`, overrideBody);
    registry.registerEngineViews({ [name]: { contract: 1, component: () => import(join(dir, `${name}.default.mjs`)) } });
    registry.setThemeConfig({
      views: { [name]: { contract: overrideContract ?? 1, component: () => import(join(dir, `${name}.override.mjs`)) } },
    });
    await registry.preloadViews([name]);
  }

  test("an override of ToastContainer replaces the stack and receives the toasts store", async () => {
    await setup(
      "ToastContainer",
      [
        "let list = [];",
        "$$props.toasts.subscribe((v) => (list = v))();",
        "$$renderer.push(`<ol class=\"custom-toasts\" data-count=\"${list.length}\">${list.map((t) => `<li data-id=\"${t.id}\" data-text=\"${t.params.text}\" data-variant=\"${t.params.variant}\"></li>`).join(\"\")}</ol>`);",
      ].join("\n"),
    );
    expect(registry.getOverride("ToastContainer")).not.toBeNull();

    const html = await renderPart({
      svelteDir,
      entry: "extra:wrap",
      extraSvelte: {
        "extra:wrap": `<ToastContainer />
<script>
  import ToastContainer, { showError } from "$pano/lib/components/ToastContainer.svelte";
  showError("t.bad").catch(() => {});
</script>`,
      },
    });

    expect(html).toContain('<ol class="custom-toasts" data-count="1"><li data-id="1" data-text="t.bad" data-variant="danger"></li></ol>');
    expect(html).not.toContain("toast-container");
  });

  test("without a loaded override ToastContainer renders the default part", async () => {
    registry.resetRegistryForTests();
    registry.setThemeConfig({});
    const html = await renderPart({ svelteDir, entry: `${C}ToastContainer.svelte` });
    expect(html).toContain("toast-container position-fixed");
  });

  test("an override written for another contract is ignored and the default renders", async () => {
    await setup("ToastContainer", `$$renderer.push("<custom/>");`, { overrideContract: 2 });
    expect(registry.getOverride("ToastContainer")).toBeNull();
    expect(registry.getIssues().map((i) => i.type)).toContain("CONTRACT_MISMATCH");

    const html = await renderPart({ svelteDir, entry: `${C}ToastContainer.svelte` });
    expect(html).not.toContain("<custom/>");
  });

  test("an override of Toast gets the id, the variant, its class and the message slot", async () => {
    await setup(
      "Toast",
      [
        "$$renderer.push(`<aside class=\"custom-toast ${$$props.variantClass}\" data-id=\"${$$props.id}\" data-variant=\"${$$props.variant}\">`);",
        "$$props.children?.($$renderer);",
        "$$renderer.push(`</aside>`);",
      ].join("\n"),
    );

    const html = await renderPart({ svelteDir, entry: `${C}Toast.svelte`, props: { id: 9, variant: "warning" }, slot: "hello" });
    expect(html).toContain('<aside class="custom-toast text-warning" data-id="9" data-variant="warning">');
    expect(html).toContain("hello");
  });

  test("an override of DefaultToast gets the escaped message", async () => {
    await setup(
      "DefaultToast",
      "$$renderer.push(`<p class=\"custom-default\" data-text=\"${$$props.text}\">${$$props.message}</p>`);",
    );

    const html = await renderPart({
      svelteDir,
      entry: `${C}DefaultToast.svelte`,
      props: { id: 1, text: "a.b", values: { name: "<script>x</script>" }, variant: null },
    });
    expect(html).toContain('<p class="custom-default" data-text="a.b">a.b{"name":"&lt;script&gt;x&lt;/script&gt;"}</p>');
  });

  test("an override of NotificationContainer receives the stores, the formatters and the handlers", async () => {
    await setup(
      "NotificationContainer",
      [
        "const kinds = ['notifications', 'checkTime', 'currentLanguage', 'locales', 'avatarVersion', 'getTime', 'onNotificationClick', 'navigate', 'notificationTextKey', 'sanitizeObject', 'onClick'];",
        "$$renderer.push(`<div class=\"custom-notifications\">${kinds.map((k) => `${k}:${typeof $$props[k]}`).join(',')}</div>`);",
      ].join("\n"),
    );

    // The controller's own script needs the whole app (stores, realtime); a harness that renders
    // the registry choice exactly as the controller does is enough to show the props reach the override.
    const html = await renderPart({
      svelteDir,
      entry: "extra:notification-controller",
      props: NOTIFICATIONS,
      extraSvelte: {
        "extra:notification-controller": `<svelte:component this={getOverride("NotificationContainer")} {notifications} {checkTime} {currentLanguage} {locales} {avatarVersion} {getTime} {onNotificationClick} {navigate} {notificationTextKey} {sanitizeObject} {onClick} />
<script>
  import { getOverride } from "$pano/registry/index.js";
  export let notifications, checkTime, currentLanguage, locales, avatarVersion, getTime, onNotificationClick, navigate, notificationTextKey, sanitizeObject, onClick;
</script>`,
      },
    });

    expect(html).toContain(
      "notifications:object,checkTime:number,currentLanguage:object,locales:object,avatarVersion:object,getTime:function,onNotificationClick:function,navigate:function,notificationTextKey:function,sanitizeObject:function,onClick:function",
    );
  });

  test("an override of LogoutSessionConfirmModal keeps the dialog id and gets the handlers", async () => {
    await setup(
      "LogoutSessionConfirmModal",
      "$$renderer.push(`<dialog id=\"${$$props.dialogID}\" data-hide=\"${typeof $$props.hide}\" data-yes=\"${typeof $$props.onYesClick}\"></dialog>`);",
    );

    const html = await renderPart({ svelteDir, entry: `${C}modals/LogoutSessionConfirmModal.svelte` });
    expect(html).toContain('<dialog id="logoutSessionConfirmModal" data-hide="function" data-yes="function"></dialog>');
  });

  test("an override of CloseTicketConfirmModal gets the error store and the loading flag", async () => {
    await setup(
      "CloseTicketConfirmModal",
      "$$renderer.push(`<dialog id=\"${$$props.dialogID}\" data-error=\"${typeof $$props.error?.subscribe}\" data-loading=\"${$$props.loading}\"></dialog>`);",
    );

    const html = await renderPart({ svelteDir, entry: `${C}modals/CloseTicketConfirmModal.svelte` });
    expect(html).toContain('<dialog id="closeTicketConfirmModal" data-error="function" data-loading="false"></dialog>');
  });

  test("an override of ConfirmRemoveAllNotificationsModal keeps the dialog id", async () => {
    await setup(
      "ConfirmRemoveAllNotificationsModal",
      "$$renderer.push(`<dialog id=\"${$$props.dialogID}\" data-yes=\"${typeof $$props.onYesClick}\"></dialog>`);",
    );

    const html = await renderPart({ svelteDir, entry: `${C}modals/ConfirmRemoveAllNotificationsModal.svelte` });
    expect(html).toContain('<dialog id="confirmDeleteAllNotifications" data-yes="function"></dialog>');
  });
});

describe.skipIf(!svelteDir)("engine parts (B): the default parts render their props", () => {
  const render = (entry, props) => renderPart({ svelteDir, entry, props });

  test("CloseTicketConfirmModal shows the error and disables the buttons while loading", async () => {
    const html = await render("$pano/lib/views/parts/CloseTicketConfirmModal.svelte", {
      dialogID: "d1",
      error: writable("NETWORK_ERROR"),
      loading: true,
      hide: () => {},
      onYesClick: () => {},
    });

    expect(html).toContain('id="d1"');
    expect(html).toContain("alert alert-danger");
    expect(html).toContain("errors.NETWORK_ERROR");
    expect(html.match(/disabled/g)?.length).toBeGreaterThanOrEqual(4);
  });

  test("DefaultToast puts the message through {@html} and passes the variant on", async () => {
    registry.resetRegistryForTests();
    registry.setThemeConfig({});
    const html = await render("$pano/lib/views/parts/DefaultToast.svelte", { id: 5, text: "k", message: "<b>safe</b>", variant: "success" });
    expect(html).toContain('id="appToast5"');
    expect(html).toContain("text-success");
    expect(html).toContain("<b>safe</b>");
  });
});
