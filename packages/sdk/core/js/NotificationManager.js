const actionListeners = {};
let pluginListeners = {};

export function addListener(action, listener) {
  if (!actionListeners[action]) {
    actionListeners[action] = [];
  }

  actionListeners[action] = [...actionListeners[action], listener];
}

/**
 * Registers a plugin-provided click listener for a notification type.
 * @param {string} type
 * @param {(notification: object) => void} listener
 */
export function addPluginListener(type, listener) {
  pluginListeners[type] = [...(pluginListeners[type] || []), listener];
}

/** Drops every plugin listener (hosts call this in their `init()`). */
export function resetPluginListeners() {
  pluginListeners = {};
}

/**
 * Locale key of a notification's text.
 * @param {{ type: string, pluginId?: string }} n
 */
export function notificationTextKey(n) {
  return n.pluginId ? `plugins.${n.pluginId}.notifications.${n.type}` : `notifications.${n.type}`;
}

function isSafeHref(href) {
  return (
    typeof href === 'string' &&
    href.startsWith('/') &&
    !href.startsWith('//') &&
    !href.includes('\\') &&
    // eslint-disable-next-line no-control-regex
    !/[\u0000-\u001f\u007f]/.test(href)
  );
}

/**
 * Runs core listeners, then plugin listeners; when none exists and `details.href` is a safe
 * local path, calls `navigate(href)`.
 * @param {{ type: string, details?: { href?: string } }} notification
 * @param {(path: string) => void} [navigate]
 */
export function onNotificationClick(notification, navigate) {
  const core = actionListeners[notification.type] || [];
  const plugin = pluginListeners[notification.type] || [];

  core.forEach((listener) => listener(notification));
  plugin.forEach((listener) => listener(notification));

  if (core.length === 0 && plugin.length === 0) {
    const href = notification.details?.href;
    if (typeof navigate === 'function' && isSafeHref(href)) navigate(href);
  }
}
