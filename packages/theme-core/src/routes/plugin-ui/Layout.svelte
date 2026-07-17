<style>
  .plugin-layout-container {
    width: 100%;
    height: 100%;
  }
</style>

{#if data.systemLayout}
  <svelte:component this={data.systemLayout} {data}>
    <div
      bind:this={layoutContainer}
      class="plugin-layout-container"
      style={data.layout ? '' : 'display: none;'}>
    </div>

    <div
      bind:this={slotContentContainer}
      class="plugin-content-wrapper"
      style={data.layout ? 'display: none;' : ''}>
      {#key data}
        <slot />
      {/key}
    </div>
  </svelte:component>
{:else}
  <div
    bind:this={layoutContainer}
    class="plugin-layout-container"
    style={data.layout ? '' : 'display: none;'}>
  </div>

  <div
    bind:this={slotContentContainer}
    class="plugin-content-wrapper"
    style={data.layout ? 'display: none;' : ''}>
    {#key data}
      <slot />
    {/key}
  </div>
{/if}

<script context="module">
  import { error } from "@sveltejs/kit";

  import { findMatch, registeredPages } from "$pano/lib/PluginManager.js";
  import { base } from "$app/paths";
  import { hasPermission } from "$pano/lib/auth.util.js";


  const layouts = import.meta.glob('$pano/lib/layouts/*.svelte', { eager: true });

  const layoutMap = Object.keys(layouts).reduce((acc, path) => {
    const name = path.split('/').pop().replace('.svelte', '');
    acc[name] = layouts[path];
    return acc;
  }, {});

  function removePrefix(str, prefix) {
    return str.startsWith(prefix) ? str.slice(prefix.length) : str;
  }

  /**
   * @type {import("@sveltejs/kit").PageLoad}
   */
  export async function load(event) {
    const {
      url: { pathname },
      parent,
    } = event;
    const { session: { user } } = await parent();

    const registeredPage = findMatch(registeredPages, removePrefix(pathname, base));

    if (registeredPage === undefined || registeredPage === null) {
      throw error(404);
    }

    if (registeredPage.permission && !hasPermission(registeredPage.permission, user)) {
      throw error(404);
    }

    const resetLayout = registeredPage.resetLayout || false;

    let systemLayout = null;
    let systemLayoutOutput = {};
    if (registeredPage.systemLayout) {
      const systemLayoutModule = layoutMap[registeredPage.systemLayout];
      if (systemLayoutModule) {
        systemLayout = systemLayoutModule.default;
        if (typeof systemLayoutModule.load === 'function') {
          systemLayoutOutput = await systemLayoutModule.load(event);
        }
      }
    }

    let layoutOutput = {};
    let layout = null;
    if (registeredPage.layout) {
      // Check if layout is a function (async import) or object
      const layoutModule =
        typeof registeredPage.layout === 'function'
          ? await registeredPage.layout()
          : registeredPage.layout;
      layout = layoutModule;

      if (layout.load !== undefined) {
        layoutOutput = await layout.load(event);
      }
    }

    const output = {
      registeredPage,
      layout,
      systemLayout,
      props: layoutOutput,
      params: registeredPage.params,
      ...systemLayoutOutput,
      resetLayout
    };

    // Expose layout-consumed fields from the plugin layout's load output
    // at the top level so they end up on page.data (e.g. pageTitle, sidebar).
    if (layoutOutput && typeof layoutOutput === "object") {
      for (const key of ["pageTitle", "breadcrumbs", "sidebar", "sidebarProps"]) {
        if (layoutOutput[key] !== undefined) {
          output[key] = layoutOutput[key];
        }
      }
    }

    return output;
  }
</script>

<script>
  import { mount, unmount, getAllContexts } from 'svelte';
  import { browser } from '$app/environment';


  let { data } = $props();

  const contexts = getAllContexts();

  let layoutContainer = $state();
  let slotContentContainer = $state();
  let layoutInstance = null;
  let activeLayoutComp = null;

  // The slot wrapper's NATURAL DOM position (where Svelte rendered it, inside the theme
  // shell / systemLayout). Captured on first bind — BEFORE any bridging move — so pages
  // without a plugin layout can always be restored to normal document flow.
  let slotHome = null;

  $effect(() => {
    if (!browser || !slotContentContainer || slotHome) return;
    slotHome = {
      parent: slotContentContainer.parentNode,
      anchor: slotContentContainer.nextSibling,
    };
  });

  // A stable parent the slot content survives layout TEARDOWN in: before destroying a
  // mounted layout we park the slot content here so the live <slot> subtree is never
  // torn out together with the layout.
  function stableSlotParent() {
    return browser ? document.body : null;
  }

  // Put the slot wrapper back where Svelte originally rendered it (its SSR position).
  function restoreSlotHome() {
    if (!browser || !slotContentContainer || !slotHome?.parent?.isConnected) return;
    if (slotContentContainer.parentNode !== slotHome.parent) {
      slotHome.parent.insertBefore(
        slotContentContainer,
        slotHome.anchor?.parentNode === slotHome.parent ? slotHome.anchor : null,
      );
    }
  }

  function cleanupLayout() {
    // Park the slot content outside the layout BEFORE unmounting it, otherwise unmounting
    // rips the live <slot> subtree out of the DOM -> blank/torn content and a detached-DOM
    // leak. ONLY when a layout is actually mounted: running this unconditionally stranded
    // every no-layout plugin page's content at the end of <body> on hydration — the page
    // rendered fine in SSR, then "vanished" below the footer at CSR (title correct, body
    // seemingly gone).
    if (browser && slotContentContainer && layoutInstance) {
      const parent = stableSlotParent();
      if (parent && slotContentContainer.parentNode !== parent) {
        slotContentContainer.style.display = 'none';
        parent.appendChild(slotContentContainer);
      }
    }

    if (layoutInstance) {
      try {
        // Use the snapshot of what was mounted
        if (typeof activeLayoutComp?.unmount === 'function')
          activeLayoutComp.unmount(layoutInstance);
        else unmount(layoutInstance);
      } catch (e) {}
      layoutInstance = null;
      activeLayoutComp = null;
    }
  }

  // Layout lifecycle: mount / re-mount the dynamic plugin layout into the persistent
  // layoutContainer. The container itself is NOT keyed, so navigation between plugin pages never
  // destroys it and never tears out the bridged slot content.
  $effect(() => {
    if (!browser || !layoutContainer) return;

    if (!data.layout) {
      cleanupLayout();
      return;
    }

    const layoutComp = data.layout.default || data.layout;
    if (activeLayoutComp !== data.layout) {
      cleanupLayout();
      try {
        if (data.layout.mount) {
          layoutInstance = data.layout.mount({
            target: layoutContainer,
            props: { ...(data.props || {}), panoContexts: contexts },
            context: contexts,
          });
        } else {
          layoutInstance = mount(layoutComp, {
            target: layoutContainer,
            props: { ...(data.props || {}), panoContexts: contexts },
            context: contexts,
          });
        }
        activeLayoutComp = data.layout;
      } catch (e) {
        console.error('[Layout] Mount failed', e);
      }
    }
  });

  $effect(() => () => cleanupLayout());

  // Slot bridge: move the slot content into the layout's content anchor. Only append when the
  // slot is not already the anchor's last child, so we never detach a live, correctly-placed
  // subtree (which would blank the content during re-renders).
  $effect(() => {
    const _pageData = data; // dependency
    if (!browser) return;

    let rafId;
    const poll = () => {
      if (!slotContentContainer) {
        rafId = requestAnimationFrame(poll);
        return;
      }

      // No dynamic layout: make sure the wrapper sits in its natural (SSR) position —
      // a previous layout page's teardown may have parked it on <body> — then reset
      // style and stop polling.
      if (!data.layout) {
        restoreSlotHome();
        slotContentContainer.style.display = '';
        return;
      }

      const anchor = layoutContainer?.querySelector(
        '[data-pano-content], main, .content, .page-content, article',
      );

      if (anchor) {
        if (anchor.lastElementChild !== slotContentContainer) {
          anchor.appendChild(slotContentContainer);
        }
        slotContentContainer.style.display = '';
      } else if (layoutContainer?.firstElementChild) {
        if (layoutContainer.firstElementChild.lastElementChild !== slotContentContainer) {
          layoutContainer.firstElementChild.appendChild(slotContentContainer);
        }
        slotContentContainer.style.display = '';
      } else {
        rafId = requestAnimationFrame(poll);
      }
    };

    poll();
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  });
</script>
