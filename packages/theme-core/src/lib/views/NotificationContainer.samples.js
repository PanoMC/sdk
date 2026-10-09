import { readable } from "svelte/store";

import { SAMPLE_TIME, avatarVersion, noop } from "../../routes/catalogue/fixtures.js";

const props = (notifications) => ({
  notifications: readable(notifications),
  checkTime: 0,
  currentLanguage: readable({ dateFnsCode: "enUS" }),
  locales: {},
  avatarVersion: avatarVersion(),
  getTime: () => "just now",
  onNotificationClick: noop,
  navigate: noop,
  notificationTextKey: () => "notifications.UNKNOWN",
  sanitizeObject: (details) => details,
  onClick: noop,
});

/** @type {import("../../routes/catalogue/model.js").Samples} */
export default {
  filled: { props: props([{ id: 1, type: "SAMPLE", status: "NOT_READ", createdAt: SAMPLE_TIME, details: { faIcon: "fa-solid fa-ticket" } }]) },
  empty: { props: props([]) },
};

export const notApplicable = ["loading", "error"];
