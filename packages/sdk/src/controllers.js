/**
 * Svelte wrapper over the controller registry (doc 02 §2), exported as `@panomc/sdk/controllers`.
 * Plain JS on `createSubscriber`: rune-style reads without rune compilation.
 */
import { createSubscriber } from 'svelte/reactivity';
import { onMount } from 'svelte';
import * as registry from '../core/js/ControllerRegistry.js';
import { getPanoContext } from './internal/index.js';

/**
 * @typedef {{name:string, version:number, get:()=>any, subscribe:(run:(s:any)=>void)=>(()=>void), actions:any, destroy:()=>void}} Controller
 */

/**
 * Wraps a controller so `.state` is a tracked getter: reading it inside an effect or a template re-runs on change.
 * @param {Controller} controller
 * @returns {{ state: any, actions: any, controller: Controller }}
 */
export function reactive(controller) {
  const track = createSubscriber((update) => {
    let ready = false;
    // subscribe() calls back synchronously once with the current state; that is not a change
    const unsubscribe = controller.subscribe(() => {
      if (ready) update();
    });
    ready = true;
    return unsubscribe;
  });

  return {
    controller,
    actions: controller.actions,
    get state() {
      track();
      return controller.get();
    },
  };
}

/**
 * Registry `use` plus `reactive`. Returns null when the controller is unavailable (missing plugin, version mismatch).
 * An `instance` scoped controller is destroyed when the calling component unmounts.
 * @param {string} name `<namespace>/<controller>`
 * @param {{version?:number, params?:object, initial?:object, event?:any}} [opts]
 */
export function useController(name, opts) {
  const controller = registry.use(name, opts);
  if (!controller) return null;

  const isInstance = registry.list().find((c) => c.name === name)?.scope === 'instance';

  if (isInstance && typeof window !== 'undefined') {
    try {
      onMount(() => () => controller.destroy());
    } catch {
      // called outside a component: the caller owns destroy()
    }
  }

  return reactive(controller);
}

/**
 * @param {string} namespace
 */
export function plugin(namespace) {
  const pluginId = () => registry.pluginIdOf(namespace) ?? `pano-plugin-${namespace}`;
  const prefix = () => `plugins.${pluginId()}.`;
  const fullName = (name) => `${namespace}/${name}`;
  const language = () => getPanoContext().context?.utils?.language?._;

  /** readable store of `(key, values) => string` */
  const _ = {
    subscribe(run) {
      const source = language();
      const p = prefix();

      if (!source || typeof source.subscribe !== 'function') {
        run((key) => `${p}${key}`);
        return () => {};
      }

      return source.subscribe(($fn) => {
        run((key, values) => $fn(`${p}${key}`, toI18nOptions(values)));
      });
    },
  };

  return {
    get id() {
      return pluginId();
    },
    namespace,
    get installed() {
      return registry.pluginIdOf(namespace) !== undefined;
    },
    _,
    /**
     * @param {string} key key inside the plugin's text; the `plugins.<pluginId>.` prefix is added
     * @param {{variant?:'success'|'danger'|'warning', values?:object}} [o]
     */
    toast(key, o) {
      const show = getPanoContext().context?.utils?.toast?.show;
      if (typeof show !== 'function') return;
      const options = o?.variant ? { variant: o.variant } : undefined;
      return show(`${prefix()}${key}`, o?.values ?? {}, undefined, options);
    },
    use(name, opts) {
      return useController(fullName(name), opts);
    },
    require(name, opts) {
      const c = useController(fullName(name), opts);
      if (!c) throw new Error(`${fullName(name)} is not available`);
      return c;
    },
    load(name, opts) {
      return registry.load(fullName(name), opts);
    },
  };
}

// `values` object (doc 02) or an svelte-i18n options object ({ values, default, ... }) are both accepted
function toI18nOptions(arg) {
  if (!arg || typeof arg !== 'object') return undefined;
  if ('values' in arg || 'default' in arg || 'locale' in arg || 'format' in arg) return arg;
  return { values: arg };
}
