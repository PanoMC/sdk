{#if !browser || data.viewSource === "override"}
  <!-- Server Side: Native Rendering to preserve Context ($page store).
       A view the theme overrides (doc 01 section 4) renders natively on the client too: it is the theme's own
       component, same Svelte, same contexts, so there is nothing to bridge. -->
  <!-- In a theme without Bootstrap a default view sits in the fallback scope of its plugin and an override nested
       in such a scope in a stop scope (`views.wrap`, doc 03 section 4.4); `Rendered` is the component itself otherwise. -->
  <svelte:component this={Rendered} {...data.props || {}} />
{:else}
  <!-- Client Side: Manual Mount to prevent Runtime Mismatch (effect_orphan) -->
  {#key data}
    <div
      use:mountPlugin
      class="plugin-view-container{scope.mode === 'fallback' ? ' pano-fb' : ''}"
      data-pano-fb={scope.mode === 'fallback' ? scope.ns : undefined}
    ></div>
  {/key}
{/if}

<script context="module">
  import { get } from "svelte/store";

  import { executeSidebarLoad, panoApi } from "$pano/lib/PluginAPI";
  import * as HomeSidebar from "$pano/lib/components/sidebars/HomeSidebar.svelte";
  import * as ProfileSidebar from "$pano/lib/components/sidebars/ProfileSidebar.svelte";
  import PluginSidebar from "$pano/lib/components/sidebars/PluginSidebar.svelte";

  import { loadPluginPage } from "./load.js";

  // The sidebars a plugin page may name with a string (`sidebar: "home"`); `HomePage.svelte` uses the
  // same set when a plugin page is the home page.
  export const sidebarDeps = {
    hosts: { home: HomeSidebar, profile: ProfileSidebar },
    PluginSidebar,
    executeSidebarLoad,
    countVisible: (sidebarId) => get(panoApi.ui.sidebar.get(sidebarId)).length,
  };

  /**
   * @type {import('@sveltejs/kit').PageLoad}
   */
  export async function load(event) {
    const { registeredPage } = await event.parent();

    return loadPluginPage(event, registeredPage, sidebarDeps);
  }
</script>

<script>
  import { mount, unmount, hydrate, getAllContexts } from 'svelte';
  import { getPanoContext } from '@panomc/sdk/internal';
  import { browser } from '$app/environment';
  import { SCOPE_CONTEXT } from '$pano/lib/fallbackStyles.js';

  export let data;

  const pageContexts = getAllContexts();

  /** The name the page was registered with (`<ns>:<Name>`); a legacy page (`component` only) has none. */
  $: viewName = data.registeredPage?.view;
  $: source = data.viewSource === 'override' ? 'override' : 'default';
  $: views = getPanoContext().context?.views;

  // Server and native branch: the component, wrapped when the theme has no Bootstrap. A named view goes through
  // `wrap`; a legacy page (`component` only, no view name) through `wrapInjected`, which gives it the `legacy` scope.
  $: Rendered = renderedComponent(viewName, source, views, data.component);

  // Client branch (manual mount, default views and legacy pages only): the scope goes on the container div and into
  // the context of the mounted component. Asking `wrap` / `wrapInjected` also registers the stylesheets the view
  // needs; a wrapped component carries its scope as `.scope`.
  $: scope = clientScope(viewName, source, views, data.component) ?? { mode: null, ns: '' };

  function renderedComponent(name, current, hooks, module) {
    if (name) {
      return (!browser || current === 'override') && typeof hooks?.wrap === 'function'
        ? (hooks.wrap(name, module.default, current) ?? module.default)
        : module.default;
    }

    return !browser && typeof hooks?.wrapInjected === 'function'
      ? (hooks.wrapInjected(module) ?? module.default)
      : module.default;
  }

  function clientScope(name, current, hooks, module) {
    if (!browser) return null;

    if (name) {
      return current === 'default' && typeof hooks?.wrap === 'function'
        ? hooks.wrap(name, module.default, current)?.scope
        : null;
    }

    return typeof hooks?.wrapInjected === 'function' ? hooks.wrapInjected(module)?.scope : null;
  }

  /**
   * The page's contexts, plus the fallback scope the container opens (views below it must not wrap again).
   * A copy: the map belongs to the parent component, and its other children read it.
   */
  function scopedContexts(current) {
    if (current.mode !== 'fallback') return pageContexts;

    const copy = new Map(pageContexts);

    copy.set(SCOPE_CONTEXT, current.ns);

    return copy;
  }

  function mountPlugin(viewContainer) {
    if (!browser || !viewContainer || !data.component?.default) return;

    let componentInstance;

    const contexts = scopedContexts(scope);

    try {
      if (data.component.hydrate) {
        try {
          componentInstance = data.component.hydrate({
            target: viewContainer,
            props: { ...(data.props || {}), panoContexts: contexts },
            context: contexts
          });
        } catch (hErr) {
          console.warn('Plugin Hydration Failed (Mismatch), falling back to Clean Mount:', hErr);
          viewContainer.innerHTML = '';
          componentInstance = data.component.mount({
            target: viewContainer,
            props: { ...(data.props || {}), panoContexts: contexts },
            context: contexts
          });
        }
      }
      // Legacy/Fallback for non-bridged (Native)
      else {
        try {
          componentInstance = hydrate(data.component.default, {
            target: viewContainer,
            props: { ...(data.props || {}), panoContexts: contexts },
            context: contexts
          });
        } catch (hErr) {
          viewContainer.innerHTML = '';
          componentInstance = mount(data.component.default, {
            target: viewContainer,
            props: { ...(data.props || {}), panoContexts: contexts },
            context: contexts
          });
        }
      }
    } catch (err) {
      console.warn('Mount failed completely:', err);
    }

    return {
      destroy() {
        if (componentInstance) {
          try {
            if (data.component?.unmount) {
              data.component.unmount(componentInstance);
            } else {
              unmount(componentInstance);
            }
          } catch (e) {
            if (componentInstance?.$destroy) componentInstance.$destroy();
          }
        }
      }
    };
  }
</script>
