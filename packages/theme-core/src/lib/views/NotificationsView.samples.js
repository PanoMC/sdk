import { readable, writable } from "svelte/store";

import { SAMPLE_TIME, avatarVersion, noop } from "../../routes/catalogue/fixtures.js";

const list = [
  { id: 1, type: "SAMPLE", status: "NOT_READ", createdAt: SAMPLE_TIME, details: { faIcon: "fa-solid fa-ticket", href: "/tickets" } },
  { id: 2, type: "SAMPLE", status: "READ", createdAt: String(Number(SAMPLE_TIME) - 86400000), details: { username: "Staff" } },
  { id: 3, type: "SAMPLE", status: "READ", createdAt: String(Number(SAMPLE_TIME) - 172800000), details: {} },
];

const props = ({ notifications = list, count = notifications.length, loadingMore = false } = {}) => ({
  data: {},
  notifications: writable(notifications),
  count: readable(count),
  page: writable(0),
  loadMoreLoading: writable(loadingMore),
  checkTime: 0,
  avatarVersion: avatarVersion(),
  currentLanguage: readable({ dateFnsCode: "enUS" }),
  locales: {},
  onNotificationClick: noop,
  onDeleteNotificationClick: noop,
  getTime: () => "5 minutes ago",
  loadMore: noop,
  sanitizeObject: (details) => details,
});

/** @type {import("../../routes/catalogue/model.js").Samples} */
export default {
  filled: { props: props() },
  empty: { props: props({ notifications: [], count: 0 }) },
  "load-more": { label: "More to load", props: props({ count: 40 }) },
  loading: { label: "Loading more", props: props({ count: 40, loadingMore: true }) },
};

export const notApplicable = ["error"];
