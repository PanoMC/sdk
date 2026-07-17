{#if !browser}
  <!-- Server Side: Native Rendering to preserve Context ($page store) -->
  <svelte:component this={data.component.default} {...data.props || {}} />
{:else}
  <!-- Client Side: Manual Mount to prevent Runtime Mismatch (effect_orphan) -->
  {#key data}
    <div use:mountPlugin class="plugin-view-container"></div>
  {/key}
{/if}

<script context="module">
  /**
   * @type {import('@sveltejs/kit').PageLoad}
   */
  export async function load(event) {
    const { parent } = event;
    const { registeredPage } = await parent();

    let componentOutput = {};

    const component = await registeredPage.component();

    // Inject plugin-specific params into the event
    if (registeredPage.params) {
      event.params = { ...event.params, ...registeredPage.params };
    }

    if (component.load !== undefined) {
      componentOutput = await component.load(event);
    }

    const output = { registeredPage, component, props: componentOutput };

    // Expose layout-consumed fields from the component's load output
    // at the top level so they end up on page.data (e.g. pageTitle is
    // read by AppLayout/MainLayout to set <title> and the PageTitle component).
    if (componentOutput && typeof componentOutput === "object") {
      for (const key of ["pageTitle", "breadcrumbs", "sidebar", "sidebarProps"]) {
        if (componentOutput[key] !== undefined) {
          output[key] = componentOutput[key];
        }
      }
    }

    return output;
  }
</script>

<script>
  import { mount, unmount, hydrate, getAllContexts } from 'svelte';
  import { browser } from '$app/environment';

  export let data;

  const contexts = getAllContexts();

  function mountPlugin(viewContainer) {
    if (!browser || !viewContainer || !data.component?.default) return;

    let componentInstance;

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
