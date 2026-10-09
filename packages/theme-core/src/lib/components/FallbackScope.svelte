<div
  class={mode === "fallback" ? "pano-fb" : "pano-fb-stop"}
  data-pano-fb={mode === "fallback" ? ns : undefined}
  style="display: contents"
>
  <Component {...props} />
</div>

<script>
  // The wrapper `views.wrap` puts around a view (doc 03 section 4.4).
  //
  // - `fallback`: a default plugin view in a theme without Bootstrap. The plugin's fallback sheet is scoped to
  //   `.pano-fb[data-pano-fb="<ns>"]`, and everything below this element knows it is inside that scope.
  // - `stop`: a theme override nested in such a scope. `.pano-fb-stop` ends the scope (`@scope ... to (...)`), so
  //   the theme's own markup is not styled by the plugin's sheet; views below it open a fresh scope.
  import { setContext } from "svelte";

  /** @type {{ Component: any, ns: string, mode: 'fallback' | 'stop', props: object }} */
  let { Component, ns, mode, props } = $props();

  // the wrapper never changes its mode while it lives (a new mode is a new wrapper)
  // svelte-ignore state_referenced_locally
  setContext("pano:fb", mode === "fallback" ? ns : null);
</script>
