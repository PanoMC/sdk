/**
 * Pure helpers for the profile sidebar navigation (market plugin spec 15 section 4.6).
 *
 * The `profile-nav` view slot holds `{ id, priority, hidden?, props: { href, text, icon?, startsWith?, badge? } }`
 * items. The built-ins below are registered by the profile sidebar's `load`; plugins add their own
 * through `pano.ui.profile.nav.edit`.
 */

/** Built-in entries, reusing the label keys of the navbar profile dropdown. */
export const PROFILE_NAV_BUILTINS = Object.freeze([
  { id: "profile", priority: 100, props: { href: "/profile", text: "buttons.profile", icon: "fas fa-user" } },
  {
    id: "settings",
    priority: 90,
    props: { href: "/profile/settings", text: "buttons.settings", icon: "fas fa-gear" },
  },
  { id: "tickets", priority: 80, props: { href: "/tickets", text: "buttons.tickets", icon: "fas fa-ticket" } },
  {
    id: "notifications",
    priority: 70,
    props: { href: "/notifications", text: "buttons.notifications", icon: "fas fa-bell" },
  },
]);

/**
 * Adds the built-ins that no item with the same id already covers. A plugin that registered an
 * item with a built-in id (to replace or reorder it) keeps its own version; calling this on every
 * page load never duplicates anything.
 *
 * @param {Array<{ id?: string }>} items  the current slot content
 * @returns {Array<object>} a new array: existing items first, then the missing built-ins
 */
export function mergeProfileNav(items) {
  const existing = Array.isArray(items) ? items : [];
  const ids = new Set(existing.map((item) => item?.id));
  const missing = PROFILE_NAV_BUILTINS.filter((item) => !ids.has(item.id)).map((item) => ({
    ...item,
    hidden: false,
    props: { ...item.props },
  }));

  return [...existing, ...missing];
}

/**
 * A nav `href` must be site-relative: starts with "/", not protocol-relative, no backslash, no
 * control characters.
 * @param {unknown} href
 */
export function isSafeNavHref(href) {
  return (
    typeof href === "string" &&
    href.startsWith("/") &&
    !href.startsWith("//") &&
    !href.includes("\\") &&
    // eslint-disable-next-line no-control-regex
    !/[\u0000-\u001f\u007f]/.test(href)
  );
}

/**
 * Active state of a nav item: the exact path, or any sub-path when `props.startsWith` is set.
 * @param {string} pathname
 * @param {string} base  the SvelteKit base path ("" when none)
 * @param {{ href: string, startsWith?: boolean }} props
 */
export function isProfileNavActive(pathname, base, props) {
  const target = (base || "") + props.href;

  if (pathname === target) return true;

  return Boolean(props.startsWith) && pathname.startsWith(target + "/");
}

/**
 * Turns slot items into render entries: items without usable props/href are dropped, the text is
 * translated when it contains a dot (the navbar dropdown rule), `href` gets the base path and the
 * active flag is computed. The order of `items` is kept (the slot already sorts by priority).
 *
 * @param {Array<object>} items  visible items of the `profile-nav` slot
 * @param {{ pathname: string, base?: string, translate: (key: string) => string }} context
 * @returns {Array<{ id: string, href: string, text: string, icon: string | null, badge: string | null, active: boolean }>}
 */
export function buildProfileNavEntries(items, { pathname, base = "", translate }) {
  const entries = [];

  for (const item of Array.isArray(items) ? items : []) {
    const props = item?.props;

    if (!props || !isSafeNavHref(props.href)) continue;

    const text = typeof props.text === "string" ? props.text : "";

    entries.push({
      id: String(item.id),
      href: base + props.href,
      text: text.includes(".") ? translate(text) : text,
      icon: typeof props.icon === "string" && props.icon ? props.icon : null,
      badge: props.badge === undefined || props.badge === null || props.badge === "" ? null : String(props.badge),
      active: isProfileNavActive(pathname, base, props),
    });
  }

  return entries;
}
