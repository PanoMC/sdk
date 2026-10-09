{#each items as item (item.id)}
  {@const Injected = injected(item)}
  {#if Injected}
    <Injected {...item.props} {...props} />
  {/if}
{/each}

<script>
  // `<PluginSlot id="market:checkout:payment" props={{ order }} filter={(item) => item.id === method} />`
  // (doc 01 section 6): a slot a plugin view opens. Renders the views other plugins injected into it
  // (`export const view = { slot: "market:checkout:payment" }`), in priority order. Items the theme
  // claims or hides are already left out by `panoApi.ui.view.get`. An empty slot renders nothing.
  //
  // An injected view is a plugin view like any other: a default one gets the fallback scope of its plugin in a theme
  // without Bootstrap, an override one gets a stop scope inside such a scope (`views.wrap`, doc 03 section 4.4).
  import { panoApi } from "$pano/lib/PluginAPI.js";
  import { getPanoContext } from "@panomc/sdk/internal";

  let { id, props = {}, filter } = $props();

  const store = $derived(panoApi.ui.view.get(id));
  const items = $derived(typeof filter === "function" ? ($store ?? []).filter(filter) : ($store ?? []));

  /**
   * The component of a resolved item (its `component` is the view module once the slot's load ran; a thunk that has
   * not run yet renders nothing), wrapped by `views.wrap` when it names a view.
   */
  function injected(item) {
    const module = item.component;

    if (!module || typeof module === "function") return null;

    const Component = module.default || module;
    const views = getPanoContext().context?.views;

    if (typeof item.view !== "string" || !item.view || typeof views?.wrap !== "function") return Component;

    return views.wrap(item.view, Component, views.getOverride?.(item.view) ? "override" : "default") ?? Component;
  }
</script>
