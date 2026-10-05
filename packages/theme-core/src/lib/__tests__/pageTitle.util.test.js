import { describe, expect, test } from "bun:test";
import { resolvePageTitle } from "../pageTitle.util.js";

const dict = { "page.home": "Home", "page.hello": "Hello {name}", "page.sub": "Subtitle" };
// Mimics svelte-i18n: unknown keys come back as the key itself, {name} is interpolated.
const calls = [];
const translate = (key, options) => {
  calls.push([key, options]);
  const template = dict[key] ?? key;

  return template.replace(/\{(\w+)\}/g, (_, name) => options?.values?.[name] ?? `{${name}}`);
};

describe("resolvePageTitle (TC-3)", () => {
  test("string key is translated", () => {
    expect(resolvePageTitle("page.home", translate)).toEqual({
      title: "Home",
      subtitle: "",
      hidden: false,
    });
  });

  test("object form translates title and subtitle", () => {
    expect(resolvePageTitle({ title: "page.home", subtitle: "page.sub" }, translate)).toEqual({
      title: "Home",
      subtitle: "Subtitle",
      hidden: false,
    });
  });

  test("raw: title and subtitle are used verbatim, translate is never called", () => {
    calls.length = 0;

    const out = resolvePageTitle(
      { title: "page.home", subtitle: "page.sub", raw: true },
      translate,
    );

    expect(out).toEqual({ title: "page.home", subtitle: "page.sub", hidden: false });
    expect(calls).toHaveLength(0);
  });

  test("raw only counts when it is exactly true", () => {
    expect(resolvePageTitle({ title: "page.home", raw: "yes" }, translate).title).toBe("Home");
  });

  test("hidden flag is passed through", () => {
    expect(resolvePageTitle({ title: "page.home", hidden: true }, translate)).toEqual({
      title: "Home",
      subtitle: "",
      hidden: true,
    });
    expect(resolvePageTitle({ title: "x", raw: true, hidden: true }, translate).hidden).toBe(true);
    expect(resolvePageTitle({ title: "page.home", hidden: "yes" }, translate).hidden).toBe(false);
  });

  test("titleValues / subtitleValues are interpolated", () => {
    const out = resolvePageTitle(
      {
        title: "page.hello",
        titleValues: { name: "Steve" },
        subtitle: "page.hello",
        subtitleValues: { name: "Alex" },
      },
      translate,
    );

    expect(out.title).toBe("Hello Steve");
    expect(out.subtitle).toBe("Hello Alex");
  });

  test("missing values default to an empty object (as before)", () => {
    calls.length = 0;
    resolvePageTitle({ title: "page.home" }, translate);
    expect(calls[0]).toEqual(["page.home", { values: {} }]);
  });

  test("raw ignores values and does not interpolate", () => {
    const out = resolvePageTitle(
      { title: "Hello {name}", titleValues: { name: "Steve" }, raw: true },
      translate,
    );
    expect(out.title).toBe("Hello {name}");
  });

  test("empty / absent parts resolve to empty strings", () => {
    for (const pt of [null, undefined, "", {}, { title: "" }, 5, true]) {
      expect(resolvePageTitle(pt, translate)).toEqual({ title: "", subtitle: "", hidden: false });
    }
    expect(resolvePageTitle({ subtitle: "page.sub" }, translate)).toEqual({
      title: "",
      subtitle: "Subtitle",
      hidden: false,
    });
  });
});
