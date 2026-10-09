// `@panomc/sdk/toasts` outside a theme (doc 06 section 3.2). `showToast` raises a cancelable `pano:toast`; when nobody cancels it
// one shared `<pano-toasts>` element, appended to `body`, shows the text.
import { translate } from './language.js';
import { emit, eventTarget } from './runtime.js';

const TAG = 'pano-toasts';
const LIFETIME_MS = 4500;
const VARIANT_COLORS = { success: '#198754', danger: '#dc3545', warning: '#b58105' };

class PanoToasts extends (typeof HTMLElement === 'undefined' ? class {} : HTMLElement) {
  connectedCallback() {
    if (this.shadowRoot) return;
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      :host { position: fixed; z-index: 2147483000; left: 50%; bottom: 1rem; transform: translateX(-50%); display: flex; flex-direction: column; gap: .5rem; align-items: center; pointer-events: none; font: 14px/1.4 system-ui, sans-serif; }
      .toast { pointer-events: auto; max-width: min(28rem, 92vw); padding: .6rem .9rem; border-radius: .5rem; background: #212529; color: #fff; box-shadow: 0 .25rem 1rem rgba(0,0,0,.3); }
    </style><div part="list"></div>`;
    this._list = root.querySelector('div');
  }

  /** @param {string} message @param {string|null} [variant] */
  add(message, variant) {
    this.connectedCallback();
    const item = document.createElement('div');
    item.className = 'toast';
    item.setAttribute('role', 'status');
    item.dataset.variant = variant || '';
    item.textContent = message;
    if (variant && VARIANT_COLORS[variant]) item.style.borderLeft = `4px solid ${VARIANT_COLORS[variant]}`;
    this._list.append(item);
    setTimeout(() => item.remove(), LIFETIME_MS);
    return item;
  }
}

function ensureHost() {
  if (typeof document === 'undefined' || typeof customElements === 'undefined') return null;
  if (!customElements.get(TAG)) customElements.define(TAG, PanoToasts);
  let host = document.querySelector(TAG);
  if (!host) {
    host = document.createElement(TAG);
    document.body.append(host);
  }
  return host;
}

/**
 * @param {string} text a translation key (or a plain text when it has no translation)
 * @param {Record<string, any>} [params] values for the text
 * @param {unknown} [_toastComponent] kept for the theme signature; ignored
 * @param {{ variant?: 'success'|'danger'|'warning'|null }} [options]
 */
export async function showToast(text, params = {}, _toastComponent = undefined, options = {}) {
  if (!text) return;
  const variant = options?.variant ?? null;
  const message = translate(text, text, params);

  const proceed = emit(eventTarget(), 'pano:toast', { key: text, message, variant, values: params }, true);
  if (!proceed) return;

  ensureHost()?.add(message, variant);
}

export function limitTitle(text) {
  const limit = 32;
  return text.length > limit ? `${text.substring(0, limit)}...` : text;
}

export function showSuccess(text, params = {}) {
  return showToast(text, params, undefined, { variant: 'success' });
}

export function showError(text, params = {}) {
  return showToast(text, params, undefined, { variant: 'danger' });
}
