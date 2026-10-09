// `defineWidget(tag, def, meta)` (doc 06 section 3.4): turns the module a plugin build emits for a widget view
// (`{ component, load, attrs, session }`) into a custom element.
//
//   connected     -> loading state -> controllers / text / session -> `load` -> `mount(component, { target, props })`
//   attribute     -> the props of the mounted component change
//   disconnected  -> `unmount`
//
// Events (bubbling, composed): `pano:ready`, `pano:error` { code }, `pano:toast` (see toasts.js), `pano:navigate` { url } (cancelable).
// States: load error -> inline message and a retry button; inactive plugin -> empty; `session: 'required'` and anonymous -> sign-in link.
// Attribute `no-shadow` renders in the light DOM (the sheets are linked in `head`).
import { mount, unmount } from './svelte-runtime.js';
import { createSubscriber } from 'svelte/reactivity';
import { getConfig, pageFetch, resolveUrl } from './config.js';
import { loadPluginControllers } from './controllers.js';
import { ensureLanguage, loadPluginTranslations, translate } from './language.js';
import { emit, registerWidget, unregisterWidget } from './runtime.js';
import { ensureSession, getSession } from './session.js';

const INACTIVE_CODES = new Set(['PLUGIN_INACTIVE', 'PLUGIN_NOT_FOUND']);

/**
 * @typedef {Object} WidgetMeta
 * @property {string} [ns]                  namespace, `data-pano-fb` of the wrapper
 * @property {string} [pluginId]            full plugin id (translations, controllers)
 * @property {{ fallback?: string, hash?: string, icons?: string }} [styles]  absolute URLs of the plugin's sheets (index.json)
 * @property {string} [controllers]         absolute URL of `controllers/controllers.mjs`, when the plugin has controllers
 * @property {'none'|'optional'|'required'} [session]  overrides the module's own value
 * @property {boolean} [active]             false: the plugin is inactive, the widget stays empty
 */

const kebab = (name) => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
const camel = (name) => name.replace(/-([a-z0-9])/g, (_m, c) => c.toUpperCase());

/** @param {Array<string | { name: string, type?: string }>} [attrs] */
function normalizeAttrs(attrs) {
  return (attrs ?? []).map((a) => {
    const name = typeof a === 'string' ? a : a.name;
    return { attr: kebab(name), prop: camel(name), type: typeof a === 'string' ? 'string' : (a.type ?? 'string') };
  });
}

function coerce(type, value) {
  if (value === null) return type === 'boolean' ? false : undefined;
  if (type === 'number') {
    const n = Number(value);
    return Number.isNaN(n) ? undefined : n;
  }
  if (type === 'boolean') return value !== 'false';
  return value;
}

function sheetHref(styles) {
  const href = styles?.fallback;
  if (!href) return null;
  return styles.hash && !href.includes('?') ? `${href}?v=${styles.hash}` : href;
}

function link(href) {
  const el = document.createElement('link');
  el.rel = 'stylesheet';
  el.href = href;
  return el;
}

function ensureHeadSheet(href) {
  if (!href) return;
  const exists = [...document.head.querySelectorAll('link[rel="stylesheet"]')].some((l) => l.getAttribute('href') === href);
  if (!exists) document.head.append(link(href));
}

/**
 * Props that Svelte reads through getters; `set` makes the dependent effects of the mounted component re-run.
 * @param {Record<string, any>} initial
 */
function reactiveProps(initial) {
  let values = { ...initial };
  /** @type {null | (() => void)} */
  let notify = null;
  const track = createSubscriber((update) => {
    notify = update;
    return () => {
      notify = null;
    };
  });

  const props = new Proxy(
    {},
    {
      get(_t, key) {
        track();
        return values[/** @type {string} */ (key)];
      },
      has(_t, key) {
        track();
        return key in values;
      },
      ownKeys() {
        track();
        return Reflect.ownKeys(values);
      },
      getOwnPropertyDescriptor(_t, key) {
        track();
        return key in values ? { enumerable: true, configurable: true, writable: true, value: values[/** @type {string} */ (key)] } : undefined;
      },
    },
  );

  return {
    props,
    set(next) {
      values = { ...next };
      notify?.();
    },
  };
}

/**
 * @param {string} tag custom element name, e.g. `pano-market-goal`
 * @param {{ component: any, load?: Function, attrs?: Array<string | { name: string, type?: string }>, session?: 'none'|'optional'|'required' }} def
 * @param {WidgetMeta} [meta]
 * @returns {CustomElementConstructor} the element class (already registered; an existing registration is kept)
 */
export function defineWidget(tag, def, meta = {}) {
  const existing = customElements.get(tag);
  if (existing) return existing;

  const attrs = normalizeAttrs(def.attrs);
  const typeOf = new Map(attrs.map((a) => [a.attr, a]));
  const sessionMode = meta.session ?? def.session ?? 'none';

  class PanoWidget extends HTMLElement {
    static get observedAttributes() {
      return attrs.map((a) => a.attr);
    }

    constructor() {
      super();
      this._gen = 0;
      this._instance = null;
      this._reactive = null;
      this._loaded = {};
      this._jsProps = {};
      this._root = null;
      this._container = null;
    }

    connectedCallback() {
      registerWidget(this);
      this._ensureStructure();
      void this._start(false);
    }

    disconnectedCallback() {
      this._gen += 1;
      this._unmount();
      unregisterWidget(this);
    }

    attributeChangedCallback() {
      if (this._instance) this._reactive?.set(this._currentProps());
    }

    /** Re-runs `load` (retry button, `invalidate`); the mounted component stays until the new data is there. */
    reload() {
      return this._start(true);
    }

    get props() {
      return { ...this._jsProps };
    }

    set props(value) {
      Object.assign(this._jsProps, value ?? {});
      if (this._instance) this._reactive?.set(this._currentProps());
    }

    _ensureStructure() {
      if (this._container) return;

      const shadow = !this.hasAttribute('no-shadow');
      const styles = meta.styles ?? {};
      const fallback = sheetHref(styles);

      const container = document.createElement('div');
      container.className = 'pano-fb';
      container.dataset.panoFb = meta.ns ?? '';

      if (shadow) {
        const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
        if (fallback) root.append(link(fallback));
        if (styles.icons) root.append(link(styles.icons));
        root.append(container);
        this._root = root;
      } else {
        ensureHeadSheet(fallback);
        ensureHeadSheet(styles.icons);
        this.append(container);
        this._root = this;
      }

      this._container = container;
    }

    _attrProps() {
      const out = {};
      for (const { attr, prop, type } of attrs) {
        const value = coerce(type, this.getAttribute(attr));
        if (value !== undefined) out[prop] = value;
      }
      return out;
    }

    _currentProps() {
      return { ...this._loaded, ...this._attrProps(), ...this._jsProps };
    }

    _setState(state) {
      this.dataset.panoState = state;
    }

    _unmount() {
      if (this._instance) {
        try {
          unmount(this._instance);
        } catch (e) {
          console.warn(`[pano-widgets] ${tag} unmount failed`, e);
        }
      }
      this._instance = null;
      this._reactive = null;
      if (this._container) this._container.replaceChildren();
    }

    _show(state, content) {
      this._unmount();
      this._setState(state);
      if (content) this._container.append(content);
    }

    _stateNode(state, role) {
      const el = document.createElement('div');
      el.className = 'pano-widget__state';
      el.dataset.panoStateView = state;
      if (role) el.setAttribute('role', role);
      return el;
    }

    _showError(error) {
      const code = error?.code ?? error?.error?.code ?? 'LOAD_FAILED';
      if (INACTIVE_CODES.has(code)) {
        this._show('inactive');
        return;
      }

      const node = this._stateNode('error', 'alert');
      const message = document.createElement('span');
      message.textContent = translate('widgets.error', 'This content could not be loaded.');
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.dataset.panoRetry = '';
      retry.textContent = translate('widgets.retry', 'Retry');
      retry.addEventListener('click', () => void this.reload());
      node.append(message, ' ', retry);

      this._show('error', node);
      emit(this, 'pano:error', { code });
    }

    _showSignIn() {
      const node = this._stateNode('signin');
      const a = document.createElement('a');
      a.href = resolveUrl(getConfig().urls['auth.login'] ? 'auth.login' : '/login');
      a.textContent = translate('widgets.sign-in', 'Sign in');
      node.append(a);
      this._show('signin', node);
    }

    async _start(soft) {
      const gen = (this._gen += 1);
      const stale = () => gen !== this._gen;

      if (meta.active === false) {
        this._show('inactive');
        return;
      }

      if (!soft || !this._instance) {
        this._show('loading', this._stateNode('loading'));
        this._container.firstChild?.setAttribute('aria-busy', 'true');
      }

      try {
        if (sessionMode !== 'none') {
          await ensureSession();
          if (stale()) return;
          if (sessionMode === 'required' && !getSession().user) {
            this._showSignIn();
            return;
          }
        }

        await Promise.all([
          meta.pluginId && meta.controllers
            ? loadPluginControllers({ pluginId: meta.pluginId, ns: meta.ns ?? '', url: meta.controllers })
            : null,
          ensureLanguage().then(() => (meta.pluginId ? loadPluginTranslations(meta.pluginId) : null)),
        ]);
        if (stale()) return;

        const attrProps = this._attrProps();
        const loaded =
          typeof def.load === 'function'
            ? await def.load({ fetch: (...a) => pageFetch(...a), params: attrProps, url: new URL(globalThis.location.href), widget: true }, attrProps)
            : {};
        if (stale()) return;

        this._loaded = loaded && typeof loaded === 'object' ? loaded : {};

        if (this._instance) {
          this._reactive?.set(this._currentProps());
          return;
        }

        this._unmount();
        this._reactive = reactiveProps(this._currentProps());
        this._instance = mount(def.component, { target: this._container, props: this._reactive.props });
        this._setState('ready');
        emit(this, 'pano:ready', { tag });
      } catch (error) {
        if (stale()) return;
        this._showError(error);
      }
    }
  }

  // JS properties for the declared attributes (`el.goalId = 3`); other props go through `el.props = { ... }`
  for (const { attr, prop } of attrs) {
    Object.defineProperty(PanoWidget.prototype, prop, {
      configurable: true,
      get() {
        return prop in this._jsProps ? this._jsProps[prop] : coerce(typeOf.get(attr).type, this.getAttribute(attr));
      },
      set(value) {
        this._jsProps[prop] = value;
        if (this._instance) this._reactive?.set(this._currentProps());
      },
    });
  }

  customElements.define(tag, PanoWidget);
  return PanoWidget;
}
