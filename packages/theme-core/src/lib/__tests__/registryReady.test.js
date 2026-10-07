import { describe, expect, mock, test } from "bun:test";

mock.module("$app/environment", () => ({ dev: false, browser: false }));

const { resolveView, setThemeConfig } = await import("../../registry/index.js");

const Override = { default: "OVERRIDE" };
const defaultThunk = async () => ({ default: "DEFAULT" });

describe("resolveView vs setThemeConfig ordering", () => {
  test("resolveView called BEFORE setThemeConfig still yields the theme override", async () => {
    const pending = resolveView("HomeView", defaultThunk);
    // layout module finishes evaluating after the page load already started
    await new Promise((r) => setTimeout(r, 10));
    setThemeConfig({ views: { HomeView: () => Promise.resolve(Override) } });
    expect(await pending).toBe("OVERRIDE");
  });

  test("resolveView called AFTER setThemeConfig yields the theme override", async () => {
    expect(await resolveView("HomeView", defaultThunk)).toBe("OVERRIDE");
  });

  test("a view without an override still falls back to the default", async () => {
    expect(await resolveView("OtherView", defaultThunk)).toBe("DEFAULT");
  });
});
