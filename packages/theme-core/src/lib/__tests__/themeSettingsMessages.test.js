import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";

// The theme-settings iframe takes messages only from its parent window on its own origin, posts only to that
// origin, gives confirmations unguessable ids and injects only same-origin stylesheets.

const win = new Window({ url: "https://site.test/theme-settings" });
const saved = {};
const posted = [];
const links = [];

mock.module("svelte", () => ({ onMount: (fn) => fn(), onDestroy: () => {} }));
mock.module("@sveltejs/kit", () => ({ redirect: () => new Error("redirect") }));
mock.module("$app/env", () => ({ browser: true, dev: false }));
mock.module("$pano/lib/auth.util", () => ({ hasPermission: () => true, Permissions: {} }));

let logic;

beforeAll(async () => {
  for (const key of ["window", "document", "ResizeObserver", "MessageEvent"]) saved[key] = globalThis[key];
  globalThis.window = win;
  globalThis.document = win.document;
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  globalThis.MessageEvent = win.MessageEvent;
  win.parent.postMessage = (data, target) => posted.push({ data, target });
  // Links are recorded, not loaded: the tests fire load / error themselves.
  const realAppend = win.document.head.appendChild.bind(win.document.head);
  win.document.head.appendChild = (el) => {
    if (el.tagName === "LINK") {
      el.remove = () => links.splice(links.indexOf(el), 1);
      links.push(el);
      return el;
    }
    return realAppend(el);
  };
  logic = await import("../ui-logics/layout-logics/ThemeSettingsLayoutLogics.js");
  logic.init();
});

afterAll(() => {
  for (const [key, value] of Object.entries(saved)) globalThis[key] = value;
});

const send = (data, { origin = "https://site.test", source = win.parent } = {}) =>
  win.dispatchEvent(new win.MessageEvent("message", { data, origin, source }));

describe("theme-settings iframe messages", () => {
  test("posts go to the own origin, never '*'", () => {
    logic.showSuccessToast("x");
    expect(posted.length).toBeGreaterThan(0);
    expect(posted.every((p) => p.target === "https://site.test")).toBe(true);
  });

  test("a confirm callback fires only for the parent on the own origin, with the unguessable id", () => {
    let fired = 0;
    posted.length = 0;
    logic.showConfirm("reset?", () => fired++);
    const id = posted.find((p) => p.data.type === "show-confirm").data.id;
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThanOrEqual(32);

    send({ type: "confirm-callback", id }, { origin: "https://evil.test" });
    send({ type: "confirm-callback", id }, { source: null });
    send({ type: "confirm-callback", id: 1 });
    expect(fired).toBe(0);

    send({ type: "confirm-callback", id });
    expect(fired).toBe(1);
  });

  test("only same-origin stylesheet links are injected", () => {
    send({ type: "inject-css-all", css: "", links: ["https://evil.test/x.css", "/panel/_app/a.css", "javascript:alert(1)"] });
    const hrefs = links.map((l) => l.getAttribute("href"));
    expect(hrefs).toEqual(["/panel/_app/a.css"]);
  });
});

describe("theme-settings stylesheet loading", () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const injected = () => links;

  test("a stylesheet that fails twice reports an error, never ready", async () => {
    links.length = 0;
    posted.length = 0;
    send({ type: "inject-css-all", css: "", links: ["/panel/_app/broken.css"] });
    injected()[0].onerror();
    await sleep(1100);
    expect(injected().length).toBe(1);
    injected()[0].onerror();
    await sleep(200);
    const types = posted.map((p) => p.data.type);
    expect(types).toContain("theme-settings-error");
    expect(types).not.toContain("theme-settings-ready");
  });

  test("ready is posted once every stylesheet loaded, also after one retry", async () => {
    links.length = 0;
    posted.length = 0;
    send({ type: "inject-css-all", css: "", links: ["/panel/_app/a.css", "/panel/_app/b.css"] });
    const [a] = injected();
    a.onerror();
    injected()[0].onload();
    await sleep(1100);
    injected().find((l) => l.getAttribute("href") === "/panel/_app/a.css").onload();
    await sleep(200);
    const types = posted.map((p) => p.data.type);
    expect(types).toContain("theme-settings-ready");
    expect(types).not.toContain("theme-settings-error");
  });
});
