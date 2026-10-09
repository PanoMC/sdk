import { onNotificationClick as onNotificationClickWithPaths } from "@panomc/sdk/core/js/NotificationManager.js";

import { publicHref } from "./views/parts/publicHref.js";

export * from "@panomc/sdk/core/js/NotificationManager.js";

/**
 * Same as the SDK's: runs the listeners, or navigates to the notification's `details.href`. The href is a
 * canonical site path; it goes through `route()` so a renamed route (`/store` -> `/shop`) is opened at the
 * path the theme publishes (doc 01 section 9).
 * @param {{ type: string, details?: { href?: string } }} notification
 * @param {(path: string) => void} [navigate]
 */
export function onNotificationClick(notification, navigate) {
  return onNotificationClickWithPaths(
    notification,
    typeof navigate === "function" ? (path) => navigate(/** @type {string} */ (publicHref(path))) : navigate,
  );
}
