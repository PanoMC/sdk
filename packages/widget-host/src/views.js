// `@panomc/sdk/views` in a widget (doc 06 section 3.2): the real proxy. A widget page has no `context.views`,
// so the plugin's own default view always renders.
import { getPanoContext } from './context.js';

/**
 * @param {string} name view id, `<ns>:<Name>`
 * @param {Function} Default the plugin's own compiled Svelte component
 * @returns {Function} a Svelte 5 component function
 */
export const createViewProxy = (name, Default) =>
  function PanoView(anchorOrPayload, props) {
    const views = getPanoContext().context?.views;
    const Override = views?.getOverride?.(name);
    const C = Override ?? Default;

    return (views?.wrap?.(name, C, Override ? 'override' : 'default') ?? C)(anchorOrPayload, props);
  };
