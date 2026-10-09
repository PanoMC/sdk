import { readable } from "svelte/store";

const props = (extra = {}) => ({
  dev: false,
  devUi: false,
  pageTitle: readable("pages.profile.title"),
  resolvedTitle: { title: "Sample page", subtitle: "A subtitle", hidden: false },
  sidebar: readable(null),
  sidebarProps: readable({}),
  sidebarEnabled: true,
  sidebarPosition: "RIGHT",
  ...extra,
});

/** @type {import("../../routes/catalogue/model.js").Samples} */
export default {
  filled: { props: props() },
  empty: { label: "Title hidden", props: props({ resolvedTitle: { title: "Sample page", subtitle: "", hidden: true } }) },
  "left-sidebar": { label: "Sidebar on the left", props: props({ sidebarPosition: "LEFT" }) },
  "no-sidebar": { label: "Sidebar turned off", props: props({ sidebarEnabled: false }) },
};

export const notApplicable = ["loading", "error"];
