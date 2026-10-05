import { describe, expect, test } from "bun:test";

import {
  buildProfileNavEntries,
  isProfileNavActive,
  isSafeNavHref,
  mergeProfileNav,
  PROFILE_NAV_BUILTINS,
} from "../components/sidebars/profileNav.util.js";
import { createSlotRegistry } from "../../plugin-engine/engine.js";

const translate = (key) => `T(${key})`;

describe("mergeProfileNav (T6)", () => {
  test("builds the four built-ins with the specified priorities and hrefs", () => {
    const merged = mergeProfileNav([]);
    expect(merged.map((i) => [i.id, i.priority, i.props.href])).toEqual([
      ["profile", 100, "/profile"],
      ["settings", 90, "/profile/settings"],
      ["tickets", 80, "/tickets"],
      ["notifications", 70, "/notifications"],
    ]);
    expect(merged.every((i) => i.hidden === false)).toBe(true);
    expect(merged.map((i) => i.props.text)).toEqual([
      "buttons.profile",
      "buttons.settings",
      "buttons.tickets",
      "buttons.notifications",
    ]);
  });

  test("is idempotent: running it again adds nothing (load runs on every visit)", () => {
    const once = mergeProfileNav([]);
    expect(mergeProfileNav(once)).toEqual(once);
    expect(mergeProfileNav(mergeProfileNav(once)).length).toBe(PROFILE_NAV_BUILTINS.length);
  });

  test("a plugin item with a built-in id keeps its own version", () => {
    const mine = { id: "tickets", priority: 5, props: { href: "/my-tickets", text: "Mine" } };
    const merged = mergeProfileNav([mine]);

    expect(merged.filter((i) => i.id === "tickets")).toEqual([mine]);
    expect(merged.length).toBe(PROFILE_NAV_BUILTINS.length);
  });

  test("plugin items are kept and a non-array input is treated as empty", () => {
    const plugin = { id: "orders", priority: 85, props: { href: "/profile/orders", text: "Orders" } };
    expect(mergeProfileNav([plugin]).map((i) => i.id)).toEqual(["orders", "profile", "settings", "tickets", "notifications"]);
    expect(mergeProfileNav(undefined).length).toBe(PROFILE_NAV_BUILTINS.length);
  });

  test("does not mutate the frozen built-in definitions", () => {
    const merged = mergeProfileNav([]);
    merged[0].props.href = "/hacked";
    merged[0].priority = 0;
    expect(PROFILE_NAV_BUILTINS[0].props.href).toBe("/profile");
    expect(PROFILE_NAV_BUILTINS[0].priority).toBe(100);
  });
});

describe("isSafeNavHref", () => {
  test("site-relative hrefs pass", () => {
    for (const href of ["/", "/profile", "/profile/orders?x=1#a"]) expect(isSafeNavHref(href)).toBe(true);
  });

  test("anything else is rejected", () => {
    for (const href of ["//evil.com", "https://evil.com", "javascript:alert(1)", "/a\\b", "/a\nb", "profile", "", null, undefined, 3]) {
      expect(isSafeNavHref(href)).toBe(false);
    }
  });
});

describe("isProfileNavActive", () => {
  test("exact match only by default", () => {
    expect(isProfileNavActive("/profile", "", { href: "/profile" })).toBe(true);
    expect(isProfileNavActive("/profile/settings", "", { href: "/profile" })).toBe(false);
    expect(isProfileNavActive("/profile/", "", { href: "/profile" })).toBe(false);
  });

  test("startsWith matches sub-paths on a segment boundary", () => {
    const props = { href: "/profile/orders", startsWith: true };
    expect(isProfileNavActive("/profile/orders", "", props)).toBe(true);
    expect(isProfileNavActive("/profile/orders/42", "", props)).toBe(true);
    expect(isProfileNavActive("/profile/orders-old", "", props)).toBe(false);
    expect(isProfileNavActive("/profile", "", props)).toBe(false);
  });

  test("the base path is part of the comparison", () => {
    expect(isProfileNavActive("/app/profile", "/app", { href: "/profile" })).toBe(true);
    expect(isProfileNavActive("/profile", "/app", { href: "/profile" })).toBe(false);
    expect(isProfileNavActive("/app/profile/x", "/app", { href: "/profile", startsWith: true })).toBe(true);
  });
});

describe("buildProfileNavEntries", () => {
  const items = [
    { id: "a", priority: 100, props: { href: "/profile", text: "buttons.profile", icon: "fas fa-user" } },
    { id: "b", priority: 90, props: { href: "/profile/orders", text: "Orders", startsWith: true, badge: 3 } },
    { id: "bad", priority: 80, props: { href: "https://evil.com", text: "Evil" } },
    { id: "noprops", priority: 70 },
    { id: "empty-badge", priority: 60, props: { href: "/x", text: "X", badge: "" } },
  ];

  test("translates dotted text only, adds base, flags the active item, drops unusable items", () => {
    const entries = buildProfileNavEntries(items, { pathname: "/app/profile/orders/7", base: "/app", translate });

    expect(entries).toEqual([
      { id: "a", href: "/app/profile", text: "T(buttons.profile)", icon: "fas fa-user", badge: null, active: false },
      { id: "b", href: "/app/profile/orders", text: "Orders", icon: null, badge: "3", active: true },
      { id: "empty-badge", href: "/app/x", text: "X", icon: null, badge: null, active: false },
    ]);
  });

  test("a non-array input yields no entries", () => {
    expect(buildProfileNavEntries(undefined, { pathname: "/", translate })).toEqual([]);
  });
});

describe("profile-nav through the real slot registry", () => {
  function registry() {
    return createSlotRegistry({ getPlugins: () => ({}), browser: true });
  }

  test("built-ins merged by edit() are sorted by priority desc, de-duplicated and hide-able", () => {
    const slots = registry();
    const merge = (items) => items.splice(0, items.length, ...mergeProfileNav(items));

    // a plugin item registered first, then the sidebar load runs twice (two page visits)
    slots.edit("profile-nav", (items) =>
      items.push({ id: "orders", priority: 85, hidden: false, props: { href: "/profile/orders", text: "Orders" } }),
    );
    slots.edit("profile-nav", merge);
    slots.edit("profile-nav", merge);

    let seen = null;
    const unsubscribe = slots.get("profile-nav").subscribe((v) => (seen = v));
    expect(seen.map((i) => i.id)).toEqual(["profile", "settings", "orders", "tickets", "notifications"]);

    slots.edit("profile-nav", (items) => {
      items.find((i) => i.id === "tickets").hidden = true;
    });
    expect(seen.map((i) => i.id)).toEqual(["profile", "settings", "orders", "notifications"]);
    unsubscribe();
  });
});
