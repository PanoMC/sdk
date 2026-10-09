{#if component && typeof component !== 'function'}
  {@const Component = injected(component)}
  <Component {...rest} />
{/if}

<script>
  import { getPanoContext } from "@panomc/sdk/internal";

  let { component, ...rest } = $props();

  /**
   * The component of the injected module, in the fallback scope of its plugin (or the `legacy` scope for a plugin that
   * is not on the new model) when the theme has no Bootstrap (`views.wrapInjected`, doc 03 section 4.4).
   */
  function injected(module) {
    const wrapInjected = getPanoContext().context?.views?.wrapInjected;

    return typeof wrapInjected === "function" ? wrapInjected(module) : module.default || module;
  }
</script>
