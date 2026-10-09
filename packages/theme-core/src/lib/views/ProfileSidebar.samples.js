import { items, noop, SAMPLE_TIME, sampleUser } from "../../routes/catalogue/fixtures.js";

const store = (value) => ({ subscribe: (run) => (run(value), () => {}) });

const base = (extra = {}) => ({
  side: "left",
  showDeleteAll: false,
  onDeleteAllClick: noop,
  items: items([
    { id: "profile-info", component: null, props: {} },
    { id: "profile-nav", component: null, props: {} },
  ]),
  data: store({ lastActivityTime: SAMPLE_TIME, inGame: false, permissionGroupName: "Member", isBanned: false }),
  user: sampleUser,
  checkTime: 0,
  navEntries: [
    { id: "profile", href: "/profile", text: "buttons.profile", icon: "fas fa-user", badge: null, active: true },
    { id: "settings", href: "/settings", text: "buttons.settings", icon: "fas fa-cog", badge: null, active: false },
    { id: "notifications", href: "/notifications", text: "buttons.notifications", icon: "fas fa-bell", badge: 3, active: false },
  ],
  ...extra,
});

/** @type {import("../../routes/catalogue/model.js").Samples} */
export default {
  filled: { props: base({ showDeleteAll: true }) },
  empty: {
    label: "No cards, no navigation",
    props: base({ items: items([]), navEntries: [], user: {} }),
  },
};

export const notApplicable = ["loading", "error"];
