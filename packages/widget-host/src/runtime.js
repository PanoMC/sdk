// Shared page state of the widget host that is not configuration: the mounted widgets and the element events go to.

/** @typedef {HTMLElement & { reload?: () => Promise<void> }} WidgetElement */

/** @type {Set<WidgetElement>} */
const active = new Set();
/** @type {WidgetElement | null} */
let lastTarget = null;

export function registerWidget(element) {
  active.add(element);
  lastTarget = element;
}

export function unregisterWidget(element) {
  active.delete(element);
  if (lastTarget === element) lastTarget = [...active].pop() ?? null;
}

export const activeWidgets = () => [...active];

/** Where `pano:toast` / `pano:navigate` raised outside a widget go: the most recent widget, else the document. */
export function eventTarget() {
  return lastTarget ?? (typeof document !== 'undefined' ? document : null);
}

/**
 * @param {EventTarget | null} target
 * @param {string} name
 * @param {any} [detail]
 * @param {boolean} [cancelable]
 * @returns {boolean} false when a listener cancelled it
 */
export function emit(target, name, detail, cancelable = false) {
  if (!target || typeof CustomEvent === 'undefined') return true;
  return target.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true, cancelable }));
}

/** A thrown `error(status, message)` or a failed load; `code` ends up in `pano:error`. */
export class WidgetError extends Error {
  /** @param {number} status @param {string} [message] @param {string} [code] */
  constructor(status, message, code) {
    super(message || `HTTP ${status}`);
    this.name = 'WidgetError';
    this.status = status;
    this.body = { message: message || `HTTP ${status}` };
    this.code = code || `HTTP_${status}`;
  }
}
