import { describe, expect, mock, test } from "bun:test";
import { get } from "svelte/store";

mock.module("$app/paths", () => ({ base: "" }));
mock.module("$app/environment", () => ({ browser: false, dev: false }));

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const LOCALES = [
  { code: "en-US", name: "English" },
  { code: "tr-TR", name: "Turkce" },
  { code: "de-DE", name: "Deutsch" },
];
const WORDS = { "en-US": "hello", "tr-TR": "merhaba", "de-DE": "hallo" };
// the per-locale translation fetch is slower for tr-TR, so the requests finish out of order
const LATENCY = { "en-US": 1, "tr-TR": 30, "de-DE": 5 };

mock.module("$pano/lib/api.util.js", () => ({
  default: {
    get: async ({ path }) => {
      if (path === "/locales") return { data: LOCALES };
      const code = path.split("/")[2];
      await delay(LATENCY[code]);
      return { data: {} };
    },
  },
}));

const { init, activateLanguage, currentLanguage } = await import("../language.util.js");
const { _, locale } = await import("svelte-i18n");

const event = (code) => ({
  fetch: async (url) => {
    const c = String(url).match(/languages\/(.+)\.json/)[1];
    await delay(LATENCY[c]);
    return { json: async () => ({ greeting: WORDS[c] }) };
  },
});

// "render" = the synchronous part of SSR: reads the global stores, no await.
const render = () => ({ text: get(_)("greeting"), lang: get(currentLanguage)?.code, locale: get(locale) });

describe("concurrent SSR requests with different locales", () => {
  test("each render sees its own language after activateLanguage", async () => {
    const [a, b] = await Promise.all([init("tr-TR", event("tr-TR")), init("de-DE", event("de-DE"))]);

    // tr-TR finished last: without re-activation the de-DE request would render Turkish (the leak)
    expect(render().text).toBe("merhaba");

    activateLanguage(a);
    expect(render()).toEqual({ text: "merhaba", lang: "tr-TR", locale: "tr-TR" });

    activateLanguage(b);
    expect(render()).toEqual({ text: "hallo", lang: "de-DE", locale: "de-DE" });
  });
});
