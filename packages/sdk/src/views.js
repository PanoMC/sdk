import { getPanoContext } from "./internal/index.js";

/**
 * Run-time proxy of a plugin view (`@panomc/sdk/views`, doc 01 section 4).
 *
 * The plugin build rewrites every import of a view file to a proxy module that
 * calls this with the view id (`market:ProductCard`) and the view's own compiled
 * component. At render time the proxy asks the host registry, through the pano
 * context on `globalThis` (the one object the browser copy and both server
 * copies of the SDK share), whether the active theme overrides the view.
 *
 * Outside a theme (panel, widget build) `context.views` is undefined, so the
 * default view always renders. `views.wrap` is the fallback-style hook of doc 03
 * section 4.4; it is the identity in a Bootstrap theme.
 *
 * @param {string} name view id, `<ns>:<Name>`
 * @param {Function} Default the plugin's own compiled Svelte component
 * @returns {Function} a Svelte 5 component function
 */
export const createViewProxy = (name, Default) =>
  function PanoView(anchorOrPayload, props) {
    const views = getPanoContext().context?.views;
    const Override = views?.getOverride?.(name);
    const C = Override ?? Default;

    return (
      views?.wrap?.(name, C, Override ? "override" : "default") ?? C
    )(anchorOrPayload, props);
  };
